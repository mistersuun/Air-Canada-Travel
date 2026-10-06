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

  it('marks the worker broken on an unrecoverable state', () => {
    const { pwa, unrecoverable } = setup();
    expect(pwa.broken()).toBe(false);
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'corrupt' });
    expect(pwa.broken()).toBe(true);
    pwa.dismiss();
    expect(pwa.broken()).toBe(false);
  });
});

describe('chunk-load recovery', () => {
  afterEach(() => sessionStorage.clear());

  function fakeWin() {
    const reload = vi.fn();
    return { win: { sessionStorage, location: { reload } } as unknown as Window, reload };
  }

  it('recognises failed dynamic imports', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /chunk-ABC.js'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 7 failed'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot match any routes'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('reloads once, then leaves the error alone until a navigation succeeds', () => {
    const { win, reload } = fakeWin();
    const err = new TypeError('Failed to fetch dynamically imported module');
    expect(reloadOnChunkError(err, win)).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1');
    expect(reloadOnChunkError(err, win)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    clearChunkReloadFlag(win);
    expect(reloadOnChunkError(err, win)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload for other errors', () => {
    const { win, reload } = fakeWin();
    expect(reloadOnChunkError(new Error('nope'), win)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
