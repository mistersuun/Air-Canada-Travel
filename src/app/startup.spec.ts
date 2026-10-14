import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startupLoad } from './startup';

function fakeState() {
  return { reportDataLoad: vi.fn(), reportDataPending: vi.fn(), reloadPage: vi.fn() };
}

describe('startupLoad', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the result when the data arrives within the budget', async () => {
    const s = fakeState();
    const onLoaded = vi.fn();
    const p = startupLoad(s, Promise.resolve(true), Promise.resolve(), onLoaded, 8000);
    await p;
    expect(s.reportDataLoad).toHaveBeenCalledWith(true);
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(s.reportDataPending).not.toHaveBeenCalled();
    expect(s.reloadPage).not.toHaveBeenCalled();
  });

  it('lets the app render after the budget and reloads on a late success', async () => {
    const s = fakeState();
    const onLoaded = vi.fn();
    let finish!: (ok: boolean) => void;
    const slow = new Promise<boolean>(r => { finish = r; });
    let rendered = false;
    void startupLoad(s, slow, Promise.resolve(), onLoaded, 8000).then(() => { rendered = true; });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(rendered).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(rendered).toBe(true);
    expect(s.reportDataPending).toHaveBeenCalledOnce();
    expect(s.reportDataLoad).not.toHaveBeenCalled();
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.reportDataLoad).toHaveBeenCalledWith(true);
    expect(s.reloadPage).toHaveBeenCalledOnce();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('a late failure reports failed (Retry banner) without reloading', async () => {
    const s = fakeState();
    let finish!: (ok: boolean) => void;
    const slow = new Promise<boolean>(r => { finish = r; });
    void startupLoad(s, slow, Promise.resolve(), vi.fn(), 8000);
    await vi.advanceTimersByTimeAsync(8_001);
    finish(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.reportDataLoad).toHaveBeenCalledWith(false);
    expect(s.reloadPage).not.toHaveBeenCalled();
  });

  it('a slow rest (photos) alone also does not block the render', async () => {
    const s = fakeState();
    const rest = new Promise<void>(() => { /* never settles */ });
    let rendered = false;
    void startupLoad(s, Promise.resolve(true), rest, vi.fn(), 8000).then(() => { rendered = true; });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(rendered).toBe(true);
  });
});
