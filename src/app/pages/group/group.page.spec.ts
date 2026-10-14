import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { deleteGroup, getGroup, parsePutBody, putGroup, type GroupStore } from '../../../../netlify/functions/lib/group';
import { everyoneBoarded, friendsOnLeg, initials, nameHue, type GroupDoc } from '../../group/group-doc';
import { GroupService, type GroupRecord } from '../../group/group.service';
import { PROFILE_STORAGE } from '../../recs/profile.service';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { GroupPage, fromLocalInput, toLocalInput } from './group.page';

const NOW_MS = Date.parse('2026-10-01T13:41:00Z');
const LEG = SEVILLE_IDS.outbound;
const CONFETTI_KEY = 'ac.group.confetti.v1';

function memory(): GroupStore {
  const m = new Map<string, { v: string; e: number }>();
  let seq = 0;
  return {
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

function serverFetch(store: GroupStore) {
  return vi.fn(async (url: string, init: RequestInit) => {
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

describe('GroupPage', () => {
  let svc: GroupService;
  let record: GroupRecord;
  const trip = SEVILLE_TRIPS_FILE.trips[0];
  const route = { snapshot: { fragment: null as string | null, paramMap: convertToParamMap({}) } };
  const useRoute = (fragment: string | null) => { route.snapshot = { fragment, paramMap: convertToParamMap({ id: record.id }) }; };

  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal('fetch', serverFetch(memory()));
    const storage = new MemoryStorage();
    storage.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: TRIPS_STORAGE, useValue: storage },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: PROFILE_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    svc = TestBed.inject(GroupService);
    const made = await svc.create(trip, 'Ana', NOW_MS);
    if (!made.ok) throw new Error('create failed');
    record = made.record;
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); vi.restoreAllMocks(); });

  /** A friend writes their own status straight to the server. */
  async function friend(name: string, patch: { legs?: Record<string, 'listed' | 'boarded'>; planLabel?: string } = {}, id = `friend-${name}`): Promise<void> {
    const link = svc.linkOf(record);
    const cur = await svc.load(link);
    if (!cur.ok) throw new Error('load failed');
    const next = svc.withMember(cur.doc, id, { name, ...patch }, NOW_MS + 1000);
    const saved = await svc.save(link, next, cur.version);
    if (!saved.ok) throw new Error('save failed');
  }

  async function open(fragment: string | null = null) {
    useRoute(fragment);
    const fixture = TestBed.createComponent(GroupPage);
    const el = fixture.nativeElement as HTMLElement;
    const stable = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await vi.waitFor(async () => { await stable(); expect(el.querySelector('[data-members]')).toBeTruthy(); });
    await stable();
    return { fixture, el, stable };
  }
  const q = <T extends Element>(el: Element, sel: string) => el.querySelector<T>(sel)!;
  const type = (input: HTMLInputElement | HTMLSelectElement, value: string, evt = 'input') => { input.value = value; input.dispatchEvent(new Event(evt)); };

  it('opens from this device\'s record and lists who is on which flight', async () => {
    const { el } = await open();
    expect([...el.querySelectorAll('[data-leg]')].map(l => l.getAttribute('data-leg-id'))).toContain(LEG);
    expect(el.querySelectorAll('[data-member]').length).toBe(1);
    expect(el.textContent).toContain('Ana (you)');
  });

  it('polls: another member shows up when the page becomes visible again, without touching what is typed', async () => {
    const { el, stable } = await open();
    type(q(el, '[data-plan-label]'), 'On AC834');
    await friend('Sam', { planLabel: 'Bus to YUL' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(async () => { await stable(); expect(el.querySelectorAll('[data-member]').length).toBe(2); });
    expect(el.textContent).toContain('Bus to YUL');
    expect(q<HTMLInputElement>(el, '[data-plan-label]').value).toBe('On AC834');
  });

  it('polls on the interval while visible', async () => {
    const setI = vi.spyOn(globalThis, 'setInterval');
    await open();
    expect(setI.mock.calls.some(c => c[1] === 120_000)).toBe(true);
  });

  it('saves my status and merges with a friend who wrote in the meantime', async () => {
    const { el, stable } = await open();
    await friend('Sam', { planLabel: 'On AC834' });
    type(q(el, '[data-plan-label]'), 'Plan B: AC836');
    type(q(el, '[data-leg-status]'), 'listed', 'change');
    q<HTMLButtonElement>(el, '[data-save-status]').click();
    await vi.waitFor(async () => { await stable(); expect(el.querySelector('[data-note]')?.textContent).toContain('Status updated'); });
    const r = await svc.load(svc.linkOf(record));
    if (!r.ok) throw new Error('load');
    expect(r.doc.members[record.memberId].planLabel).toBe('Plan B: AC836');
    expect(r.doc.members[record.memberId].legs).toEqual({ [LEG]: 'listed' });
    expect(r.doc.members['friend-Sam'].planLabel).toBe('On AC834');
    // The key and the write token never leave in a request; load notes are not part of the doc.
    expect(JSON.stringify(r.doc)).not.toContain(record.key);
  });

  it('removes the key from the address bar once read from the fragment', async () => {
    localStorage.clear(); // a visitor with only the link
    const replace = vi.spyOn(history, 'replaceState');
    useRoute(`k=${record.key}&w=${record.write}`);
    const fixture = TestBed.createComponent(GroupPage);
    await vi.waitFor(async () => { fixture.detectChanges(); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('[data-members]')).toBeTruthy(); });
    expect(replace).toHaveBeenCalled();
    expect(String(replace.mock.calls[0][2])).not.toContain(record.key);
    expect(location.href).not.toContain(record.key);
  });

  it('shows a view-only link without the editing form', async () => {
    localStorage.clear();
    useRoute(`k=${record.key}`);
    const fixture = TestBed.createComponent(GroupPage);
    await vi.waitFor(async () => { fixture.detectChanges(); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('[data-view-only]')).toBeTruthy(); });
    expect(fixture.nativeElement.querySelector('[data-mine]')).toBeNull();
  });

  it('enters the meet-up arrival in the destination zone and labels it', async () => {
    const { el, stable } = await open();
    expect(q(el, '[data-arrival-label]').textContent).toContain('Seville time');
    // 14:30 on Oct 2 in Seville (CEST, UTC+2) is 12:30Z, whatever zone this device is in.
    type(q(el, '[data-arrival]'), '2026-10-02T14:30');
    q<HTMLButtonElement>(el, '[data-save-status]').click();
    await vi.waitFor(async () => { await stable(); expect(el.querySelector('[data-note]')?.textContent).toContain('Status updated'); });
    const r = await svc.load(svc.linkOf(record));
    if (!r.ok) throw new Error('load');
    expect(r.doc.members[record.memberId].arrival).toBe('2026-10-02T12:30:00.000Z');
    expect(q<HTMLInputElement>(el, '[data-arrival]').value).toBe('2026-10-02T14:30');
  });

  it('converts local time both ways in a zone, falling back to the device zone', () => {
    expect(fromLocalInput('2026-10-02T14:30', 'Europe/Madrid')).toBe('2026-10-02T12:30:00.000Z');
    expect(fromLocalInput('2026-01-15T09:00', 'America/Toronto')).toBe('2026-01-15T14:00:00.000Z');
    expect(toLocalInput('2026-10-02T12:30:00.000Z', 'Europe/Madrid')).toBe('2026-10-02T14:30');
    expect(toLocalInput('2026-10-02T12:30:00.000Z', 'Asia/Tokyo')).toBe('2026-10-02T21:30');
    expect(fromLocalInput('', 'Europe/Madrid')).toBeNull();
    expect(toLocalInput(null, 'Europe/Madrid')).toBe('');
    const dev = fromLocalInput('2026-10-02T14:30', null)!;
    expect(toLocalInput(dev, null)).toBe('2026-10-02T14:30');
  });

  it('shows friends as avatar chips with their status on each leg', async () => {
    await friend('Alex', { legs: { [LEG]: 'boarded' } });
    await friend('Sam', { legs: { [LEG]: 'listed' } });
    const { el } = await open();
    const leg = q(el, `[data-leg-id="${LEG}"]`);
    const chips = [...leg.querySelectorAll('app-avatar-chip')].map(c => c.textContent!.replace(/\s+/g, ' ').trim());
    expect(chips).toEqual(['AAlex · boarded', 'SSam · listed']);
    const dot = q<HTMLElement>(leg, '.av__dot');
    expect(dot.style.getPropertyValue('--hue')).toBe(String(nameHue('Alex')));
  });

  it('avatar helpers: initials and a stable hue from the name', () => {
    expect(initials('alex')).toBe('A');
    expect(initials('Sam Lee')).toBe('SL');
    expect(initials('  ')).toBe('?');
    expect(nameHue('Alex')).toBe(nameHue(' alex '));
    expect(nameHue('Alex')).not.toBe(nameHue('Sam'));
    expect(nameHue('Alex')).toBeGreaterThanOrEqual(0);
    expect(nameHue('Alex')).toBeLessThan(360);
  });

  it('everyoneBoarded needs two or more members and every one boarded', () => {
    const m = (legs?: Record<string, 'boarded' | 'listed'>) => ({ name: 'x', planLabel: '', arrival: null, updatedAt: new Date().toISOString(), ...(legs ? { legs } : {}) });
    const doc = (members: GroupDoc['members']): GroupDoc => ({ s: 1, plan: 'z', planAt: new Date().toISOString(), members, meetup: null });
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }) }), 'l')).toBe(false);
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m({ l: 'listed' }) }), 'l')).toBe(false);
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m() }), 'l')).toBe(false);
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m({ l: 'boarded' }) }), 'l')).toBe(true);
    expect(friendsOnLeg(doc({ a: m({ l: 'boarded' }), b: m() }), 'l', null).map(f => f.status)).toEqual(['boarded']);
  });

  describe('confetti', () => {
    async function everyoneBoardedOnLeg() {
      await friend('Alex', { legs: { [LEG]: 'boarded' } });
      const link = svc.linkOf(record);
      const cur = await svc.load(link);
      if (!cur.ok) throw new Error('load');
      await svc.save(link, svc.withMember(cur.doc, record.memberId, { name: 'Ana', legs: { [LEG]: 'boarded' } }, NOW_MS + 2000), cur.version);
    }

    it('bursts once per leg on this device, then not again', async () => {
      await everyoneBoardedOnLeg();
      const first = await open();
      expect(first.el.querySelector('[data-confetti]')).toBeTruthy();
      expect(first.el.querySelector('[data-confetti]')!.getAttribute('aria-hidden')).toBe('true');
      expect(JSON.parse(localStorage.getItem(CONFETTI_KEY)!)).toEqual([`${record.id}:${LEG}`]);
      first.fixture.destroy();
      const again = await open();
      expect(again.el.querySelector('[data-confetti]')).toBeNull();
    });

    it('does not burst while somebody has not boarded', async () => {
      await friend('Alex', { legs: { [LEG]: 'boarded' } });
      const { el } = await open();
      expect(el.querySelector('[data-confetti]')).toBeNull();
      expect(localStorage.getItem(CONFETTI_KEY)).toBeNull();
    });

    it('stays still under prefers-reduced-motion', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
      await everyoneBoardedOnLeg();
      const { el } = await open();
      expect(el.querySelector('[data-confetti]')).toBeNull();
    });

    it('works when storage is blocked', async () => {
      await everyoneBoardedOnLeg();
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      try {
        const { el } = await open();
        expect(el.querySelector('[data-members]')).toBeTruthy();
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    });
  });

  it('keeps load notes and personal notes out of the group doc', async () => {
    const r = await svc.load(svc.linkOf(record));
    if (!r.ok) throw new Error('load');
    const p = await svc.previewOf(r.doc);
    expect(p!.notes).toEqual([]);
    expect(p!.trip.party.splitNote).toBe('');
    expect(p!.trip.legs.every(l => l.note === '')).toBe(true);
  });

  it('Back leaves for the trips list', async () => {
    const { fixture, el } = await open();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    q<HTMLButtonElement>(el, 'button[aria-label="Back"]').click();
    expect(nav).toHaveBeenCalled();
    fixture.destroy();
  });
});
