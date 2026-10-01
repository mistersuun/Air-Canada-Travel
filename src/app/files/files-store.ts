/**
 * Where attachments, passes and their blobs live (extras spec §4.2):
 * IndexedDB `routes-files` (IdbFilesStore), or memory when IndexedDB is
 * missing or blocked (MemoryFilesStore). FilesService and PassesService
 * share one store through FILES_STORE.
 */
import { InjectionToken } from '@angular/core';
import type { PassRecord } from '../passes/model';
import { openDb, req, run } from './idb';
import { Attachment, FILES_DB, FILES_DB_VERSION, StoredBlob } from './model';

export const STORES = { attachments: 'attachments', passes: 'passes', blobs: 'blobs', meta: 'meta' } as const;

/** Thrown by a write on a read-only store (a newer app version wrote the database). */
export class ReadOnlyStoreError extends Error {
  constructor() {
    super('The files database was written by a newer version of the app');
    this.name = 'ReadOnlyStoreError';
  }
}

export interface FilesStore {
  readonly readOnly: boolean;
  readonly kind: 'idb' | 'memory';
  listAttachments(): Promise<Attachment[]>;
  listPasses(): Promise<PassRecord[]>;
  /** The attachment and its blob in one transaction (both or neither). */
  putAttachment(a: Attachment, blob?: StoredBlob): Promise<void>;
  putPass(p: PassRecord, blob?: StoredBlob): Promise<void>;
  /** Deletes the record, then its unreferenced blobs. */
  deleteAttachment(id: string): Promise<void>;
  deletePass(id: string): Promise<void>;
  getBlob(id: string): Promise<Blob | null>;
  /** Byte size of every stored blob, by id. */
  blobSizes(): Promise<Map<string, number>>;
  /** Deletes blobs no attachment (blobId, thumbBlobId) or pass (imageBlobId) references. Resolves to the count. */
  gcBlobs(): Promise<number>;
  close(): void;
}

/** Blob ids the records reference. */
export function referencedBlobs(attachments: readonly Attachment[], passes: readonly PassRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const a of attachments) {
    if (a.blobId) ids.add(a.blobId);
    if (a.thumbBlobId) ids.add(a.thumbBlobId);
  }
  for (const p of passes) if (p.imageBlobId) ids.add(p.imageBlobId);
  return ids;
}

/** A blob record as stored: the Blob itself, or (old WebKit, DataCloneError) its bytes. */
interface BlobRow { id: string; blob?: Blob; data?: ArrayBuffer; bytes: number; mime: string; createdAt: string }

function rowToBlob(row: BlobRow | undefined): Blob | null {
  if (!row) return null;
  if (row.blob && typeof (row.blob as Blob).size === 'number') return row.blob;
  if (row.data) return new Blob([row.data], { type: row.mime });
  return null;
}

/** Schema v1. Future versions add cases (fall-through) and never drop stores. */
export function upgradeFilesDb(db: IDBDatabase, oldVersion: number, tx: IDBTransaction): void {
  switch (oldVersion) {
    case 0: {
      db.createObjectStore(STORES.attachments, { keyPath: 'id' }).createIndex('byTrip', 'tripId');
      db.createObjectStore(STORES.passes, { keyPath: 'id' }).createIndex('byTrip', 'tripId');
      db.createObjectStore(STORES.blobs, { keyPath: 'id' });
      db.createObjectStore(STORES.meta, { keyPath: 'key' });
      tx.objectStore(STORES.meta).put({ key: 'schema', value: 1 });
    }
    // future: case 1: …
  }
}

export class IdbFilesStore implements FilesStore {
  readonly kind = 'idb' as const;
  /** Set after the first DataCloneError: blobs are then stored as ArrayBuffers. */
  private blobsAsBuffers: boolean;

  private constructor(private readonly db: IDBDatabase, readonly readOnly: boolean, blobMode: 'auto' | 'buffer') {
    this.blobsAsBuffers = blobMode === 'buffer';
  }

  /**
   * Opens `routes-files`. `onVersionChange` runs when another tab upgrades the
   * database (the connection is closed first). `blobMode: 'buffer'` forces the
   * ArrayBuffer shape (tests).
   */
  static async open(opts: { factory?: IDBFactory; onVersionChange?: () => void; blobMode?: 'auto' | 'buffer'; name?: string } = {}): Promise<IdbFilesStore> {
    const { db, readOnly } = await openDb(opts.name ?? FILES_DB, FILES_DB_VERSION, upgradeFilesDb, opts.factory);
    db.onversionchange = () => {
      db.close();
      opts.onVersionChange?.();
    };
    return new IdbFilesStore(db, readOnly, opts.blobMode ?? 'auto');
  }

  listAttachments(): Promise<Attachment[]> {
    return run(this.db, [STORES.attachments], 'readonly', tx => req(tx.objectStore(STORES.attachments).getAll() as IDBRequest<Attachment[]>));
  }

  listPasses(): Promise<PassRecord[]> {
    return run(this.db, [STORES.passes], 'readonly', tx => req(tx.objectStore(STORES.passes).getAll() as IDBRequest<PassRecord[]>));
  }

  putAttachment(a: Attachment, blob?: StoredBlob): Promise<void> {
    return this.putWithBlob(STORES.attachments, a, blob);
  }

  putPass(p: PassRecord, blob?: StoredBlob): Promise<void> {
    return this.putWithBlob(STORES.passes, p, blob);
  }

  async deleteAttachment(id: string): Promise<void> {
    this.assertWritable();
    await run(this.db, [STORES.attachments], 'readwrite', tx => req(tx.objectStore(STORES.attachments).delete(id)));
    await this.gcBlobs();
  }

  async deletePass(id: string): Promise<void> {
    this.assertWritable();
    await run(this.db, [STORES.passes], 'readwrite', tx => req(tx.objectStore(STORES.passes).delete(id)));
    await this.gcBlobs();
  }

  async getBlob(id: string): Promise<Blob | null> {
    const row = await run(this.db, [STORES.blobs], 'readonly', tx => req(tx.objectStore(STORES.blobs).get(id) as IDBRequest<BlobRow | undefined>));
    return rowToBlob(row);
  }

  async blobSizes(): Promise<Map<string, number>> {
    const rows = await run(this.db, [STORES.blobs], 'readonly', tx => req(tx.objectStore(STORES.blobs).getAll() as IDBRequest<BlobRow[]>));
    return new Map(rows.map(r => [r.id, r.bytes]));
  }

  async gcBlobs(): Promise<number> {
    if (this.readOnly) return 0;
    return run(this.db, [STORES.attachments, STORES.passes, STORES.blobs], 'readwrite', async tx => {
      const [atts, passes, keys] = await Promise.all([
        req(tx.objectStore(STORES.attachments).getAll() as IDBRequest<Attachment[]>),
        req(tx.objectStore(STORES.passes).getAll() as IDBRequest<PassRecord[]>),
        req(tx.objectStore(STORES.blobs).getAllKeys()),
      ]);
      const keep = referencedBlobs(atts, passes);
      const drop = (keys as string[]).filter(k => !keep.has(k));
      await Promise.all(drop.map(k => req(tx.objectStore(STORES.blobs).delete(k))));
      return drop.length;
    });
  }

  close(): void {
    this.db.close();
  }

  private assertWritable(): void {
    if (this.readOnly) throw new ReadOnlyStoreError();
  }

  private async putWithBlob(store: string, rec: { id: string }, blob?: StoredBlob): Promise<void> {
    this.assertWritable();
    const write = (row: BlobRow | null): Promise<void> =>
      run(this.db, row ? [store, STORES.blobs] : [store], 'readwrite', async tx => {
        if (row) await req(tx.objectStore(STORES.blobs).put(row));
        await req(tx.objectStore(store).put(rec));
      });
    if (!blob) return write(null);
    if (!this.blobsAsBuffers) {
      try {
        return await write({ id: blob.id, blob: blob.blob, bytes: blob.bytes, mime: blob.mime, createdAt: blob.createdAt });
      } catch (e) {
        if ((e as { name?: string })?.name !== 'DataCloneError') throw e;
        this.blobsAsBuffers = true; // old WebKit can't store Blobs: keep the bytes instead
      }
    }
    const data = await blob.blob.arrayBuffer(); // outside the transaction
    return write({ id: blob.id, data, bytes: blob.bytes, mime: blob.mime, createdAt: blob.createdAt });
  }
}

/** Files kept in memory only: IndexedDB missing or blocked, and tests. `quotaBytes` simulates a full disk. */
export class MemoryFilesStore implements FilesStore {
  readonly kind = 'memory' as const;
  readonly readOnly = false;
  private readonly attachments = new Map<string, Attachment>();
  private readonly passes = new Map<string, PassRecord>();
  private readonly blobs = new Map<string, StoredBlob>();

  constructor(private readonly opts: { quotaBytes?: number } = {}) {}

  async listAttachments(): Promise<Attachment[]> {
    return [...this.attachments.values()].map(a => structuredClone(a));
  }

  async listPasses(): Promise<PassRecord[]> {
    return [...this.passes.values()].map(p => ({ ...p }));
  }

  async putAttachment(a: Attachment, blob?: StoredBlob): Promise<void> {
    this.checkQuota(blob);
    if (blob) this.blobs.set(blob.id, blob);
    this.attachments.set(a.id, structuredClone(a));
  }

  async putPass(p: PassRecord, blob?: StoredBlob): Promise<void> {
    this.checkQuota(blob);
    if (blob) this.blobs.set(blob.id, blob);
    this.passes.set(p.id, { ...p });
  }

  async deleteAttachment(id: string): Promise<void> {
    this.attachments.delete(id);
    await this.gcBlobs();
  }

  async deletePass(id: string): Promise<void> {
    this.passes.delete(id);
    await this.gcBlobs();
  }

  async getBlob(id: string): Promise<Blob | null> {
    return this.blobs.get(id)?.blob ?? null;
  }

  async blobSizes(): Promise<Map<string, number>> {
    return new Map([...this.blobs.values()].map(b => [b.id, b.bytes]));
  }

  async gcBlobs(): Promise<number> {
    const keep = referencedBlobs([...this.attachments.values()], [...this.passes.values()]);
    let n = 0;
    for (const id of [...this.blobs.keys()]) {
      if (!keep.has(id)) {
        this.blobs.delete(id);
        n++;
      }
    }
    return n;
  }

  close(): void {
    // nothing to release
  }

  private checkQuota(blob?: StoredBlob): void {
    if (!blob || this.opts.quotaBytes === undefined) return;
    let used = 0;
    for (const b of this.blobs.values()) if (b.id !== blob.id) used += b.bytes;
    if (used + blob.bytes > this.opts.quotaBytes) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  }
}

/**
 * The store both services use. Opening is async, so this is a factory: the
 * first call opens IndexedDB, falling back to memory when it is unavailable.
 * Tests provide `() => Promise.resolve(new MemoryFilesStore())` or an
 * IdbFilesStore over fake-indexeddb.
 */
export type FilesStoreOpener = (hooks: { onVersionChange: () => void }) => Promise<FilesStore>;

export const FILES_STORE = new InjectionToken<FilesStoreOpener>('FILES_STORE', {
  providedIn: 'root',
  factory: () => async hooks => {
    try {
      return await IdbFilesStore.open({ onVersionChange: hooks.onVersionChange });
    } catch (e) {
      if ((e as { name?: string })?.name === 'IdbBlockedError') throw e;
      return new MemoryFilesStore();
    }
  },
});
