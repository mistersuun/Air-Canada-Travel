/**
 * Test helpers for the files and passes services (not part of the app
 * bundle unless imported). Specs run under jsdom, whose Blob has no
 * arrayBuffer() and does not survive structuredClone; useNodeBlobs() swaps in
 * Node's Blob and File so stores behave like a browser's.
 */
import { IDBFactory } from 'fake-indexeddb';
import { FILES_STORE, FilesStore, IdbFilesStore, MemoryFilesStore } from '../files-store';
import type { Attachment } from '../model';

/** Installs Node's Blob/File as globals; call the returned function to restore jsdom's. */
export function useNodeBlobs(): () => void {
  const g = globalThis as Record<string, unknown>;
  // Node's own Blob/File (getBuiltinModule keeps node types out of the app's tsconfig).
  const { Blob: NodeBlob, File: NodeFile } = (g['process'] as { getBuiltinModule(id: string): { Blob: unknown; File: unknown } })
    .getBuiltinModule('node:buffer');
  const prev = { Blob: g['Blob'], File: g['File'] };
  g['Blob'] = NodeBlob;
  g['File'] = NodeFile;
  return () => {
    g['Blob'] = prev.Blob;
    g['File'] = prev.File;
  };
}

/** A FILES_STORE provider that always hands out `store`. */
export function provideFilesStore(store: FilesStore) {
  return { provide: FILES_STORE, useValue: async () => store };
}

/** A FILES_STORE provider over a fresh fake IndexedDB (or the given factory). */
export function provideFakeIdb(factory: IDBFactory = new IDBFactory()) {
  return {
    provide: FILES_STORE,
    useValue: async (hooks: { onVersionChange: () => void }) => IdbFilesStore.open({ factory, onVersionChange: hooks.onVersionChange }),
  };
}

export { IDBFactory as FakeIDBFactory, MemoryFilesStore };

/** A text file of `bytes` bytes. */
export function textFile(name: string, bytes: number, type = 'application/pdf'): File {
  return new (globalThis as unknown as { File: typeof File }).File(['x'.repeat(bytes)], name, { type });
}

/** A minimal attachment for store specs. */
export function attachment(over: Partial<Attachment> = {}): Attachment {
  return {
    v: 1, id: 'att1', tripId: 'sevtrip001', scope: { kind: 'trip' }, kind: 'pdf', title: 'Hotel', text: null,
    blobId: 'blob1', thumbBlobId: null, mime: 'application/pdf', bytes: 5, pages: null,
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', ...over,
  };
}
