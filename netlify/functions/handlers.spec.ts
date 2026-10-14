// Wiring of the three request handlers: method checks, cross-site refusal, validation, size limits,
// rate limit, the budget (503) paths and the happy paths. The Blobs stores and fetch are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Entry = { v: string; e: number };
const blobs = vi.hoisted(() => ({
  stores: new Map<string, Map<string, Entry>>(),
  seq: 0,
  /** Names of stores whose getStore() throws (Blobs not configured). */
  broken: new Set<string>(),
}));

vi.mock('@netlify/blobs', () => ({
  getStore: ({ name }: { name: string }) => {
    if (blobs.broken.has(name)) throw new Error('no blobs');
    const m = blobs.stores.get(name) ?? new Map<string, Entry>();
    blobs.stores.set(name, m);
    return {
      getWithMetadata: async (k: string) => { const x = m.get(k); return x ? { data: x.v, etag: String(x.e) } : null; },
      get: async (k: string) => m.get(k)?.v ?? null,
      set: async (k: string, v: string, o?: { onlyIfNew?: true; onlyIfMatch?: string }) => {
        const x = m.get(k);
        if (o?.onlyIfNew && x) return { modified: false };
        if (o?.onlyIfMatch !== undefined && (!x || String(x.e) !== o.onlyIfMatch)) return { modified: false };
        m.set(k, { v, e: ++blobs.seq });
        return { modified: true };
      },
      delete: async (k: string) => { m.delete(k); },
      list: async () => ({ blobs: [...m.keys()].map(key => ({ key })) }),
    };
  },
}));

import events from './events.mts';
import flightStatus from './flight-status.mts';
import group from './group.mts';
import { MAX_CIPHERTEXT } from './lib/group';

let ipSeq = 0;
/** A fresh client address per call, so the per-instance limiters never interfere between tests. */
const ctx = () => ({ ip: `10.0.0.${++ipSeq}` });
const BASE = 'https://app.test/.netlify/functions';
const get = (url: string, headers: Record<string, string> = {}, method = 'GET') => new Request(url, { method, headers });

beforeEach(() => {
  blobs.stores.clear();
  blobs.broken.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('group handler', () => {
  const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
  const TOKEN = 'tokentokentokentokentoken';
  const url = (id = ID) => `${BASE}/group?id=${id}`;
  const putBody = (over: Record<string, unknown> = {}) => JSON.stringify({ ciphertext: 'c'.repeat(40), iv: 'i'.repeat(16), baseVersion: 0, ...over });
  const put = (body: string, headers: Record<string, string> = { 'x-group-write': TOKEN }, id = ID) =>
    new Request(url(id), { method: 'PUT', headers, body });

  it('refuses cross-site requests and unsupported methods', async () => {
    expect((await group(get(url(), { 'sec-fetch-site': 'cross-site' }), ctx())).status).toBe(403);
    expect((await group(get(url(), {}, 'POST'), ctx())).status).toBe(405);
    expect((await group(get(url(), { 'sec-fetch-site': 'same-origin' }), ctx())).status).toBe(404);
  });

  it('rejects a bad id, bad tokens', async () => {
    expect((await group(get(`${BASE}/group?id=short`), ctx())).status).toBe(400);
    expect((await group(get(`${BASE}/group`), ctx())).status).toBe(400);
    expect((await group(put(putBody(), {}), ctx())).status).toBe(403);
    expect((await group(put(putBody(), { 'x-group-write': 'x' }), ctx())).status).toBe(403);
    expect((await group(put(putBody(), { 'x-group-write': TOKEN, 'x-group-owner': 'x' }), ctx())).status).toBe(403);
    expect((await group(get(url(), { 'x-group-write': TOKEN }, 'DELETE'), ctx())).status).toBe(404);
  });

  it('creates, reads, updates and deletes a group', async () => {
    const c = ctx();
    const created = await group(put(putBody(), { 'x-group-write': TOKEN, 'x-group-owner': 'o'.repeat(24) }), c);
    expect(created.status).toBe(200);
    expect(created.headers.get('Cache-Control')).toBe('no-store');
    expect((await created.json() as { version: number }).version).toBe(1);
    const read = await group(get(url()), c);
    expect(read.status).toBe(200);
    expect((await read.json() as { ciphertext: string }).ciphertext).toBe('c'.repeat(40));
    expect((await group(put(putBody({ baseVersion: 1 })), c)).status).toBe(200);
    // The group has an owner: the write token alone cannot delete it.
    expect((await group(get(url(), { 'x-group-write': TOKEN }, 'DELETE'), c)).status).toBe(403);
    expect((await group(get(url(), { 'x-group-write': TOKEN, 'x-group-owner': 'o'.repeat(24) }, 'DELETE'), c)).status).toBe(200);
    expect((await group(get(url()), c)).status).toBe(404);
  });

  it('refuses a body over the limit (declared or actual) and malformed JSON', async () => {
    const declared = new Request(url(), { method: 'PUT', headers: { 'x-group-write': TOKEN, 'content-length': String(MAX_CIPHERTEXT + 4096) }, body: '{}' });
    expect((await group(declared, ctx())).status).toBe(413);
    expect((await group(put('x'.repeat(MAX_CIPHERTEXT + 4096)), ctx())).status).toBe(413);
    expect((await group(put('{not json'), ctx())).status).toBe(400);
    expect((await group(put('{"ciphertext":1}'), ctx())).status).toBe(400);
  });

  it('rate limits reads (300 per 10 minutes), writes (30) and creates (5 per hour)', async () => {
    const reader = ctx();
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await group(get(url()), reader)).status;
    expect(last).toBe(429);

    const writer = ctx();
    for (let i = 0; i < 30; i++) await group(put(putBody({ baseVersion: 9 })), writer);
    expect((await group(put(putBody({ baseVersion: 9 })), writer)).status).toBe(429);

    const creator = ctx();
    const ids = Array.from({ length: 6 }, (_, i) => `${'B'.repeat(21)}${'ABCDEF'[i]}`);
    const statuses: number[] = [];
    for (const id of ids) statuses.push((await group(put(putBody(), { 'x-group-write': TOKEN }, id), creator)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('answers 503 when the daily create budget is spent, when Blobs is unavailable', async () => {
    vi.stubEnv('GROUP_DAILY_CREATES', '0');
    const r = await group(put(putBody()), ctx());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'budget' });

    vi.unstubAllEnvs();
    blobs.broken.add('groups-budget');
    expect((await group(put(putBody(), { 'x-group-write': TOKEN }, 'C'.repeat(22)), ctx())).status).toBe(503);

    blobs.broken.clear();
    blobs.broken.add('groups');
    expect((await group(get(url()), ctx())).status).toBe(503);
  });

  it('answers 503 when the store fails mid-request, without logging the cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    blobs.stores.set('groups', new Map([[ID, { v: '{}', e: 1 }]]));
    const bad = new Map<string, Entry>();
    bad.get = () => { throw new Error('secret detail'); };
    blobs.stores.set('groups', bad);
    expect((await group(get(url()), ctx())).status).toBe(503);
    expect(spy).toHaveBeenCalledWith('group failure:', 'Error');
  });
});

describe('flight-status handler', () => {
  const dep = () => new Date(Math.floor((Date.now() + 3_600_000) / 60_000) * 60_000).toISOString().slice(0, 16) + 'Z';
  const q = (over: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ident: 'AC834', origin: 'YVR', dep: dep(), ...over });
    return `${BASE}/flight-status?${p.toString()}`;
  };
  const flight = (over: Record<string, unknown> = {}) => ({
    flights: [{
      origin: { code_iata: 'YVR' }, scheduled_out: new Date(Date.parse(dep())).toISOString(), status: 'Scheduled', aircraft_type: 'B789', ...over,
    }],
  });
  const stubFetch = (body: unknown, ok = true) => {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
    vi.stubGlobal('fetch', f);
    return f;
  };

  beforeEach(() => vi.stubEnv('AEROAPI_KEY', 'KEY'));

  it('GET only, never cross-site', async () => {
    expect((await flightStatus(get(q(), {}, 'POST'), ctx())).status).toBe(405);
    expect((await flightStatus(get(q(), { 'sec-fetch-site': 'cross-site' }), ctx())).status).toBe(403);
  });

  it('503 not-configured without a key; 400 for bad parameters', async () => {
    vi.stubEnv('AEROAPI_KEY', '');
    expect(await (await flightStatus(get(q()), ctx())).json()).toEqual({ error: 'not-configured' });
    vi.stubEnv('AEROAPI_KEY', 'KEY');
    for (const bad of [{ ident: 'BA12' }, { origin: 'ZZZZ' }, { dep: '2020-01-01T00:00Z' }]) {
      expect((await flightStatus(get(q(bad)), ctx())).status).toBe(400);
    }
  });

  it('redirects a non-canonical query to the canonical one', async () => {
    const f = stubFetch(flight());
    const r = await flightStatus(get(q({ ident: 'ac834' })), ctx());
    expect(r.status).toBe(308);
    expect(r.headers.get('Location')).toContain('ident=AC834');
    expect(f).not.toHaveBeenCalled();
  });

  it('answers 503 budget when the limit is 0 or the store is unavailable, without calling upstream', async () => {
    const f = stubFetch(flight());
    vi.stubEnv('AEROAPI_DAILY_LIMIT', '0');
    const r = await flightStatus(get(q()), ctx());
    expect([r.status, await r.json()]).toEqual([503, { error: 'budget' }]);
    vi.unstubAllEnvs();
    vi.stubEnv('AEROAPI_KEY', 'KEY');
    blobs.broken.add('aeroapi-budget');
    expect((await flightStatus(get(q()), ctx())).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });

  it('rate limits cache misses per IP (10 per 10 minutes)', async () => {
    stubFetch(flight());
    const c = ctx();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await flightStatus(get(q()), c)).status);
    expect(statuses.slice(0, 10).every(s => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('returns the normalised flight, spends one call and sets cache headers', async () => {
    const f = stubFetch(flight());
    const r = await flightStatus(get(q()), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get('Netlify-CDN-Cache-Control')).toMatch(/^public, s-maxage=\d+/);
    expect(r.headers.get('Netlify-Vary')).toBe('query=ident|origin|dep');
    expect(await r.json()).toMatchObject({ ident: 'AC834', status: 'Scheduled', aircraft: 'B789', source: 'FlightAware' });
    expect(f).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(calledUrl).toContain('/flights/ACA834');
    expect(init.headers['x-apikey']).toBe('KEY');
    expect(blobs.stores.get('aeroapi-budget')!.get(`calls-${dayKey(Date.now())}`)!.v).toBe('1');
  });

  it('404 when no flight matches, 502 when upstream fails', async () => {
    stubFetch({ flights: [] });
    const nf = await flightStatus(get(q()), ctx());
    expect([nf.status, nf.headers.get('Netlify-CDN-Cache-Control')]).toEqual([404, 'public, s-maxage=120']);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch({}, false);
    const up = await flightStatus(get(q()), ctx());
    expect([up.status, up.headers.get('Netlify-CDN-Cache-Control')]).toEqual([502, 'public, s-maxage=60']);
  });

  it('looks up the inbound aircraft (second budget call) and caches it', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify(u.includes('fa_flight_id')
      ? { flights: [{ ident_iata: 'AC12', actual_on: '2026-10-06T10:00:00Z' }] }
      : flight({ inbound_fa_flight_id: 'ACA12-1' }))));
    vi.stubGlobal('fetch', f);
    const first = await (await flightStatus(get(q()), ctx())).json() as { inbound: { ident: string } | null };
    expect(first.inbound?.ident).toBe('AC12');
    expect(f).toHaveBeenCalledTimes(2);
    await flightStatus(get(q()), ctx());
    expect(f).toHaveBeenCalledTimes(3);
    expect(blobs.stores.get('aeroapi-budget')!.get(`calls-${dayKey(Date.now())}`)!.v).toBe('3');
  });
});

describe('events handler', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const q = (over: Record<string, string> = {}) => `${BASE}/events?${new URLSearchParams({ code: 'LIS', from: day(1), to: day(2), ...over })}`;

  beforeEach(() => vi.stubEnv('TICKETMASTER_KEY', 'TK'));

  it('GET only, never cross-site', async () => {
    expect((await events(get(q(), {}, 'PUT'), ctx())).status).toBe(405);
    expect((await events(get(q(), { 'sec-fetch-site': 'cross-site' }), ctx())).status).toBe(403);
  });

  it('503 not-configured without a key; 400 for a bad code or window', async () => {
    vi.stubEnv('TICKETMASTER_KEY', '');
    expect((await events(get(q()), ctx())).status).toBe(503);
    vi.stubEnv('TICKETMASTER_KEY', 'TK');
    expect((await events(get(q({ code: 'XX' })), ctx())).status).toBe(400);
    expect((await events(get(q({ to: day(30) })), ctx())).status).toBe(400);
  });

  it('503 budget when the daily limit is 0 or Blobs is unavailable; no upstream call', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.stubEnv('TICKETMASTER_DAILY_LIMIT', '0');
    expect(await (await events(get(q()), ctx())).json()).toEqual({ error: 'budget' });
    vi.unstubAllEnvs();
    vi.stubEnv('TICKETMASTER_KEY', 'TK');
    blobs.broken.add('ticketmaster-budget');
    expect((await events(get(q()), ctx())).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });

  it('429 after 10 misses from one IP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}))));
    const c = ctx();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await events(get(q()), c)).status;
    expect(last).toBe(429);
  });

  it('proxies Ticketmaster and sets a 6 hour CDN lifetime', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ _embedded: { events: [] } })));
    vi.stubGlobal('fetch', f);
    const r = await events(get(q()), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get('Netlify-CDN-Cache-Control')).toContain('s-maxage=21600');
    expect(r.headers.get('Netlify-Vary')).toBe('query=code|from|to');
    expect(await r.json()).toMatchObject({ events: [], source: 'Ticketmaster' });
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('apikey=TK');
  });

  it('502 on upstream failure, and the key never reaches the log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom https://x/?apikey=TK&a=b'); }));
    const r = await events(get(q()), ctx());
    expect(r.status).toBe(502);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('apikey=TK');
  });
});
