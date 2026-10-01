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
  MAX_FILE_BYTES, StoredBlob, UsageSummary, sameScope,
} from './model';
import { compressPhoto } from './photo';
import { StorageInfo, checkRoom, estimate, storageInfo } from './quota';

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

/** 'application/pdf' → pdf, 'image/*' → image, anything else → file. */
export function kindForMime(mime: string): AttachmentKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
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
  private readonly list = signal<Attachment[]>([]);
  private readonly prefsState = signal<FilesPrefs>(this.loadPrefs());
  private ready: Promise<FilesStore | null> | null = null;

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

  /** A PDF, photo or any file. Large photos are re-encoded when compressPhotos is on. */
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
    return this.put(store, a, blob);
  }

  addNote(tripId: string, scope: AttachmentScope, title: string, text: string): Promise<Attachment | { error: FilesError }> {
    return this.addText(tripId, scope, 'note', title.trim() || 'Note', text);
  }

  addAddress(tripId: string, scope: AttachmentScope, title: string, address: string): Promise<Attachment | { error: FilesError }> {
    return this.addText(tripId, scope, 'address', title.trim() || 'Address', address);
  }

  /** Rename, edit the text, or move to another scope. */
  async update(id: string, patch: Partial<Pick<Attachment, 'title' | 'text' | 'scope'>>): Promise<void> {
    const store = await this.storeOrNull();
    const cur = this.list().find(a => a.id === id);
    if (!store || store.readOnly || !cur) return;
    const next: Attachment = { ...cur, ...patch, updatedAt: new Date(this.now()).toISOString() };
    if (patch.title !== undefined) next.title = patch.title.trim() || cur.title;
    try {
      await store.putAttachment(next);
    } catch {
      return;
    }
    this.list.update(l => l.map(a => (a.id === id ? next : a)));
  }

  /** Deletes the file and its blob; flashes "File deleted" with Undo. */
  async remove(id: string): Promise<void> {
    const store = await this.storeOrNull();
    const rec = this.list().find(a => a.id === id);
    if (!store || store.readOnly || !rec) return;
    const content = rec.blobId ? await store.getBlob(rec.blobId) : null;
    await store.deleteAttachment(id);
    this.list.update(l => l.filter(a => a.id !== id));
    this.db.flash('File deleted', { label: 'Undo', run: () => void this.restore(rec, content) });
  }

  /** An object URL for a stored blob; the caller revokes it. */
  async objectUrl(blobId: string): Promise<string | null> {
    const store = await this.storeOrNull();
    const blob = store ? await store.getBlob(blobId) : null;
    return blob ? URL.createObjectURL(blob) : null;
  }

  /**
   * Opens a file: PDFs and other files (and images, for callers without a
   * viewer) in a new tab, else as a download; an address in Google Maps.
   * Notes have nothing to open.
   */
  async open(a: Attachment): Promise<void> {
    const win = this.doc.defaultView;
    if (a.kind === 'address' && a.text) {
      win?.open(mapsUrl(a.text), '_blank', 'noopener');
      return;
    }
    if (!a.blobId) return;
    const url = await this.objectUrl(a.blobId);
    if (!url) return;
    const tab = win?.open(url, '_blank');
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
        const bytes = data ? base64Decode(data) : null;
        if (!bytes) {
          skipped++;
          continue;
        }
        const id = newId();
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
  return '';
}
