import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FilesDb } from './files-db';
import { FILES_STORE, MemoryFilesStore, type FilesStore, type FilesStoreOpener } from './files-store';

function setup(opener: FilesStoreOpener) {
  TestBed.configureTestingModule({ providers: [{ provide: FILES_STORE, useValue: opener }] });
  return TestBed.inject(FilesDb);
}

describe('FilesDb', () => {
  it('opens once and shares the store', async () => {
    const opener = vi.fn(async () => new MemoryFilesStore() as FilesStore);
    const db = setup(opener);
    const [a, b] = await Promise.all([db.store(), db.store()]);
    expect(a).toBe(b);
    expect(opener).toHaveBeenCalledOnce();
    expect(db.status()).toBe('memory');
  });

  it('does not cache a failed open forever: the next call tries again', async () => {
    let fail = true;
    const opener = vi.fn(async () => {
      if (fail) throw new Error('blocked');
      return new MemoryFilesStore() as FilesStore;
    });
    const db = setup(opener);
    expect(await db.store()).toBeNull();
    expect(db.status()).toBe('error');
    fail = false;
    expect(await db.store()).not.toBeNull();
    expect(opener).toHaveBeenCalledTimes(2);
    expect(db.status()).toBe('memory');
  });

  it('opens a new connection after the browser closes the old one', async () => {
    const hooks: { onClose?: () => void }[] = [];
    const opener = vi.fn(async (h: { onVersionChange: () => void; onClose?: () => void }) => {
      hooks.push(h);
      return new MemoryFilesStore() as FilesStore;
    });
    const db = setup(opener);
    const first = await db.store();
    expect(await db.store()).toBe(first);
    hooks[0].onClose!();
    expect(db.status()).toBe('idle');
    const second = await db.store();
    expect(second).not.toBe(first);
    expect(opener).toHaveBeenCalledTimes(2);
    // A late close of the old connection does not discard the new one.
    hooks[0].onClose!();
    expect(await db.store()).toBe(second);
  });
});
