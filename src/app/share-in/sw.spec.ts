import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Handler = (e: Record<string, unknown>) => void;

/** Runs public/sw.js against a fake worker scope; returns its listeners and fakes. */
function boot(opts: { schedules?: unknown } = {}) {
  const src = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const handlers: Record<string, Handler[]> = {};
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      const m = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, m);
      return {
        put: async (k: string | Request, r: Response) => void m.set(typeof k === 'string' ? k : new URL(k.url).pathname, r),
        match: async (k: string | Request) => m.get(typeof k === 'string' ? k : new URL((k as Request).url).pathname)?.clone(),
        keys: async () => [...m.keys()].map(k => new Request('https://app.test' + k)),
        delete: async (k: string | Request) => m.delete(typeof k === 'string' ? k : new URL(k.url).pathname),
      };
    },
  };
  const shown: { title: string; opts: { data: unknown } }[] = [];
  const posted: unknown[] = [];
  let windows: { postMessage(m: unknown): void }[] = [];
  const importScripts = vi.fn();
  const self = {
    location: { href: 'https://app.test/sw.js' },
    addEventListener: (t: string, h: Handler) => void (handlers[t] ??= []).push(h),
    registration: { showNotification: async (title: string, o: { data: unknown }) => void shown.push({ title, opts: o }) },
    clients: { matchAll: async () => windows, openWindow: vi.fn() },
  };
  const fetchFake = async () => new Response(JSON.stringify(opts.schedules ?? { meta: { generatedAt: 'B' } }));
  runInNewContext(src, { self, caches, importScripts, Response, URL, Date, Math, JSON, fetch: fetchFake, Promise });
  return {
    handlers, importScripts, shown, posted, stores,
    setWindows: (n: number) => { windows = Array.from({ length: n }, () => ({ postMessage: (m: unknown) => void posted.push(m) })); },
    async fire(type: string, e: Record<string, unknown>) {
      const waits: Promise<unknown>[] = [];
      const ev = { ...e, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<unknown>) => void waits.push(p), stopImmediatePropagation: vi.fn() };
      handlers[type]?.forEach(h => h(ev));
      return { ev, results: await Promise.all(waits) };
    },
  };
}

describe('public/sw.js', () => {
  it('loads ngsw-worker.js last, after registering its own listeners', () => {
    const sw = boot();
    expect(sw.importScripts).toHaveBeenCalledWith('./ngsw-worker.js');
    expect(Object.keys(sw.handlers).sort()).toEqual(['fetch', 'message', 'notificationclick', 'periodicsync']);
  });

  it('answers a share POST with a 303 to /share-in?id= and stashes the files and text', async () => {
    const sw = boot();
    const form = new FormData();
    form.append('title', 'Hotel');
    form.append('text', 'Room 12');
    form.append('files', new File(['pdf'], 'a.pdf', { type: 'application/pdf' }));
    const { ev, results } = await sw.fire('fetch', { request: { method: 'POST', url: 'https://app.test/share-in', formData: async () => form } });
    expect(ev.stopImmediatePropagation).toHaveBeenCalled();
    const res = results[0] as Response;
    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    const id = /\/share-in\?id=([a-z0-9]+)$/.exec(loc)?.[1];
    expect(id).toBeTruthy();
    const store = sw.stores.get('ac-share-in')!;
    const meta = JSON.parse(await store.get(`/__share/${id}/meta.json`)!.text());
    expect(meta).toMatchObject({ title: 'Hotel', text: 'Room 12', files: [{ name: 'a.pdf', type: 'application/pdf' }] });
    expect(store.has(`/__share/${id}/0`)).toBe(true);
  });

  it('leaves every other request to ngsw', async () => {
    const sw = boot();
    const get = await sw.fire('fetch', { request: { method: 'GET', url: 'https://app.test/share-in' } });
    const other = await sw.fire('fetch', { request: { method: 'POST', url: 'https://app.test/api' } });
    expect(get.ev.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(other.ev.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('does not notify on the first check or when nothing changed', async () => {
    const sw = boot();
    await sw.fire('periodicsync', { tag: 'schedule-check' });
    expect(sw.shown).toHaveLength(0);
    await sw.fire('periodicsync', { tag: 'schedule-check' });
    expect(sw.shown).toHaveLength(0);
  });

  it('notifies when generatedAt changed and no window is open', async () => {
    const sw = boot();
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
    await sw.fire('periodicsync', { tag: 'schedule-check' });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe('Schedules updated');
    expect(sw.shown[0].opts.data).toEqual({ url: '/trips' });
  });

  it('tells an open window instead of notifying', async () => {
    const sw = boot();
    sw.setWindows(1);
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
    await sw.fire('periodicsync', { tag: 'schedule-check' });
    expect(sw.shown).toHaveLength(0);
    expect(sw.posted).toEqual([{ type: 'ac:schedules-updated', generatedAt: 'B' }]);
  });

  it('ignores other sync tags', async () => {
    const sw = boot();
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
    await sw.fire('periodicsync', { tag: 'other' });
    expect(sw.shown).toHaveLength(0);
  });
});
