import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import {
  CHUNK_RELOAD_KEY, PwaUpdateService, clearChunkReloadFlag, isChunkLoadError, reloadOnChunkError,
} from './pwa-update.service';

function setup() {
  const versionUpdates = new Subject<VersionEvent>();
  const unrecoverable = new Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates, unrecoverable, checkForUpdate: vi.fn() } },
    ],
  });
  return { pwa: TestBed.inject(PwaUpdateService), versionUpdates, unrecoverable };
}

describe('PwaUpdateService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('turns ready on VERSION_READY and dismiss clears it', () => {
    const { pwa, versionUpdates } = setup();
    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    expect(pwa.ready()).toBe(true);
    pwa.dismiss();
    expect(pwa.ready()).toBe(false);
  });

  it('warns on VERSION_INSTALLATION_FAILED without raising ready', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pwa, versionUpdates } = setup();
    versionUpdates.next({ type: 'VERSION_INSTALLATION_FAILED', version: { hash: 'b' }, error: 'boom' });
    expect(warn).toHaveBeenCalled();
    expect(pwa.ready()).toBe(false);
  });

  it('dismissBroken clears only the repair prompt', () => {
    const { pwa, versionUpdates, unrecoverable } = setup();
    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'corrupt' });
    pwa.dismissBroken();
    expect(pwa.broken()).toBe(false);
    expect(pwa.ready()).toBe(true);
  });

  it('marks the worker broken on an unrecoverable state', () => {
    const { pwa, unrecoverable } = setup();
    expect(pwa.broken()).toBe(false);
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'corrupt' });
    expect(pwa.broken()).toBe(true);
    pwa.dismissBroken();
    expect(pwa.broken()).toBe(false);
  });
});

describe('chunk-load recovery', () => {
  afterEach(() => sessionStorage.clear());

  function fakeWin() {
    const assign = vi.fn();
    return { win: { sessionStorage, location: { assign } } as unknown as Window, assign };
  }

  it('recognises failed dynamic imports', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /chunk-ABC.js'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 7 failed'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot match any routes'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('loads the target once, blocks a second failure for it, and clears on its success', () => {
    const { win, assign } = fakeWin();
    const err = new TypeError('Failed to fetch dynamically imported module');
    expect(reloadOnChunkError(err, win, '/trips/t1')).toBe('reloaded');
    expect(assign).toHaveBeenCalledWith('/trips/t1');
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('/trips/t1');
    expect(reloadOnChunkError(err, win, '/trips/t1')).toBe('blocked');
    expect(assign).toHaveBeenCalledTimes(1);
    // A navigation that ends elsewhere does not clear the guard.
    clearChunkReloadFlag(win, '/saved');
    expect(reloadOnChunkError(err, win, '/trips/t1')).toBe('blocked');
    clearChunkReloadFlag(win, '/trips/t1');
    expect(reloadOnChunkError(err, win, '/trips/t1')).toBe('reloaded');
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it('does not reload for other errors', () => {
    const { win, assign } = fakeWin();
    expect(reloadOnChunkError(new Error('nope'), win, '/x')).toBe('ignored');
    expect(assign).not.toHaveBeenCalled();
  });
});
