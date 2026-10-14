import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import {
  CHUNK_RELOAD_KEY, PwaUpdateService, clearChunkReloadFlag, holdsReload, isChunkLoadError, reloadOnChunkError,
} from './pwa-update.service';

function setup() {
  const activateUpdate = vi.fn(() => Promise.resolve(true));
  const versionUpdates = new Subject<VersionEvent>();
  const unrecoverable = new Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates, unrecoverable, checkForUpdate: vi.fn(), activateUpdate } },
    ],
  });
  return { activateUpdate, pwa: TestBed.inject(PwaUpdateService), versionUpdates, unrecoverable };
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

describe('reload on resume', () => {
  const ready = (v: Subject<VersionEvent>) => v.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
  const hidden = (state: DocumentVisibilityState) => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  afterEach(() => vi.restoreAllMocks());

  it('reloads on the next resume when the version arrived while hidden, activating first', async () => {
    hidden('hidden');
    const { pwa, versionUpdates, activateUpdate } = setup();
    const order: string[] = [];
    activateUpdate.mockImplementation(() => { order.push('activate'); return Promise.resolve(true); });
    const reload = vi.fn(() => order.push('reload'));
    vi.spyOn(document, 'defaultView', 'get').mockReturnValue({ location: { reload } } as unknown as Window);
    ready(versionUpdates);
    expect(pwa.reloadOnResume('/saved')).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['activate', 'reload']);
  });

  it('reloads on resume after the app is hidden while an update waits', () => {
    const { pwa, versionUpdates } = setup();
    const reload = vi.spyOn(pwa, 'reload').mockImplementation(() => undefined);
    ready(versionUpdates);
    expect(pwa.reloadOnResume('/saved')).toBe(false); // was never hidden
    pwa.noteHidden();
    expect(pwa.reloadOnResume('/saved')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload without an update, on form pages, or in a focused field', () => {
    const { pwa, versionUpdates } = setup();
    const reload = vi.spyOn(pwa, 'reload').mockImplementation(() => undefined);
    pwa.noteHidden();
    expect(pwa.reloadOnResume('/saved')).toBe(false);
    ready(versionUpdates);
    pwa.noteHidden();
    expect(pwa.reloadOnResume('/trips/t1/passes/add')).toBe(false);
    expect(pwa.reloadOnResume('/g/abc')).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(pwa.reloadOnResume('/saved')).toBe(false);
    input.remove();
    expect(reload).not.toHaveBeenCalled();
    expect(pwa.reloadOnResume('/saved')).toBe(true);
  });

  it('holdsReload covers pass views, the add flow, group links and imports', () => {
    for (const p of ['/trips/t1/pass/p1', '/trips/t1/passes/add', '/g/x', '/trips/import', '/share-in']) expect(holdsReload(p)).toBe(true);
    expect(holdsReload('/trips/t1')).toBe(false);
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
