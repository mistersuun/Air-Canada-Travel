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
import { groupExpiry, parseGroupDoc, tripLastDate } from './group-doc';
import { GroupService, type GroupRecord } from './group.service';

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
    if (init.method === 'DELETE') { const r = await deleteGroup(store, id, headers['X-Group-Write'], headers['X-Group-Owner']); return reply(r.status, r.body); }
    const body = parsePutBody(JSON.parse(init.body as string));
    if (!body) return reply(400, { error: 'bad-request' });
    const r = await putGroup(store, id, headers['X-Group-Write'], body, Date.now(), undefined, headers['X-Group-Owner']);
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
    expect(await svc.stop(link, created.record.ownerToken)).toBe(true);
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

  describe('owner token', () => {
    it('is made at creation, sent as a header, stored server-side only as a hash, and never in a link', async () => {
      const r = await svc.create(trip, 'Ana', NOW_MS);
      if (!r.ok) throw new Error('create failed');
      const owner = r.record.ownerToken!;
      expect(owner).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(owner).not.toBe(r.record.write);
      expect((sent[0].init.headers as Record<string, string>)['X-Group-Owner']).toBe(owner);
      expect(String(sent[0].init.body)).not.toContain(owner);
      const raw = [...store.m.values()][0].v;
      expect(raw).not.toContain(owner);
      expect(JSON.parse(raw).ownerHash).toBeTruthy();
      expect(svc.urlOf(svc.linkOf(r.record))).not.toContain(owner);
      expect(JSON.parse(localStorage.getItem('ac.groups.v1')!)[r.record.id].ownerToken).toBe(owner);
    });

    it('stop needs it: the write token alone (a companion with an edit link) is refused', async () => {
      const r = await svc.create(trip, 'Ana', NOW_MS);
      if (!r.ok) throw new Error('create failed');
      const link = svc.linkOf(r.record);
      expect(await svc.stop(link)).toBe(false);
      expect(store.m.size).toBe(1);
      expect(await svc.stop(link, r.record.ownerToken)).toBe(true);
      expect(store.m.size).toBe(0);
    });

    it('a group made before owner tokens can still be stopped with the write token', async () => {
      const id = 'CCCCCCCCCCCCCCCCCCCCCC';
      const write = 'w'.repeat(22);
      await putGroup(store, id, write, parsePutBody({ ciphertext: 'c'.repeat(40), iv: 'i'.repeat(16), baseVersion: 0 })!, Date.now());
      expect(await svc.stop({ id, key: 'k'.repeat(43), write }, null)).toBe(true);
      expect(store.m.size).toBe(0);
    });

    it('a record saved before owner tokens loads with ownerToken null', () => {
      localStorage.setItem('ac.groups.v1', JSON.stringify({
        AAAAAAAAAAAAAAAAAAAAAA: { id: 'AAAAAAAAAAAAAAAAAAAAAA', key: 'k', write: 'w', memberId: 'm', name: 'n', owner: true, tripId: 't', expiresAt: null },
      }));
      const fresh = TestBed.runInInjectionContext(() => new GroupService());
      expect(fresh.recordFor('AAAAAAAAAAAAAAAAAAAAAA')?.ownerToken).toBeNull();
    });
  });

  describe('expiry', () => {
    it('ownerExpiry only proposes a date more than a day beyond the current one, and only for the owner', async () => {
      const r = await svc.create(trip, 'Ana', NOW_MS);
      if (!r.ok) throw new Error('create failed');
      const want = groupExpiry(trip, NOW_MS);
      const t = Date.parse(want);
      expect(svc.ownerExpiry(r.record, new Date(t - 2 * 86_400_000).toISOString(), NOW_MS)).toBe(want);
      expect(svc.ownerExpiry(r.record, new Date(t - 3_600_000).toISOString(), NOW_MS)).toBeUndefined();
      expect(svc.ownerExpiry(r.record, new Date(t + 86_400_000).toISOString(), NOW_MS)).toBeUndefined();
      expect(svc.ownerExpiry(r.record, null, NOW_MS)).toBe(want);
      expect(svc.ownerExpiry({ ...r.record, owner: false }, null, NOW_MS)).toBeUndefined();
      expect(svc.ownerExpiry({ ...r.record, tripId: 'gone' }, null, NOW_MS)).toBeUndefined();
      expect(svc.ownerExpiry(null, null, NOW_MS)).toBeUndefined();
    });

    it('ownerExpiry does not extend once the trip ended more than 30 days ago', async () => {
      const r = await svc.create(trip, 'Ana', NOW_MS);
      if (!r.ok) throw new Error('create failed');
      const end = Date.parse(`${tripLastDate(trip)}T23:59:59Z`);
      expect(svc.ownerExpiry(r.record, null, end + 29 * 86_400_000)).toBeDefined();
      expect(svc.ownerExpiry(r.record, null, end + 31 * 86_400_000)).toBeUndefined();
    });

    it('create stores the expiry the server answered with', async () => {
      const r = await svc.create(trip, 'Ana', Date.now());
      if (!r.ok) throw new Error('create failed');
      const served = (await svc.load(svc.linkOf(r.record)));
      expect(served.ok && served.expiresAt).toBe(r.record.expiresAt);
    });

    it('an owner save extends the group; a companion save does not', async () => {
      const r = await svc.create(trip, 'Ana', Date.now());
      if (!r.ok) throw new Error('create failed');
      const link = svc.linkOf(r.record);
      const opened = await svc.load(link);
      if (!opened.ok) throw new Error('load failed');
      const later = new Date(Date.now() + 85 * 86_400_000).toISOString();
      const companion = await svc.save(link, opened.doc, opened.version, later);
      expect(companion.ok && companion.expiresAt).toBe(r.record.expiresAt);
      const owner = await svc.save(link, opened.doc, opened.ok && companion.ok ? companion.version : 0, later, r.record.ownerToken);
      expect(owner.ok && owner.expiresAt).toBe(later);
    });
  });

  describe('several tabs', () => {
    const rec = (id: string): GroupRecord => ({ id, key: 'k', write: null, memberId: 'm', name: 'n', owner: false, ownerToken: null, tripId: null, expiresAt: null });

    it('a write re-reads storage first, so another tab\'s group is not dropped', () => {
      svc.remember(rec('AAAAAAAAAAAAAAAAAAAAAA'));
      // Another tab adds B and this tab does not hear about it.
      const stored = JSON.parse(localStorage.getItem('ac.groups.v1')!);
      stored['BBBBBBBBBBBBBBBBBBBBBB'] = rec('BBBBBBBBBBBBBBBBBBBBBB');
      localStorage.setItem('ac.groups.v1', JSON.stringify(stored));
      svc.remember(rec('CCCCCCCCCCCCCCCCCCCCCC'));
      expect(Object.keys(JSON.parse(localStorage.getItem('ac.groups.v1')!)).sort()).toEqual(['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCCCCCCCC']);
      expect(Object.keys(svc.all()).sort()).toHaveLength(3);
    });

    it('update does not bring back a group another tab forgot', () => {
      svc.remember(rec('AAAAAAAAAAAAAAAAAAAAAA'));
      localStorage.setItem('ac.groups.v1', '{}'); // the other tab forgot it
      svc.update({ ...rec('AAAAAAAAAAAAAAAAAAAAAA'), name: 'changed' });
      expect(svc.recordFor('AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
      expect(JSON.parse(localStorage.getItem('ac.groups.v1')!)).toEqual({});
      svc.remember(rec('BBBBBBBBBBBBBBBBBBBBBB'));
      svc.update({ ...rec('BBBBBBBBBBBBBBBBBBBBBB'), name: 'changed' });
      expect(svc.recordFor('BBBBBBBBBBBBBBBBBBBBBB')?.name).toBe('changed');
    });

    it('forget also leaves another tab\'s groups alone', () => {
      svc.remember(rec('AAAAAAAAAAAAAAAAAAAAAA'));
      const stored = JSON.parse(localStorage.getItem('ac.groups.v1')!);
      stored['BBBBBBBBBBBBBBBBBBBBBB'] = rec('BBBBBBBBBBBBBBBBBBBBBB');
      localStorage.setItem('ac.groups.v1', JSON.stringify(stored));
      svc.forget('AAAAAAAAAAAAAAAAAAAAAA');
      expect(Object.keys(JSON.parse(localStorage.getItem('ac.groups.v1')!))).toEqual(['BBBBBBBBBBBBBBBBBBBBBB']);
    });

    it('a storage event from another tab refreshes the list', () => {
      localStorage.setItem('ac.groups.v1', JSON.stringify({ DDDDDDDDDDDDDDDDDDDDDD: rec('DDDDDDDDDDDDDDDDDDDDDD') }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'ac.groups.v1' }));
      expect(svc.recordFor('DDDDDDDDDDDDDDDDDDDDDD')).not.toBeNull();
      window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
      expect(Object.keys(svc.all())).toEqual(['DDDDDDDDDDDDDDDDDDDDDD']);
    });
  });
});
