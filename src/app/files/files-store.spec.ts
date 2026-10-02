import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { PassRecord } from '../passes/model';
import { BLOCKED_WAIT_MS, IdbBlockedError, IdbUnavailableError, openDb, req, run } from './idb';
import { IdbFilesStore, MemoryFilesStore, ReadOnlyStoreError, STORES, upgradeFilesDb } from './files-store';
import { FILES_DB, StoredBlob } from './model';
import { attachment, useNodeBlobs } from './testing/files-testing';

let restore: () => void;
beforeEach(() => (restore = useNodeBlobs()));
afterEach(() => restore());

const blob = (id: string, text = 'hello', mime = 'application/pdf'): StoredBlob =>
  ({ id, blob: new Blob([text], { type: mime }), bytes: text.length, mime, createdAt: '2026-10-01T12:00:00.000Z' });

function pass(over: Partial<PassRecord> = {}): PassRecord {
  return {
    v: 1, id: 'p1', tripId: 'sevtrip001', legId: 'leg-out834', refIndex: 0, matched: 'confirmed', raw: 'M1…', format: 'PDF417',
    bcbpLeg: 0, lastName: 'DOE', firstName: 'JOHN', pnr: 'ABC123', from: 'YUL', to: 'MAD', flightNumber: 'AC834', julian: 281,
    dateKey: '2026-10-08', cabin: 'Y', seat: '12A', sequence: '45', imageBlobId: 'img1', source: 'image', page: null,
    deleteAfterTrip: false, createdAt: '2026-10-01T12:00:00.000Z', ...over,
  };
}

describe('IdbFilesStore (fake-indexeddb)', () => {
  it('creates schema v1 with the four stores and the schema meta', async () => {
    const factory = new IDBFactory();
    const store = await IdbFilesStore.open({ factory });
    expect(store.readOnly).toBe(false);
    store.close();
    const { db } = await openDb(FILES_DB, 1, upgradeFilesDb, factory);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['attachments', 'blobs', 'meta', 'passes']);
    const meta = await run(db, [STORES.meta], 'readonly', tx => req(tx.objectStore(STORES.meta).get('schema')));
    expect(meta).toEqual({ key: 'schema', value: 1 });
    expect(db.transaction(STORES.attachments).objectStore(STORES.attachments).indexNames.contains('byTrip')).toBe(true);
    db.close();
  });

  it('round-trips an attachment and its blob', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    await store.putAttachment(attachment(), blob('blob1'));
    expect(await store.listAttachments()).toEqual([attachment()]);
    const b = await store.getBlob('blob1');
    expect(b).toBeInstanceOf(Blob);
    expect(await b!.text()).toBe('hello');
    expect(b!.type).toBe('application/pdf');
    expect(await store.blobSizes()).toEqual(new Map([['blob1', 5]]));
  });

  it('gcBlobs removes only unreferenced blobs', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    await store.putAttachment(attachment(), blob('blob1'));
    await store.putAttachment(attachment({ id: 'att2', blobId: 'blob2', thumbBlobId: 'thumb2' }), blob('blob2'));
    await store.putPass(pass(), blob('img1'));
    // a stray blob, as after an interrupted save
    await store.putAttachment(attachment({ id: 'att3', blobId: 'stray' }), blob('stray'));
    await store.putAttachment(attachment({ id: 'att3', blobId: null, kind: 'note', bytes: 0 }));
    expect(await store.gcBlobs()).toBe(1);
    expect(await store.getBlob('stray')).toBeNull();
    expect(await store.getBlob('blob1')).not.toBeNull();
    expect(await store.getBlob('img1')).not.toBeNull();
    await store.deleteAttachment('att1');
    expect(await store.getBlob('blob1')).toBeNull();
    await store.deletePass('p1');
    expect(await store.getBlob('img1')).toBeNull();
    expect(await store.listPasses()).toEqual([]);
  });

  it('keeps a pass image while another pass still uses it', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    await store.putPass(pass({ id: 'p1' }), blob('img1'));
    await store.putPass(pass({ id: 'p2', bcbpLeg: 1 }));
    await store.deletePass('p1');
    expect(await store.getBlob('img1')).not.toBeNull();
    await store.deletePass('p2');
    expect(await store.getBlob('img1')).toBeNull();
  });

  it('opens a database written by a newer version read-only: data shows, writes are refused', async () => {
    const factory = new IDBFactory();
    const { db } = await openDb(FILES_DB, 99, (d, old, tx) => upgradeFilesDb(d, old, tx), factory);
    await run(db, [STORES.attachments], 'readwrite', tx => req(tx.objectStore(STORES.attachments).put(attachment({ blobId: null }))));
    db.close();
    const store = await IdbFilesStore.open({ factory });
    expect(store.readOnly).toBe(true);
    expect((await store.listAttachments()).map(a => a.id)).toEqual(['att1']);
    await expect(store.putAttachment(attachment({ id: 'x' }))).rejects.toBeInstanceOf(ReadOnlyStoreError);
    await expect(store.deleteAttachment('att1')).rejects.toBeInstanceOf(ReadOnlyStoreError);
    expect(await store.gcBlobs()).toBe(0);
  });

  it('stores blobs as bytes when the browser cannot clone a Blob (old WebKit), and reads them back as Blobs', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    // A Blob-like with methods: structuredClone throws DataCloneError, like WebKit did for Blobs.
    const real = new Blob(['bytes!'], { type: 'image/png' });
    const uncloneable = { size: real.size, type: real.type, arrayBuffer: () => real.arrayBuffer(), slice: () => real } as unknown as Blob;
    await store.putAttachment(attachment({ kind: 'image', mime: 'image/png' }), { ...blob('blob1'), blob: uncloneable, mime: 'image/png', bytes: 6 });
    const back = await store.getBlob('blob1');
    expect(back).toBeInstanceOf(Blob);
    expect(back!.type).toBe('image/png');
    expect(await back!.text()).toBe('bytes!');
    // later writes go straight to the byte form
    await store.putAttachment(attachment({ id: 'att2', blobId: 'blob2' }), blob('blob2', 'again'));
    expect(await (await store.getBlob('blob2'))!.text()).toBe('again');
  });

  it("stores bytes when WebKit refuses the Blob with UnknownError (Safari Private Browsing)", async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    const { IDBObjectStore: FakeStore } = await import('fake-indexeddb');
    const put = FakeStore.prototype.put;
    const fakePut = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (value && typeof value === 'object' && 'blob' in value) {
        throw new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError');
      }
      return put.call(this, value, key);
    };
    FakeStore.prototype.put = fakePut as typeof put;
    try {
      await store.putPass(pass(), { ...blob('img1', 'pass image'), mime: 'image/png' });
      const back = await store.getBlob('img1');
      expect(back!.type).toBe('image/png');
      expect(await back!.text()).toBe('pass image');
      expect((await store.listPasses()).map(p => p.id)).toEqual(['p1']);
    } finally {
      FakeStore.prototype.put = put;
    }
  });

  it('does not hide a quota error behind the byte form', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    const { IDBObjectStore: FakeStore } = await import('fake-indexeddb');
    const put = FakeStore.prototype.put;
    FakeStore.prototype.put = function () {
      throw new DOMException('full', 'QuotaExceededError');
    } as typeof put;
    try {
      await expect(store.putAttachment(attachment(), blob('blob1'))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    } finally {
      FakeStore.prototype.put = put;
    }
  });

  it('can be forced to the byte form', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory(), blobMode: 'buffer' });
    await store.putAttachment(attachment(), blob('blob1', 'buffered'));
    expect(await (await store.getBlob('blob1'))!.text()).toBe('buffered');
  });

  it('writes the attachment and its blob together or not at all', async () => {
    const store = await IdbFilesStore.open({ factory: new IDBFactory() });
    // An attachment record that can't be cloned fails the whole transaction: the blob is not kept either.
    const bad = { ...attachment(), oops: () => 1 } as unknown as ReturnType<typeof attachment>;
    await expect(store.putAttachment(bad, blob('blob1'))).rejects.toBeTruthy();
    expect(await store.getBlob('blob1')).toBeNull();
    expect(await store.listAttachments()).toEqual([]);
  });

  it('closes and reports when another tab upgrades the database', async () => {
    const factory = new IDBFactory();
    let changed = 0;
    await IdbFilesStore.open({ factory, onVersionChange: () => changed++ });
    const { db } = await openDb(FILES_DB, 2, () => undefined, factory);
    expect(changed).toBe(1);
    db.close();
  });
});

describe('openDb', () => {
  it('reports a missing IndexedDB as unavailable', async () => {
    const g = globalThis as Record<string, unknown>;
    const prev = g['indexedDB'];
    delete g['indexedDB'];
    try {
      await expect(openDb('x', 1, () => undefined)).rejects.toBeInstanceOf(IdbUnavailableError);
    } finally {
      if (prev !== undefined) g['indexedDB'] = prev;
    }
  });

  it('reports a factory whose open throws SecurityError as unavailable', async () => {
    const factory = { open: () => { throw new DOMException('blocked', 'SecurityError'); } } as unknown as IDBFactory;
    await expect(openDb('x', 1, () => undefined, factory)).rejects.toBeInstanceOf(IdbUnavailableError);
  });

  it('gives up on a blocked open after a wait', async () => {
    const factory = new IDBFactory();
    const { db } = await openDb('x', 1, () => undefined, factory); // an old tab that never closes
    db.onversionchange = null;
    const t0 = Date.now();
    await expect(openDb('x', 2, () => undefined, factory)).rejects.toBeInstanceOf(IdbBlockedError);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(BLOCKED_WAIT_MS - 50);
    db.close();
  }, 10_000);
});

describe('MemoryFilesStore', () => {
  it('works like the IndexedDB store', async () => {
    const store = new MemoryFilesStore();
    await store.putAttachment(attachment(), blob('blob1'));
    await store.putAttachment(attachment({ id: 'att2', blobId: 'orphan' }), blob('orphan'));
    await store.putAttachment(attachment({ id: 'att2', blobId: null }));
    expect(await store.gcBlobs()).toBe(1);
    expect(await (await store.getBlob('blob1'))!.text()).toBe('hello');
    await store.deleteAttachment('att1');
    expect(await store.getBlob('blob1')).toBeNull();
    expect(store.kind).toBe('memory');
  });

  it('throws a quota error past quotaBytes and writes nothing', async () => {
    const store = new MemoryFilesStore({ quotaBytes: 8 });
    await store.putAttachment(attachment(), blob('blob1', 'hello'));
    const err = await store.putAttachment(attachment({ id: 'att2', blobId: 'blob2' }), blob('blob2', 'world')).catch(e => e);
    expect(err.name).toBe('QuotaExceededError');
    expect((await store.listAttachments()).map(a => a.id)).toEqual(['att1']);
    expect(await store.getBlob('blob2')).toBeNull();
  });
});
