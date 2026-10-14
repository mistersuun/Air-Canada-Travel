import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, isAbortError } from './fetch-timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes a signal that aborts after the timeout, rejecting like a network error', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_res, rej) => {
        init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
      }));
      const caught = fetchWithTimeout('x', {}, 5_000).catch(e => e);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(isAbortError(await caught)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves normally when the response is quick', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}'));
    expect((await fetchWithTimeout('x')).ok).toBe(true);
  });

  it('isAbortError ignores other errors', () => {
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
