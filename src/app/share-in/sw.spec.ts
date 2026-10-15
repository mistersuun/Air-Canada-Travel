import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Handler = (e: Record<string, unknown>) => void;

/** Runs public/sw.js against a fake worker scope; returns its listeners and fakes. */
function boot(opts: { schedules?: unknown; meta?: unknown; failCaches?: boolean } = {}) {
  const src = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const handlers: Record<string, Handler[]> = {};
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      if (opts.failCaches && name === 'ac-sched-check') throw new Error('storage');
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
    location: { href: 'https://app.test/sw.js', origin: 'https://app.test' },
    addEventListener: (t: string, h: Handler) => void (handlers[t] ??= []).push(h),
    registration: { showNotification: async (title: string, o: { data: unknown }) => void shown.push({ title, opts: o }) },
    clients: { matchAll: async () => windows, openWindow: vi.fn() },
  };
  const fetched: string[] = [];
  const fetchFake = async (u: string) => {
    fetched.push(u);
    if (u.endsWith('schedules-meta.json')) return opts.meta === undefined ? new Response('nope', { status: 404 }) : new Response(JSON.stringify(opts.meta));
    return new Response(JSON.stringify(opts.schedules ?? { meta: { generatedAt: 'B' } }));
  };
  runInNewContext(src, { self, caches, importScripts, Response, URL, Date, Math, JSON, Number, parseInt, isFinite, fetch: fetchFake, Promise });
  return {
    fetched, handlers, importScripts, shown, posted, stores,
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
    const { ev, results } = await sw.fire('fetch', { request: { method: 'POST', mode: 'navigate', referrer: 'https://app.test/', url: 'https://app.test/share-in', formData: async () => form } });
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

  it('refuses cross-origin, non-navigation and foreign-referrer posts', async () => {
    const sw = boot();
    const base = { method: 'POST', mode: 'navigate', referrer: '', url: 'https://app.test/share-in', formData: async () => new FormData() };
    for (const r of [{ ...base, url: 'https://evil.test/share-in' }, { ...base, mode: 'cors' }, { ...base, referrer: 'https://evil.test/x' }]) {
      const { ev } = await sw.fire('fetch', { request: r });
      expect(ev.stopImmediatePropagation).not.toHaveBeenCalled();
    }
  });

  it('redirects an oversized share to ?id=too-large without stashing files', async () => {
    const sw = boot();
    const form = new FormData();
    for (let i = 0; i < 6; i++) form.append('files', new File(['x'], `f${i}.png`, { type: 'image/png' }));
    const { results } = await sw.fire('fetch', { request: { method: 'POST', mode: 'navigate', referrer: '', url: 'https://app.test/share-in', formData: async () => form } });
    expect((results[0] as Response).headers.get('location')).toBe('https://app.test/share-in?id=too-large');
    expect(sw.stores.get('ac-share-in')?.size ?? 0).toBe(0);
  });

  it('never moves the seen value backwards', async () => {
    const sw = boot();
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'C' } });
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
    await sw.fire('periodicsync', { tag: 'schedule-check' }); // server has B < C
    expect(sw.shown).toHaveLength(0);
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

  it('shows the wording the page last posted, English until then', async () => {
    const sw = boot();
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
    await sw.fire('message', { data: { type: 'ac:notify-text', title: 'Horaires mis à jour', body: 'Ouvrez pour vérifier vos voyages.' } });
    await sw.fire('periodicsync', { tag: 'schedule-check' });
    expect(sw.shown[0].title).toBe('Horaires mis à jour');
    expect(sw.shown[0].opts.body).toBe('Ouvrez pour vérifier vos voyages.');
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

  it('checks the tiny meta file, not the 2 MB schedules, when it exists', async () => {
    const sw = boot({ meta: { generatedAt: 'B' } });
    await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
    await sw.fire('periodicsync', { tag: 'schedule-check' });
    expect(sw.fetched).toEqual(['/data/schedules-meta.json']);
    expect(sw.shown).toHaveLength(1);
  });

  it('falls back to schedules.json when the meta file is missing or has no generatedAt', async () => {
    for (const meta of [undefined, { nothing: 1 }]) {
      const sw = boot({ meta });
      await sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } });
      await sw.fire('periodicsync', { tag: 'schedule-check' });
      expect(sw.fetched).toContain('/data/schedules.json');
      expect(sw.shown).toHaveLength(1);
    }
  });

  it('refuses a share whose Content-Length is over 25 MB without reading the body', async () => {
    const sw = boot();
    const formData = vi.fn(async () => new FormData());
    const { results } = await sw.fire('fetch', { request: { method: 'POST', mode: 'navigate', referrer: '', url: 'https://app.test/share-in', headers: new Headers({ 'content-length': String(26 * 1024 * 1024) }), formData } });
    expect((results[0] as Response).headers.get('location')).toBe('https://app.test/share-in?id=too-large');
    expect(formData).not.toHaveBeenCalled();
  });

  it('reads the body when Content-Length is absent or small', async () => {
    const sw = boot();
    const formData = vi.fn(async () => { const f = new FormData(); f.append('text', 'hi'); return f; });
    const { results } = await sw.fire('fetch', { request: { method: 'POST', mode: 'navigate', referrer: '', url: 'https://app.test/share-in', headers: new Headers({ 'content-length': '1200' }), formData } });
    expect(formData).toHaveBeenCalled();
    expect((results[0] as Response).headers.get('location')).toMatch(/\/share-in\?id=[a-z0-9]+$/);
  });

  it('purges files left without a meta.json once they are 5 minutes old, and keeps fresh ones', async () => {
    const sw = boot();
    const old = (Date.now() - 10 * 60_000).toString(36) + 'abcdef';
    const fresh = Date.now().toString(36) + 'ghijkl';
    const cache = new Map<string, Response>();
    sw.stores.set('ac-share-in', cache);
    for (const id of [old, fresh]) cache.set(`/__share/${id}/0`, new Response('x'));
    const form = new FormData();
    form.append('text', 'hi');
    await sw.fire('fetch', { request: { method: 'POST', mode: 'navigate', referrer: '', url: 'https://app.test/share-in', formData: async () => form } });
    expect(cache.has(`/__share/${old}/0`)).toBe(false);
    expect(cache.has(`/__share/${fresh}/0`)).toBe(true);
  });

  it('a failing storage write in the message handler does not reject', async () => {
    const sw = boot({ failCaches: true });
    await expect(sw.fire('message', { data: { type: 'ac:schedules-seen', generatedAt: 'A' } })).resolves.toBeTruthy();
  });
});
