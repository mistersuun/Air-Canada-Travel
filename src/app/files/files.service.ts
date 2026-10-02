/**
 * Trip attachments (extras spec §4.4): files, photos, notes and addresses on
 * a trip, a leg or a day. Kept in IndexedDB on this phone (memory when the
 * browser blocks it); in backups only when the user opts in.
 */
import { DOCUMENT, Injectable, InjectionToken, Signal, computed, inject, signal } from '@angular/core';
import { NOW } from '../state/app-state.service';
import { PassesService, errorOf } from '../passes/passes.service';
import { newId } from '../trips/ids';
import { TripsService } from '../trips/trips.service';
import {
  backupWithFilesFilename, base64Decode, buildBackupWithFiles, readBackupFiles,
} from './backup-files';
import { FilesDb } from './files-db';
import { FilesStore } from './files-store';
import {
  Attachment, AttachmentKind, AttachmentScope, DEFAULT_FILES_PREFS, FILES_PREFS_KEY, FilesError, FilesPrefs, FilesStatus,
  MAX_FILE_BYTES, RASTER_IMAGE_MIMES, StoredBlob, UsageSummary, safeMime, sameScope,
} from './model';
import { compressPhoto } from './photo';
import { StorageInfo, checkRoom, estimate, storageInfo } from './quota';
import { THUMB_MAKER, wantsThumb } from './thumbs';

/** localStorage for FilesPrefs; null when site data is blocked (prefs then live in memory). */
export const FILES_PREFS_STORAGE = new InjectionToken<Storage | null>('FILES_PREFS_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

/** FilesPrefs from untrusted JSON (defaults for anything missing). Never throws. */
export function sanitizeFilesPrefs(raw: unknown): FilesPrefs {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const b = (k: keyof FilesPrefs): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_FILES_PREFS[k]);
  return { includeInBackup: b('includeInBackup'), deletePassesAfterTrip: b('deletePassesAfterTrip'), compressPhotos: b('compressPhotos') };
}

/** 'application/pdf' → pdf, raster 'image/*' → image, anything else (SVG too) → file. */
export function kindForMime(mime: string): AttachmentKind {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m === 'application/pdf') return 'pdf';
  if (RASTER_IMAGE_MIMES.includes(m)) return 'image';
  return 'file';
}

/** 'Train tickets.pdf' → 'Train tickets'. */
export function titleFromName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim() || 'File';
}

/** Usage by category: passes, PDFs, photos, notes (0 bytes, counted) and other. */
export function summarizeUsage(attachments: readonly Attachment[], passCount: number, passBytes: number): UsageSummary {
  const by = { passes: passBytes, pdfs: 0, photos: 0, notes: 0, other: 0 };
  for (const a of attachments) {
    if (a.kind === 'pdf') by.pdfs += a.bytes;
    else if (a.kind === 'image') by.photos += a.bytes;
    else if (a.kind === 'note' || a.kind === 'address') by.notes += 0;
    else by.other += a.bytes;
  }
  return { count: attachments.length + passCount, bytes: by.passes + by.pdfs + by.photos + by.notes + by.other, byCategory: by };
}

function byCreated(a: Attachment, b: Attachment): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly db = inject(FilesDb);
  private readonly now = inject(NOW);
  private readonly passesSvc = inject(PassesService);
  private readonly trips = inject(TripsService);
  private readonly doc = inject(DOCUMENT);
  private readonly prefsStorage = inject(FILES_PREFS_STORAGE);
  private readonly makeThumb = inject(THUMB_MAKER);
  private readonly list = signal<Attachment[]>([]);
  private readonly prefsState = signal<FilesPrefs>(this.loadPrefs());
  private ready: Promise<FilesStore | null> | null = null;
  /** blob: URLs of previews, by attachment id (tiny JPEGs, kept for the session). */
  private readonly thumbUrls = signal<Record<string, string>>({});
  /** Attachment ids whose preview was made (or tried) this session. */
  private readonly thumbTried = new Set<string>();
  /** `${id}:${thumbBlobId}` whose stored preview is loading or loaded. */
  private readonly thumbLoading = new Set<string>();
  /** Previews are made one at a time (pdf.js is heavy). */
  private thumbChain: Promise<void> = Promise.resolve();

  readonly status: Signal<FilesStatus> = this.db.status;
  readonly attachments: Signal<Attachment[]> = this.list.asReadonly();
  readonly prefs: Signal<FilesPrefs> = this.prefsState.asReadonly();
  readonly usage: Signal<UsageSummary> = computed(() =>
    summarizeUsage(this.list(), this.passesSvc.passes().length, this.passesSvc.imageBytes()));

  /** Opens the store (once) and loads attachments and passes. */
  ensureReady(): Promise<void> {
    this.ready ??= (async () => {
      const store = await this.db.store();
      if (!store) return null;
      try {
        this.list.set([...(await store.listAttachments())].sort(byCreated));
      } catch {
        // unreadable: show none; the status says why
      }
      return store;
    })();
    return Promise.all([this.ready, this.passesSvc.ensureReady()]).then(() => undefined);
  }

  forTrip(tripId: string): Attachment[] {
    return this.list().filter(a => a.tripId === tripId);
  }

  forScope(tripId: string, scope: AttachmentScope): Attachment[] {
    return this.list().filter(a => a.tripId === tripId && sameScope(a.scope, scope));
  }

  /** A PDF, photo or any file. Large photos and JPEG/HEIC photos (EXIF) are re-encoded when compressPhotos is on. */
  async addFile(tripId: string, scope: AttachmentScope, file: File, title?: string): Promise<Attachment | { error: FilesError }> {
    const store = await this.storeOrNull();
    if (!store) return { error: 'unsupported' };
    if (store.readOnly) return { error: 'readOnly' };
    if (file.size > MAX_FILE_BYTES) return { error: 'tooLarge' };
    const mime = file.type || 'application/octet-stream';
    const kind = kindForMime(mime);
    const content: Blob = kind === 'image' && this.prefsState().compressPhotos ? await compressPhoto(file) : file;
    if (checkRoom(content.size, await estimate()) === 'quota') return { error: 'quota' };
    const at = new Date(this.now()).toISOString();
    const blob: StoredBlob = { id: newId(), blob: content, bytes: content.size, mime: content.type || mime, createdAt: at };
    const a: Attachment = {
      v: 1, id: newId(), tripId, scope, kind,
      title: (title ?? '').trim() || titleFromName(file.name),
      text: null, blobId: blob.id, thumbBlobId: null, mime: blob.mime, bytes: blob.bytes, pages: null,
      createdAt: at, updatedAt: at,
    };
    const saved = await this.put(store, a, blob);
    if (!('error' in saved)) this.ensureThumbs([saved]);
    return saved;
  }

  /** The preview's blob: URL for a PDF or photo, once made; null shows the icon. */
  thumbUrl(a: Attachment): string | null {
    return this.thumbUrls()[a.id] ?? null;
  }

  /**
   * Loads the stored previews of these files, and makes the missing ones in
   * the background (files added before previews existed, or whose preview
   * was lost). Each file is tried once per session; failures keep the icon.
   */
  ensureThumbs(items: readonly Attachment[]): void {
    for (const a of items) {
      if (!wantsThumb(a.kind) || !a.blobId) continue;
      if (a.thumbBlobId) {
        const key = `${a.id}:${a.thumbBlobId}`;
        if (this.thumbLoading.has(key) || this.thumbUrls()[a.id]) continue;
        this.thumbLoading.add(key);
        void this.loadThumb(a, a.thumbBlobId);
      } else if (!this.thumbTried.has(a.id)) {
        this.thumbTried.add(a.id);
        this.queueThumb(a.id);
      }
    }
  }

  addNote(tripId: string, scope: AttachmentScope, title: string, text: string): Promise<Attachment | { error: FilesError }> {
    return this.addText(tripId, scope, 'note', title.trim() || 'Note', text);
  }

  addAddress(tripId: string, scope: AttachmentScope, title: string, address: string): Promise<Attachment | { error: FilesError }> {
    return this.addText(tripId, scope, 'address', title.trim() || 'Address', address);
  }

  /** Rename, edit the text, or move to another scope. Resolves to null when saved, else why not. */
  async update(id: string, patch: Partial<Pick<Attachment, 'title' | 'text' | 'scope'>>): Promise<FilesError | null> {
    const store = await this.storeOrNull();
    if (!store) return 'unsupported';
    if (store.readOnly) return 'readOnly';
    const cur = this.list().find(a => a.id === id);
    if (!cur) return 'failed';
    const next: Attachment = { ...cur, ...patch, updatedAt: new Date(this.now()).toISOString() };
    if (patch.title !== undefined) next.title = patch.title.trim() || cur.title;
    try {
      await store.putAttachment(next);
    } catch (e) {
      return errorOf(e);
    }
    // Merged into the current entry: a preview saved while this wrote (thumbBlobId, pages) is kept,
    // and saved again so the store doesn't keep this write's stale copy without it.
    const now = this.list().find(a => a.id === id);
    if (!now) return null;
    const merged: Attachment = { ...now, ...patch, title: next.title, updatedAt: next.updatedAt };
    this.list.update(l => l.map(a => (a.id === id ? merged : a)));
    if (merged.thumbBlobId !== next.thumbBlobId || merged.pages !== next.pages) {
      await store.putAttachment(merged).catch(() => undefined);
    }
    return null;
  }

  /** Deletes the file and its blob; flashes "File deleted" with Undo. */
  async remove(id: string): Promise<void> {
    const store = await this.storeOrNull();
    const rec = this.list().find(a => a.id === id);
    if (!store || store.readOnly || !rec) return;
    const content = rec.blobId ? await store.getBlob(rec.blobId) : null;
    await store.deleteAttachment(id); // its preview blob goes with it
    this.list.update(l => l.filter(a => a.id !== id));
    this.dropThumbUrl(id);
    // Undo brings the file back; its preview is made again.
    this.db.flash('File deleted', { label: 'Undo', run: () => void this.restore({ ...rec, thumbBlobId: null }, content) });
  }

  /**
   * An object URL for a stored blob; the caller revokes it. The blob is
   * re-typed with safeMime, so an HTML or SVG file never gets a URL that
   * would run its script at the app's origin.
   */
  async objectUrl(blobId: string, mime?: string | null): Promise<string | null> {
    const store = await this.storeOrNull();
    const blob = store ? await store.getBlob(blobId) : null;
    return blob ? URL.createObjectURL(new Blob([blob], { type: safeMime(mime ?? blob.type) })) : null;
  }

  /**
   * Opens a file: PDFs, plain text and raster images in a new tab (or as a
   * download when popups are blocked); every other type only as a download,
   * typed application/octet-stream so it never runs in the app's origin. An
   * address opens in Google Maps. Notes have nothing to open.
   */
  async open(a: Attachment): Promise<void> {
    const win = this.doc.defaultView;
    if (a.kind === 'address' && a.text) {
      win?.open(mapsUrl(a.text), '_blank', 'noopener');
      return;
    }
    if (!a.blobId) return;
    const store = await this.storeOrNull();
    const stored = store ? await store.getBlob(a.blobId) : null;
    if (!stored) return;
    const type = safeMime(a.mime ?? stored.type);
    const url = URL.createObjectURL(new Blob([stored], { type }));
    const tab = type === 'application/octet-stream' ? null : win?.open(url, '_blank');
    if (!tab) {
      const link = this.doc.createElement('a');
      link.href = url;
      link.download = a.title + extensionFor(a.mime);
      link.rel = 'noopener';
      this.doc.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  setPrefs(patch: Partial<FilesPrefs>): void {
    const next = sanitizeFilesPrefs({ ...this.prefsState(), ...patch });
    this.prefsState.set(next);
    try {
      this.prefsStorage?.setItem(FILES_PREFS_KEY, JSON.stringify(next));
    } catch {
      // blocked: kept in memory for this session
    }
  }

  storageInfo(): Promise<StorageInfo> {
    return storageInfo();
  }

  /** Files and passes of trips that no longer exist. */
  orphans(tripIds: readonly string[]): { count: number; bytes: number } {
    const keep = new Set(tripIds);
    const atts = this.list().filter(a => !keep.has(a.tripId));
    const passes = this.passesSvc.passes().filter(p => !keep.has(p.tripId));
    const passBlobs = new Set(passes.map(p => p.imageBlobId).filter((x): x is string => !!x));
    let bytes = atts.reduce((s, a) => s + a.bytes, 0);
    for (const id of passBlobs) bytes += this.passesSvc.imageSize(id);
    return { count: atts.length + passes.length, bytes };
  }

  /** Deletes the orphans (no Undo; the UI confirms first). Resolves to the number removed. */
  async removeOrphans(tripIds: readonly string[]): Promise<number> {
    const store = await this.storeOrNull();
    if (!store || store.readOnly) return 0;
    const keep = new Set(tripIds);
    const atts = this.list().filter(a => !keep.has(a.tripId));
    for (const a of atts) await store.deleteAttachment(a.id);
    const gone = new Set(atts.map(a => a.id));
    this.list.update(l => l.filter(a => !gone.has(a.id)));
    for (const id of gone) this.dropThumbUrl(id);
    const passes = await this.passesSvc.removeMany(this.passesSvc.passes().filter(p => !keep.has(p.tripId)).map(p => p.id));
    return atts.length + passes;
  }

  /** The backup file with files (never passes). Rejects unless "Include files in backups" is on. */
  async exportWithFiles(): Promise<Blob> {
    if (!this.prefsState().includeInBackup) throw new Error('Turn on "Include files in backups" first.');
    const store = await this.storeOrNull();
    const base = JSON.parse(this.trips.exportBackup()) as Record<string, unknown>;
    return buildBackupWithFiles(base, this.list(), a => (store && a.blobId ? store.getBlob(a.blobId) : Promise.resolve(null)));
  }

  /** 'routes-backup-with-files-2026-10-01.json'. */
  backupFilename(): string {
    return backupWithFilesFilename(this.now());
  }

  /**
   * Imports a backup: trips through TripsService.importBackup, then the
   * attachments whose trip exists afterwards and whose id is new. Others are
   * skipped and counted. A plain trips backup imports with 0 files.
   */
  async importWithFiles(file: Blob): Promise<{ trips: { added: number; updated: number }; files: { added: number; skipped: number } } | { error: string }> {
    const text = await file.text();
    const trips = this.trips.importBackup(text);
    if ('error' in trips) return trips;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "This file isn't a Routes backup." };
    }
    const entries = readBackupFiles(parsed);
    const store = await this.storeOrNull();
    if (!store || store.readOnly) return { trips, files: { added: 0, skipped: entries.length } };
    const tripIds = new Set(this.trips.trips().map(t => t.id));
    const have = new Set(this.list().map(a => a.id));
    let added = 0, skipped = 0;
    for (const { meta, data } of entries) {
      if (!tripIds.has(meta.tripId) || have.has(meta.id)) {
        skipped++;
        continue;
      }
      let blob: StoredBlob | undefined;
      let rec = meta;
      if (meta.blobId) {
        const bytes = data !== null ? base64Decode(data) : null;
        if (!bytes) {
          skipped++;
          continue;
        }
        const id = newId();
        if (bytes.length > MAX_FILE_BYTES) {
          skipped++;
          continue;
        }
        const mime = meta.mime || 'application/octet-stream';
        blob = { id, blob: new Blob([bytes as BlobPart], { type: mime }), bytes: bytes.length, mime, createdAt: meta.createdAt };
        rec = { ...meta, blobId: id, thumbBlobId: null, bytes: bytes.length };
      }
      try {
        await store.putAttachment(rec, blob);
      } catch {
        skipped++;
        continue;
      }
      have.add(rec.id);
      this.list.update(l => [...l, rec].sort(byCreated));
      added++;
    }
    return { trips, files: { added, skipped } };
  }

  private async addText(tripId: string, scope: AttachmentScope, kind: 'note' | 'address', title: string, text: string): Promise<Attachment | { error: FilesError }> {
    const store = await this.storeOrNull();
    if (!store) return { error: 'unsupported' };
    if (store.readOnly) return { error: 'readOnly' };
    const at = new Date(this.now()).toISOString();
    const a: Attachment = {
      v: 1, id: newId(), tripId, scope, kind, title, text: text.trim(), blobId: null, thumbBlobId: null,
      mime: null, bytes: 0, pages: null, createdAt: at, updatedAt: at,
    };
    return this.put(store, a);
  }

  private async put(store: FilesStore, a: Attachment, blob?: StoredBlob): Promise<Attachment | { error: FilesError }> {
    try {
      await store.putAttachment(a, blob);
    } catch (e) {
      return { error: errorOf(e) };
    }
    this.list.update(l => [...l, a].sort(byCreated));
    this.db.savedOnce();
    return a;
  }

  private async restore(rec: Attachment, content: Blob | null): Promise<void> {
    const store = await this.storeOrNull();
    if (!store) return;
    const blob: StoredBlob | undefined = content && rec.blobId
      ? { id: rec.blobId, blob: content, bytes: content.size, mime: rec.mime ?? content.type, createdAt: rec.createdAt }
      : undefined;
    try {
      await store.putAttachment(rec, blob);
    } catch {
      return;
    }
    this.list.update(l => [...l.filter(a => a.id !== rec.id), rec].sort(byCreated));
    this.thumbTried.delete(rec.id);
  }

  private queueThumb(id: string): void {
    this.thumbChain = this.thumbChain.then(() => this.buildThumb(id)).catch(() => undefined);
  }

  /** A stored preview to a blob: URL; a lost one is made again. */
  private async loadThumb(a: Attachment, thumbBlobId: string): Promise<void> {
    const store = await this.storeOrNull();
    const blob = store ? await store.getBlob(thumbBlobId).catch(() => null) : null;
    if (!blob) {
      if (!this.thumbTried.has(a.id)) {
        this.thumbTried.add(a.id);
        this.queueThumb(a.id);
      }
      return;
    }
    // Deleted or given a new preview meanwhile: a URL now would never be revoked.
    if (this.list().find(x => x.id === a.id)?.thumbBlobId !== thumbBlobId) return;
    this.setThumbUrl(a.id, blob);
  }

  /**
   * Makes a file's preview (and a PDF's page count) and saves it with the
   * file, unless the file was deleted or replaced meanwhile. On a read-only
   * store the preview shows for this session only.
   */
  private async buildThumb(id: string): Promise<void> {
    const store = await this.storeOrNull();
    const before = this.list().find(a => a.id === id);
    if (!store || !before?.blobId) return;
    const content = await store.getBlob(before.blobId).catch(() => null);
    if (!content) return;
    const r = await this.makeThumb(content, before.kind).catch(() => ({ thumb: null, pages: null }));
    const cur = this.list().find(a => a.id === id);
    if (!cur || cur.blobId !== before.blobId) return;
    if (r.thumb) this.setThumbUrl(id, r.thumb);
    if (store.readOnly || (!r.thumb && r.pages === null)) return;
    const thumb: StoredBlob | undefined = r.thumb
      ? { id: newId(), blob: r.thumb, bytes: r.thumb.size, mime: r.thumb.type || 'image/jpeg', createdAt: new Date(this.now()).toISOString() }
      : undefined;
    const patch = { thumbBlobId: thumb?.id ?? cur.thumbBlobId, pages: r.pages ?? cur.pages };
    const prev = { thumbBlobId: cur.thumbBlobId, pages: cur.pages };
    // The list first, so a rename saved while this writes keeps the preview.
    this.list.update(l => l.map(a => (a.id === id ? { ...a, ...patch } : a)));
    try {
      await store.putAttachment({ ...cur, ...patch }, thumb);
    } catch {
      this.list.update(l => l.map(a => (a.id === id ? { ...a, ...prev } : a)));
      return;
    }
    // Deleted while the preview was saving: don't bring it back.
    if (!this.list().some(a => a.id === id)) await store.deleteAttachment(id).catch(() => undefined);
  }

  private setThumbUrl(id: string, blob: Blob): void {
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
    } catch {
      return; // no object URLs here: the icon stays
    }
    const old = this.thumbUrls()[id];
    this.thumbUrls.update(m => ({ ...m, [id]: url }));
    if (old) URL.revokeObjectURL(old);
  }

  private dropThumbUrl(id: string): void {
    const old = this.thumbUrls()[id];
    if (!old) return;
    this.thumbUrls.update(m => {
      const { [id]: _gone, ...rest } = m;
      return rest;
    });
    URL.revokeObjectURL(old);
  }

  private async storeOrNull(): Promise<FilesStore | null> {
    await this.ensureReady();
    return this.db.store();
  }

  private loadPrefs(): FilesPrefs {
    try {
      const raw = this.prefsStorage?.getItem(FILES_PREFS_KEY);
      return sanitizeFilesPrefs(raw ? JSON.parse(raw) : null);
    } catch {
      return { ...DEFAULT_FILES_PREFS };
    }
  }
}

/** Google Maps search for an address (opens outside the app; the only network use here). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function extensionFor(mime: string | null): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'text/plain') return '.txt';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return '.html';
  if (mime === 'image/svg+xml') return '.svg';
  return '';
}
