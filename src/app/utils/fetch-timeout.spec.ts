import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, isAbortError } from './fetch-timeout';

/** A fetch whose body the test feeds by hand; the signal errors the stream like a real abort. */
function manualFetch() {
  let push!: (s: string) => void;
  let end!: () => void;
  const enc = new TextEncoder();
  const fn = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>(resolve => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: c => { ctl = c; } });
    init?.signal?.addEventListener('abort', () => { try { ctl.error(init.signal!.reason); } catch { /* closed */ } });
    push = s => ctl.enqueue(enc.encode(s));
    end = () => ctl.close();
    resolve(new Response(body, { status: 200 }));
  }));
  return { fn, push: (s: string) => push(s), end: () => end() };
}

describe('fetchWithTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('rejects like a network error when the headers take longer than the limit', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    }));
    const caught = fetchWithTimeout('x', {}, 5_000).catch(e => e);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(isAbortError(await caught)).toBe(true);
  });

  it('does not cut off a slow download that keeps moving (no total deadline)', async () => {
    const m = manualFetch();
    vi.stubGlobal('fetch', m.fn);
    const res = await fetchWithTimeout('x', {}, 10_000, 15_000);
    const text = res.text();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(10_000); // 100 s in all, a chunk every 10 s
      m.push(`${i},`);
    }
    m.end();
    expect(await text).toBe('0,1,2,3,4,5,6,7,8,9,');
  });

  it('aborts a body that stalls for 15 s, rejecting the read', async () => {
    const m = manualFetch();
    vi.stubGlobal('fetch', m.fn);
    const res = await fetchWithTimeout('x', {}, 10_000, 15_000);
    const caught = res.json().catch(e => e);
    m.push('{"a":');
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(isAbortError(await caught)).toBe(true);
  });

  it('keeps status, headers and a parsed body', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"ok":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const res = await fetchWithTimeout('x');
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it('passes through a response without a body and honours the caller\'s own signal', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    expect((await fetchWithTimeout('x')).status).toBe(204);
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', async (_u: unknown, init: RequestInit) => { seen = init.signal!; return new Response('x'); });
    const own = new AbortController();
    await fetchWithTimeout('x', { signal: own.signal });
    own.abort();
    expect(seen!.aborted).toBe(true);
  });

  it('isAbortError ignores other errors', () => {
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
