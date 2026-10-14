import { NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LATE_RELOAD_KEY, createReloadGuard, startupLoad, type ReloadGuard } from './startup';

function fakeState() {
  return { reportDataLoad: vi.fn(), reportDataPending: vi.fn(), reportDataReady: vi.fn(), reloadPage: vi.fn() };
}
const allow: ReloadGuard = { allowed: () => true };
const deny: ReloadGuard = { allowed: () => false };

describe('startupLoad', () => {
  beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it('resolves with the result when the data arrives within the budget', async () => {
    const s = fakeState();
    const onLoaded = vi.fn();
    await startupLoad(s, Promise.resolve(true), Promise.resolve(), onLoaded, allow, document, 8000);
    expect(s.reportDataLoad).toHaveBeenCalledWith(true);
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(s.reportDataPending).not.toHaveBeenCalled();
    expect(s.reloadPage).not.toHaveBeenCalled();
  });

  it('renders after the budget; a late success reloads once when the guard allows', async () => {
    const s = fakeState();
    const onLoaded = vi.fn();
    let finish!: (ok: boolean) => void;
    const slow = new Promise<boolean>(r => { finish = r; });
    let rendered = false;
    void startupLoad(s, slow, Promise.resolve(), onLoaded, allow, document, 8000).then(() => { rendered = true; });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(rendered).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(rendered).toBe(true);
    expect(s.reportDataPending).toHaveBeenCalledOnce();
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.reportDataLoad).toHaveBeenCalledWith(true);
    expect(s.reloadPage).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(LATE_RELOAD_KEY)).toBe('1');
  });

  it('does not reload when the user has been active: it says "ready" instead', async () => {
    const s = fakeState();
    let finish!: (ok: boolean) => void;
    void startupLoad(s, new Promise<boolean>(r => { finish = r; }), Promise.resolve(), vi.fn(), deny, document, 8000);
    await vi.advanceTimersByTimeAsync(8_001);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.reloadPage).not.toHaveBeenCalled();
    expect(s.reportDataReady).toHaveBeenCalledOnce();
  });

  it('reloads for late data only once per tab session', async () => {
    sessionStorage.setItem(LATE_RELOAD_KEY, '1');
    const s = fakeState();
    let finish!: (ok: boolean) => void;
    void startupLoad(s, new Promise<boolean>(r => { finish = r; }), Promise.resolve(), vi.fn(), allow, document, 8000);
    await vi.advanceTimersByTimeAsync(8_001);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.reloadPage).not.toHaveBeenCalled();
    expect(s.reportDataReady).toHaveBeenCalledOnce();
  });

  it('a late failure reports failed (Retry banner) without reloading', async () => {
    const s = fakeState();
    let finish!: (ok: boolean) => void;
    void startupLoad(s, new Promise<boolean>(r => { finish = r; }), Promise.resolve(), vi.fn(), allow, document, 8000);
    await vi.advanceTimersByTimeAsync(8_001);
    finish(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.reportDataLoad).toHaveBeenCalledWith(false);
    expect(s.reloadPage).not.toHaveBeenCalled();
  });

  it('a slow route network also holds the render only until the budget', async () => {
    const s = fakeState();
    let rendered = false;
    void startupLoad(s, Promise.resolve(true), new Promise(() => undefined), vi.fn(), allow, document, 8000).then(() => { rendered = true; });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(rendered).toBe(true);
  });
});

describe('createReloadGuard', () => {
  function setup(url = '/') {
    const events = new Subject<unknown>();
    const router = { events, url } as never;
    const guard = createReloadGuard(document, router);
    const end = () => events.next(new NavigationEnd(1, '/', '/'));
    return { guard, end, router: router as { url: string } };
  }
  afterEach(() => { document.body.innerHTML = ''; });

  it('allows a reload for an untouched first page', () => {
    const { guard, end } = setup();
    end();
    expect(guard.allowed()).toBe(true);
  });

  it('refuses after a tap or key, or a second navigation', () => {
    const a = setup();
    document.dispatchEvent(new Event('pointerdown'));
    expect(a.guard.allowed()).toBe(false);
    const b = setup();
    document.dispatchEvent(new Event('keydown'));
    expect(b.guard.allowed()).toBe(false);
    const c = setup();
    c.end();
    c.end();
    expect(c.guard.allowed()).toBe(false);
  });

  it('refuses on pages that hold a reload, with a field focused, or with a dialog open', () => {
    expect(setup('/g/abc?x=1').guard.allowed()).toBe(false);
    expect(setup('/trips/import#t=1').guard.allowed()).toBe(false);
    const { guard } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(guard.allowed()).toBe(false);
    input.remove();
    const d = document.createElement('dialog');
    d.setAttribute('open', '');
    document.body.appendChild(d);
    expect(guard.allowed()).toBe(false);
  });
});
