import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { deleteGroup, getGroup, parsePutBody, putGroup, type GroupStore } from '../../../netlify/functions/lib/group';
import { PROFILE_STORAGE } from '../recs/profile.service';
import { NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { TRIPS_KEY } from '../trips/model';
import { TRIPS_STORAGE } from '../trips/storage';
import { SEVILLE_TRIPS_FILE } from '../trips/testing/seville-fixture';
import { parseGroupFragment } from './group-crypto';
import { parseGroupDoc } from './group-doc';
import { GroupService } from './group.service';

const NOW_MS = Date.parse('2026-10-01T13:41:00Z');

/** Netlify Blobs stand-in with ETags. */
function memory(): GroupStore & { m: Map<string, { v: string; e: number }> } {
  const m = new Map<string, { v: string; e: number }>();
  let seq = 0;
  return {
    m,
    getWithMetadata: async k => { await Promise.resolve(); const x = m.get(k); return x ? { data: x.v, etag: String(x.e) } : null; },
    set: async (k, v, o) => {
      await Promise.resolve();
      const x = m.get(k);
      if ('onlyIfNew' in o && x) return { modified: false };
      if ('onlyIfMatch' in o && (!x || String(x.e) !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { v, e: ++seq });
      return { modified: true };
    },
    delete: async k => { m.delete(k); },
    list: async () => ({ blobs: [...m.keys()].map(key => ({ key })) }),
  };
}

/** A fetch that runs the real server logic over the fake store; records what it was sent. */
function serverFetch(store: GroupStore, sent: { url: string; init: RequestInit }[]) {
  return vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const id = new URL(url, 'http://x').searchParams.get('id')!;
    const headers = init.headers as Record<string, string>;
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (init.method === 'GET') { const r = await getGroup(store, id, Date.now()); return reply(r.status, r.body); }
    if (init.method === 'DELETE') { const r = await deleteGroup(store, id, headers['X-Group-Write']); return reply(r.status, r.body); }
    const body = parsePutBody(JSON.parse(init.body as string));
    if (!body) return reply(400, { error: 'bad-request' });
    const r = await putGroup(store, id, headers['X-Group-Write'], body, Date.now());
    return reply(r.status, r.body);
  });
}

describe('GroupService (client against the real server logic)', () => {
  let store: ReturnType<typeof memory>;
  let sent: { url: string; init: RequestInit }[];
  let svc: GroupService;
  const trip = SEVILLE_TRIPS_FILE.trips[0];

  beforeEach(() => {
    store = memory();
    sent = [];
    vi.stubGlobal('fetch', serverFetch(store, sent));
    const storage = new MemoryStorage();
    storage.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => NOW_MS },
        { provide: TRIPS_STORAGE, useValue: storage },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: PROFILE_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    svc = TestBed.inject(GroupService);
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('creates a group: the server holds only ciphertext, never the key, the plan text or the token', async () => {
    const r = await svc.create(trip, '  Ana  ', NOW_MS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raw = [...store.m.values()][0].v;
    for (const secret of [r.record.key, r.record.write!, 'Ana', trip.name]) expect(raw).not.toContain(secret);
    for (const s of sent) {
      expect(s.url).not.toContain(r.record.key);
      expect(String(s.init.body ?? '')).not.toContain(r.record.key);
    }
    expect(sent[0].init.credentials).toBe('omit');
    expect(svc.forTrip(trip.id)?.id).toBe(r.record.id);
    const link = parseGroupFragment(r.record.id, svc.urlOf(svc.linkOf(r.record)).split('#')[1]);
    expect(link).toEqual({ id: r.record.id, key: r.record.key, write: r.record.write });
  });

  it('a member opens the link, sees the plan and statuses, and the owner sees their update', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    const link = svc.linkOf(created.record);
    const opened = await svc.load(link);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await svc.previewOf(opened.doc))?.trip.name).toBe(trip.name);
    expect(Object.values(opened.doc.members).map(x => x.name)).toEqual(['Ana']);
    // The wire doc carries no standby/PNR/load fields.
    expect(JSON.stringify(opened.doc)).not.toMatch(/pnr|listed|loads?"/i);

    const ben = svc.withMember(opened.doc, svc.newMember(), { name: 'Ben', planLabel: 'Bus to YUL', arrival: '2026-10-07T20:00:00.000Z' }, NOW_MS + 1000);
    const saved = await svc.save(link, ben, opened.version);
    expect(saved.ok && saved.version).toBe(2);
    const again = await svc.load(link);
    expect(again.ok && Object.values(again.doc.members).map(x => x.name).sort()).toEqual(['Ana', 'Ben']);
  });

  it('a view-only link can read but not write', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    const viewer = svc.linkOf(created.record, true);
    const opened = await svc.load(viewer);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await svc.save(viewer, opened.doc, opened.version)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await svc.stop(viewer)).toBe(false);
  });

  it('on a 409 it re-fetches, merges member entries by updatedAt and retries', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    const link = svc.linkOf(created.record);
    const base = await svc.load(link);
    if (!base.ok) throw new Error('load failed');
    // Two members start from version 1; Ben writes first.
    const ben = svc.withMember(base.doc, 'benbenben1', { name: 'Ben', planLabel: 'On AC834' }, NOW_MS + 1000);
    const cy = svc.withMember(base.doc, 'cycycycy12', { name: 'Cy', planLabel: 'Plan B: AC836' }, NOW_MS + 2000);
    expect((await svc.save(link, ben, base.version)).ok).toBe(true);
    const merged = await svc.save(link, cy, base.version);
    expect(merged.ok && merged.version).toBe(3);
    const final = await svc.load(link);
    if (!final.ok) throw new Error('load failed');
    expect(Object.values(final.doc.members).map(x => x.name).sort()).toEqual(['Ana', 'Ben', 'Cy']);
  });

  it('stop sharing deletes it; a later open says gone', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    const link = svc.linkOf(created.record);
    expect(await svc.stop(link)).toBe(true);
    expect(await svc.load(link)).toEqual({ ok: false, reason: 'gone' });
  });

  it('a wrong key is "invalid"; a host with no functions is "unavailable" (not "gone")', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    expect(await svc.load({ ...svc.linkOf(created.record), key: 'x'.repeat(43) })).toEqual({ ok: false, reason: 'invalid' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })));
    expect(await svc.load(svc.linkOf(created.record))).toEqual({ ok: false, reason: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await svc.load(svc.linkOf(created.record))).toEqual({ ok: false, reason: 'unavailable' });
    expect((await svc.create(trip, 'Ana', NOW_MS))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('remembers groups on this device', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    expect(JSON.parse(localStorage.getItem('ac.groups.v1')!)[created.record.id].memberId).toBe(created.record.memberId);
    svc.forget(created.record.id);
    expect(svc.recordFor(created.record.id)).toBeNull();
    expect(parseGroupDoc('{}')).toBeNull();
  });

  it('forgets a group the server says is gone, so the trip can start a new one', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    store.m.clear();
    expect(await svc.load(svc.linkOf(created.record))).toEqual({ ok: false, reason: 'gone' });
    expect(svc.recordFor(created.record.id)).toBeNull();
    expect(svc.forTrip(trip.id)).toBeNull();
  });

  it('blanks leg notes and the split note before sharing', async () => {
    const noted = { ...trip, party: { ...trip.party, splitNote: 'my secret split' }, legs: trip.legs.map(l => ({ ...l, note: 'my private leg note' })) };
    const created = await svc.create(noted, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    const opened = await svc.load(svc.linkOf(created.record));
    if (!opened.ok) throw new Error('load failed');
    const p = (await svc.previewOf(opened.doc))!;
    expect(p.trip.party.splitNote).toBe('');
    expect(p.trip.legs.every(l => l.note === '')).toBe(true);
  });

  it('ignores an older version than one already seen, and a ciphertext replayed from another group', async () => {
    const a = await svc.create(trip, 'Ana', NOW_MS);
    const b = await svc.create(trip, 'Ben', NOW_MS);
    if (!a.ok || !b.ok) throw new Error('create failed');
    const linkA = svc.linkOf(a.record);
    const first = await svc.load(linkA);
    if (!first.ok) throw new Error('load failed');
    const snapshot = store.m.get(a.record.id)!.v;
    await svc.save(linkA, svc.withMember(first.doc, 'zzzzzz1', { name: 'Zed' }, NOW_MS + 1000), first.version);
    store.m.set(a.record.id, { v: snapshot, e: 99 });
    expect(await svc.load(linkA)).toEqual({ ok: false, reason: 'unavailable' });
    // Group B's blob under A's id (same key would be needed too): authentication fails.
    store.m.set(a.record.id, { v: JSON.stringify({ ...JSON.parse(store.m.get(b.record.id)!.v), version: 9 }), e: 100 });
    expect(await svc.load({ ...linkA, key: b.record.key })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a member cap of 30: the stalest are evicted on save', async () => {
    const created = await svc.create(trip, 'Ana', NOW_MS);
    if (!created.ok) throw new Error('create failed');
    const link = svc.linkOf(created.record);
    let cur = await svc.load(link);
    if (!cur.ok) throw new Error('load failed');
    let doc = cur.doc;
    for (let i = 0; i < 31; i++) doc = svc.withMember(doc, `member${String(i).padStart(3, '0')}`, { name: `M${i}` }, NOW_MS + (i + 1) * 1000);
    const saved = await svc.save(link, doc, cur.version);
    expect(saved.ok && Object.keys(saved.doc.members)).toHaveLength(30);
    expect(saved.ok && saved.doc.members['member000']).toBeUndefined();
    expect(saved.ok && saved.doc.members['member030']).toBeDefined();
  });

  it('shows "budget" when the daily create budget is spent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'budget' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    expect(await svc.create(trip, 'Ana', NOW_MS)).toEqual({ ok: false, reason: 'budget' });
  });

  it('drops expired entries from this device', () => {
    localStorage.setItem('ac.groups.v1', JSON.stringify({
      AAAAAAAAAAAAAAAAAAAAAA: { id: 'AAAAAAAAAAAAAAAAAAAAAA', key: 'k', write: null, memberId: 'm', name: 'n', owner: false, tripId: null, expiresAt: '2020-01-01T00:00:00Z' },
      BBBBBBBBBBBBBBBBBBBBBB: { id: 'BBBBBBBBBBBBBBBBBBBBBB', key: 'k', write: null, memberId: 'm', name: 'n', owner: false, tripId: null, expiresAt: '2999-01-01T00:00:00Z' },
    }));
    const fresh = TestBed.runInInjectionContext(() => new GroupService());
    expect(Object.keys(fresh.all())).toEqual(['BBBBBBBBBBBBBBBBBBBBBB']);
  });
});
