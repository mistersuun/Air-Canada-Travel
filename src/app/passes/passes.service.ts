/**
 * Saved boarding passes (extras spec §4.8). IndexedDB only, through the
 * shared files store. Passes are never exported, shared or logged: nothing
 * here writes to the console, and no other service reads `raw`.
 */
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { NOW } from '../state/app-state.service';
import { FilesDb } from '../files/files-db';
import { FilesStore, ReadOnlyStoreError } from '../files/files-store';
import { FilesError, MAX_FILE_BYTES, StoredBlob } from '../files/model';
import { checkRoom, estimate, isQuotaError } from '../files/quota';
import { deadlineUtc } from '../trips/engine/homeby';
import { newId } from '../trips/ids';
import type { Trip } from '../trips/model';
import { TripsService } from '../trips/trips.service';
import { NewPass, PassRecord } from './model';

const DAY_MS = 864e5;

/** "1 boarding pass removed after your trip" / "2 boarding passes …". */
export function removedAfterTripText(n: number): string {
  return `${n} boarding ${n === 1 ? 'pass' : 'passes'} removed after your trip`;
}

/** The passes whose trip ended (home-by deadline + 24 h) and that are set to delete after the trip. */
export function expiredPasses(passes: readonly PassRecord[], trips: readonly Trip[], nowMs: number): PassRecord[] {
  const byId = new Map(trips.map(t => [t.id, t]));
  return passes.filter(p => {
    if (!p.deleteAfterTrip) return false;
    const t = byId.get(p.tripId);
    if (!t) return false; // passes of deleted trips are orphans, removed only on request
    return nowMs >= deadlineUtc(t.homeBy, t.homeAirport) + DAY_MS;
  });
}

function byCreated(a: PassRecord, b: PassRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

@Injectable({ providedIn: 'root' })
export class PassesService {
  private readonly db = inject(FilesDb);
  private readonly now = inject(NOW);
  private readonly trips = inject(TripsService);
  private readonly list = signal<PassRecord[]>([]);
  private readonly sizes = signal<ReadonlyMap<string, number>>(new Map());
  private ready: Promise<FilesStore | null> | null = null;
  private cleaned = false;
  /** The blob id each image Blob was stored under, so a multi-leg pass keeps one copy. */
  private readonly savedImages = new WeakMap<Blob, StoredBlob>();
  /** Patches run one after another, each on the latest record. */
  private patches: Promise<unknown> = Promise.resolve();

  /** Every saved pass, oldest first. */
  readonly passes: Signal<PassRecord[]> = this.list.asReadonly();
  /** Bytes of the passes' images (each stored image counted once). */
  readonly imageBytes: Signal<number> = computed(() => {
    const sizes = this.sizes();
    const ids = new Set(this.list().map(p => p.imageBlobId).filter((x): x is string => !!x));
    let n = 0;
    for (const id of ids) n += sizes.get(id) ?? 0;
    return n;
  });

  /** Opens the store and loads the passes once; then removes expired passes (deleteAfterTrip). */
  ensureReady(): Promise<void> {
    this.ready ??= (async () => {
      const store = await this.db.store();
      if (!store) return null;
      try {
        const [passes, sizes] = await Promise.all([store.listPasses(), store.blobSizes()]);
        this.list.set([...passes].sort(byCreated));
        this.sizes.set(sizes);
      } catch {
        // an unreadable store shows no passes; the status says why
      }
      return store;
    })();
    return this.ready.then(async store => {
      if (store && !this.cleaned) {
        this.cleaned = true;
        try {
          await this.cleanupExpired(this.trips.trips(), this.now());
        } catch {
          // best effort: it is retried on the next launch
        }
      }
    });
  }
  forTrip(tripId: string): PassRecord[] {
    return this.list().filter(p => p.tripId === tripId);
  }

  /** The leg's passes in the order they were added (companions swipe through them). */
  forLeg(tripId: string, legId: string): PassRecord[] {
    return this.list().filter(p => p.tripId === tripId && p.legId === legId);
  }

  /**
   * Saves one pass (one BCBP leg). Saving several legs of one barcode with the
   * same `image` Blob stores the image once; each record references it.
   */
  async save(input: NewPass, image: Blob | null): Promise<PassRecord | { error: FilesError }> {
    const store = await this.storeOrNull();
    if (!store) return { error: 'unsupported' };
    if (store.readOnly) return { error: 'readOnly' };
    let blob: StoredBlob | undefined;
    let imageBlobId: string | null = null;
    if (image && image.size > MAX_FILE_BYTES) return { error: 'tooLarge' };
    if (image) {
      const prev = this.savedImages.get(image);
      if (prev && this.sizes().has(prev.id)) {
        imageBlobId = prev.id; // another leg of the same barcode: share the stored image
      } else {
        if (checkRoom(image.size, await estimate()) === 'quota') return { error: 'quota' };
        blob = { id: newId(), blob: image, bytes: image.size, mime: image.type || 'image/png', createdAt: new Date(this.now()).toISOString() };
        imageBlobId = blob.id;
      }
    }
    const rec: PassRecord = { ...input, v: 1, id: newId(), imageBlobId, createdAt: new Date(this.now()).toISOString() };
    try {
      await store.putPass(rec, blob);
    } catch (e) {
      return { error: errorOf(e) };
    }
    if (blob && image) {
      this.savedImages.set(image, blob);
      this.sizes.update(m => new Map(m).set(blob!.id, blob!.bytes));
    }
    this.list.update(l => [...l, rec].sort(byCreated));
    this.db.savedOnce();
    return rec;
  }

  /** Resolves to null when saved, else why not. */
  relink(id: string, legId: string | null, refIndex: number | null, matched: PassRecord['matched']): Promise<FilesError | null> {
    return this.patch(id, { legId, refIndex, matched });
  }

  /** Resolves to null when saved, else why not. */
  setDeleteAfterTrip(id: string, on: boolean): Promise<FilesError | null> {
    return this.patch(id, { deleteAfterTrip: on });
  }

  /** Deletes the pass (and its image when no other pass uses it), with Undo. */
  async remove(id: string): Promise<void> {
    const store = await this.storeOrNull();
    const rec = this.list().find(p => p.id === id);
    if (!store || !rec || store.readOnly) return;
    const image = rec.imageBlobId ? await store.getBlob(rec.imageBlobId) : null;
    await store.deletePass(id);
    this.list.update(l => l.filter(p => p.id !== id));
    await this.refreshSizes(store);
    this.db.flash('Pass deleted', {
      label: 'Undo',
      run: () => void this.restore(rec, image),
    });
  }

  /**
   * Deletes the passes set to "Delete after the trip" once their trip's
   * home-by deadline is a day past. Passes of deleted trips are kept (they
   * show as orphans in Settings). Resolves to the number removed.
   */
  async cleanupExpired(trips: readonly Trip[], nowMs: number): Promise<number> {
    const store = await this.storeOrNull();
    if (!store || store.readOnly) return 0;
    const expired = expiredPasses(this.list(), trips, nowMs);
    if (!expired.length) return 0;
    for (const p of expired) await store.deletePass(p.id);
    const gone = new Set(expired.map(p => p.id));
    this.list.update(l => l.filter(p => !gone.has(p.id)));
    await this.refreshSizes(store);
    this.db.flash(removedAfterTripText(expired.length));
    return expired.length;
  }

  /** Deletes passes by id without Undo (orphan clean-up). Resolves to the number removed. */
  async removeMany(ids: readonly string[]): Promise<number> {
    const store = await this.storeOrNull();
    if (!store || store.readOnly || !ids.length) return 0;
    const want = new Set(ids);
    const doomed = this.list().filter(p => want.has(p.id));
    for (const p of doomed) await store.deletePass(p.id);
    this.list.update(l => l.filter(p => !want.has(p.id)));
    await this.refreshSizes(store);
    return doomed.length;
  }

  /** Byte size of a stored image (0 when unknown). */
  imageSize(blobId: string | null): number {
    return blobId ? (this.sizes().get(blobId) ?? 0) : 0;
  }

  /** The pass's original image (the photo, or the PDF page), or null. The caller revokes object URLs it makes. */
  async image(id: string): Promise<Blob | null> {
    const store = await this.storeOrNull();
    const rec = this.list().find(p => p.id === id);
    return store && rec?.imageBlobId ? store.getBlob(rec.imageBlobId) : null;
  }

  private async restore(rec: PassRecord, image: Blob | null): Promise<void> {
    const store = await this.storeOrNull();
    if (!store) return;
    const blob: StoredBlob | undefined = image && rec.imageBlobId
      ? { id: rec.imageBlobId, blob: image, bytes: image.size, mime: image.type || 'image/png', createdAt: rec.createdAt }
      : undefined;
    try {
      await store.putPass(rec, blob);
    } catch {
      return;
    }
    this.list.update(l => [...l.filter(p => p.id !== rec.id), rec].sort(byCreated));
    await this.refreshSizes(store);
  }

  /** Read-modify-write of one record, queued so concurrent patches never undo each other. Never rejects. */
  private patch(id: string, patch: Partial<PassRecord>): Promise<FilesError | null> {
    const run = this.patches.then(async (): Promise<FilesError | null> => {
      const store = await this.storeOrNull();
      if (!store) return 'unsupported';
      if (store.readOnly) return 'readOnly';
      const rec = this.list().find(p => p.id === id);
      if (!rec) return 'failed';
      const next = { ...rec, ...patch };
      try {
        await store.putPass(next);
      } catch (e) {
        return errorOf(e);
      }
      this.list.update(l => l.map(p => (p.id === id ? next : p)));
      return null;
    }).catch(() => 'failed' as const);
    this.patches = run;
    return run;
  }

  private async refreshSizes(store: FilesStore): Promise<void> {
    try {
      this.sizes.set(await store.blobSizes());
    } catch {
      // keep the old sizes
    }
  }

  private async storeOrNull(): Promise<FilesStore | null> {
    await this.ensureLoaded();
    return this.db.store();
  }

  /** Loads the list without running the clean-up (save/remove can come before ensureReady). */
  private ensureLoaded(): Promise<unknown> {
    if (this.ready) return this.ready;
    return this.ensureReady();
  }
}

/** Store error → FilesError. */
export function errorOf(e: unknown): FilesError {
  if (e instanceof ReadOnlyStoreError) return 'readOnly';
  if (isQuotaError(e)) return 'quota';
  return 'failed';
}
