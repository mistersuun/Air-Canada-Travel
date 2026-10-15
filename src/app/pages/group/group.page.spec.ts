import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { deleteGroup, getGroup, parsePutBody, putGroup, type GroupStore } from '../../../../netlify/functions/lib/group';
import { everyoneBoarded, friendsOnLeg, initials, nameHue, parseGroupDoc, type GroupDoc } from '../../group/group-doc';
import { GroupCardComponent } from '../../group/ui/group-card.component';
import { AVATAR_COLORS, avatarColor } from '../../group/ui/avatar-chip.component';
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
    expect(dot.style.getPropertyValue('--bg')).toBe(avatarColor('Alex'));
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

  it('avatar colours come from a fixed set of eight with white-text contrast of at least 4.5', () => {
    expect(AVATAR_COLORS.length).toBe(8);
    const lum = (h: string) => {
      const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    for (const c of AVATAR_COLORS) expect(1.05 / (lum(c) + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(new Set(AVATAR_COLORS).size).toBe(8);
    expect(avatarColor('Alex')).toBe(avatarColor(' ALEX '));
    expect(AVATAR_COLORS).toContain(avatarColor('Sam'));
  });

  it('the Plan tab card reads the group once a minute and keeps the trip list nicknames current', async () => {
    await friend('Sam');
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const gets = () => fetchSpy.mock.calls.filter(c => (c[1] as RequestInit).method === 'GET').length;
    const mount = async () => {
      const f = TestBed.createComponent(GroupCardComponent);
      f.componentRef.setInput('trip', trip);
      await vi.waitFor(async () => { f.detectChanges(); await f.whenStable(); expect(f.nativeElement.querySelector('[data-group-status]')).toBeTruthy(); });
      return f;
    };
    const a = await mount();
    const afterFirst = gets();
    expect(a.nativeElement.querySelector('[data-group-status]').textContent.replace(/\s+/g, ' ')).toContain('Ana (you) · No plan set');
    expect(svc.recordFor(record.id)!.names).toEqual(['Ana', 'Sam']);
    a.destroy();
    const b = await mount();
    expect(gets()).toBe(afterFirst); // the second mount reuses the read from the last minute
    b.destroy();
  });

  it('clips stored nicknames to the nickname limit on read', () => {
    const long = 'x'.repeat(80);
    svc.update({ ...svc.recordFor(record.id)!, names: [long] });
    localStorage.setItem('ac.groups.v1', JSON.stringify({ [record.id]: { ...svc.recordFor(record.id)!, names: [long] } }));
    const fresh = TestBed.inject(GroupService) as unknown as { readStored: () => Record<string, GroupRecord> | null };
    expect(fresh.readStored()![record.id].names![0].length).toBe(24);
  });

  it('keeps the first twelve valid leg statuses, dropping invalid ones before counting', () => {
    const bad = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`bad${i}`, 'nonsense']));
    const good = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`leg${i}`, 'listed']));
    const raw = { s: 1, plan: 'z', planAt: new Date().toISOString(), members: { 'member-abc': { name: 'A', planLabel: '', arrival: null, updatedAt: new Date().toISOString(), legs: { ...bad, ...good } } }, meetup: null };
    const legs = parseGroupDoc(JSON.stringify(raw))!.members['member-abc'].legs!;
    expect(Object.keys(legs).length).toBe(12);
    expect(Object.keys(legs).every(k => k.startsWith('leg'))).toBe(true);
  });

  it('shows my saved leg status again when the page is reopened', async () => {
    const first = await open();
    type(q(first.el, '[data-leg-status]'), 'checkedIn', 'change');
    q<HTMLButtonElement>(first.el, '[data-save-status]').click();
    await vi.waitFor(async () => { await first.stable(); expect(first.el.querySelector('[data-note]')?.textContent).toContain('Status updated'); });
    first.fixture.destroy();
    const again = await open();
    const sel = q<HTMLSelectElement>(again.el, '[data-leg-status]');
    expect(sel.value).toBe('checkedIn');
    expect(sel.selectedOptions[0].textContent!.trim()).toBe('Checked in');
  });

  it('writes my leg statuses back when an older client saved my entry without them', async () => {
    const first = await open();
    type(q(first.el, '[data-leg-status]'), 'listed', 'change');
    q<HTMLButtonElement>(first.el, '[data-save-status]').click();
    await vi.waitFor(async () => { await first.stable(); expect(first.el.querySelector('[data-note]')?.textContent).toContain('Status updated'); });
    expect(svc.recordFor(record.id)!.myLegs).toEqual({ [LEG]: 'listed' });
    first.fixture.destroy();
    // An old client saves my entry, with no legs field.
    const link = svc.linkOf(record);
    const cur = await svc.load(link);
    if (!cur.ok) throw new Error('load');
    const { legs: _dropped, ...stripped } = cur.doc.members[record.memberId];
    const old = { ...cur.doc, members: { ...cur.doc.members, [record.memberId]: { ...stripped, planLabel: 'On AC834', updatedAt: new Date(NOW_MS + 5000).toISOString() } } };
    expect((await svc.save(link, old, cur.version)).ok).toBe(true);
    const again = await open();
    await vi.waitFor(async () => {
      await again.stable();
      const r = await svc.load(link);
      expect(r.ok && r.doc.members[record.memberId].legs).toEqual({ [LEG]: 'listed' });
    });
    const r = await svc.load(link);
    expect(r.ok && r.doc.members[record.memberId].planLabel).toBe('On AC834');
  });

  it('sends only statuses for legs the plan still has', async () => {
    const link = svc.linkOf(record);
    const cur = await svc.load(link);
    if (!cur.ok) throw new Error('load');
    await svc.save(link, svc.withMember(cur.doc, record.memberId, { name: 'Ana', legs: { gone: 'listed', [LEG]: 'listed' } }, NOW_MS + 100), cur.version);
    const { el, stable } = await open();
    type(q(el, '[data-plan-label]'), 'x');
    q<HTMLButtonElement>(el, '[data-save-status]').click();
    await vi.waitFor(async () => { await stable(); expect(el.querySelector('[data-note]')?.textContent).toContain('Status updated'); });
    const r = await svc.load(link);
    expect(r.ok && r.doc.members[record.memberId].legs).toEqual({ [LEG]: 'listed' });
  });

  it('labels an unknown destination zone as device time instead of failing', async () => {
    const { fixture, el, stable } = await open();
    (fixture.componentInstance as unknown as { preview: { update: (f: (p: any) => any) => void } }).preview.update(p => ({ ...p, trip: { ...p.trip, goal: { ...p.trip.goal, tz: 'Mars/Olympus' } } }));
    await stable();
    expect(q(el, '[data-arrival-label]').textContent).toContain('your device time');
  });

  it('formats the leg date like the trip card, not as a raw key', async () => {
    const { el } = await open();
    expect(q(el, `[data-leg-id="${LEG}"]`).textContent).toMatch(/Thu Oct 8/);
    expect(q(el, `[data-leg-id="${LEG}"]`).textContent).not.toContain('2026-10-08');
  });

  it('everyoneBoarded needs two or more members and every one boarded', () => {
    const m = (legs?: Record<string, 'boarded' | 'listed'>) => ({ name: 'x', planLabel: '', arrival: null, updatedAt: new Date().toISOString(), ...(legs ? { legs } : {}) });
    const doc = (members: GroupDoc['members']): GroupDoc => ({ s: 1, plan: 'z', planAt: new Date().toISOString(), members, meetup: null });
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }) }), 'l')).toBe(false);
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m({ l: 'listed' }) }), 'l')).toBe(false);
    // Members with nothing set for the leg are not counted: they may not be on it.
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m() }), 'l')).toBe(false);
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m({ l: 'boarded' }), c: m() }), 'l')).toBe(true);
    expect(everyoneBoarded(doc({ a: m({ l: 'boarded' }), b: m({ l: 'boarded' }), c: m({ l: 'listed' }) }), 'l')).toBe(false);
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

    it('with blocked storage it still bursts only once per visit, not at every poll', async () => {
      await everyoneBoardedOnLeg();
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      try {
        const { el, stable } = await open();
        expect(el.querySelector('[data-confetti]')).toBeTruthy();
        (el.ownerDocument.defaultView as Window).dispatchEvent(new Event('x'));
        await new Promise(r => setTimeout(r, 2800));
        await stable();
        expect(el.querySelector('[data-confetti]')).toBeNull();
        await friend('Cy', { legs: { [LEG]: 'boarded' } });
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.waitFor(async () => { await stable(); expect(el.querySelectorAll('[data-member]').length).toBe(3); });
        expect(el.querySelector('[data-confetti]')).toBeNull();
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
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
