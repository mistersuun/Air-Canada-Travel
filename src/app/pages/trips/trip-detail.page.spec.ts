import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import { GROUND_FETCH } from '../../places/ground-timetable.service';
import { FIXTURE_GROUND_FILE } from '../../places/testing/ground-fixture';
import { setGroundTimetables } from '../../places/timetable';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY, Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { encodeTripShare } from '../../trips/share-codec';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { SettingsDataComponent } from '../../trips/ui/settings-data.component';
import { toUtcMs } from '../../utils/time';
import { TripImportPage } from './import/trip-import.page';
import { TripDetailPage } from './trip-detail.page';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
let storage: MemoryStorage;

function configure(store: MemoryStorage, extra: unknown[] = []) {
  storage = store;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: GROUND_FETCH, useValue: async () => null },
      ...(extra as never[]),
    ],
  });
}

function seeded(): MemoryStorage {
  const s = new MemoryStorage();
  s.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  return s;
}

const stored = (): Trip => JSON.parse(storage.getItem(TRIPS_KEY)!).trips.find((t: Trip) => t.id === SEVILLE_IDS.trip);
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(inputs: { leg?: string; tab?: string } = {}, store = seeded(), extra: unknown[] = []) {
  configure(store, extra);
  const fixture = TestBed.createComponent(TripDetailPage);
  fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
  if (inputs.tab) fixture.componentRef.setInput('tab', inputs.tab);
  if (inputs.leg) fixture.componentRef.setInput('leg', inputs.leg);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel: string) => clean(el.querySelector(sel)?.textContent);
  return { fixture, el, nav, stable, text, state: TestBed.inject(AppStateService), trips: TestBed.inject(TripsService) };
}

describe('TripDetailPage', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('shows the header, the seg and the Plan tab with the timeline', async () => {
    const { el, text } = await render();
    expect(text('h1')).toBe('Seville trip');
    expect(text('.td__sub')).toBe('Spain and Portugal · 2 travellers');
    expect(el.querySelector('app-plan-tab app-trip-changes')).toBeTruthy();
    expect(el.querySelectorAll('app-plan-tab .tl__it')).toHaveLength(4);
    expect(el.querySelector('app-plan-tab [data-return-warning]')).toBeTruthy();
    expect(el.querySelector('app-leg-sheet')).toBeNull();
  });

  it('tapping a leg puts ?leg= in the URL (replaceUrl)', async () => {
    const { el, nav } = await render();
    el.querySelector<HTMLButtonElement>('[data-leg="leg-ret813"] button')!.click();
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { leg: SEVILLE_IDS.ret }, replaceUrl: true }));
  });

  it('?leg= opens the leg sheet; the status persists', async () => {
    const { el, stable } = await render({ leg: SEVILLE_IDS.ret });
    const sheet = el.querySelector('app-leg-sheet')!;
    expect(clean(sheet.querySelector('.gs__title')?.textContent)).toBe('AC813 · LIS → YUL');
    expect(clean(sheet.querySelector('.ls__fact')?.textContent)).toContain('Tue Oct 13 · 11:25 → 13:50');
    sheet.querySelector<HTMLButtonElement>('.st__b[data-status="listed"]')!.click();
    await stable();
    expect(stored().legs.find(l => l.id === SEVILLE_IDS.ret)!.status).toBe('listed');
    expect(clean(el.querySelector('[data-leg="leg-ret813"] app-leg-status-tag')?.textContent)).toBe('Listed');
    expect(el.querySelector('[data-return-warning]')).toBeNull();
    // A reload reads it back.
    TestBed.resetTestingModule();
    const again = await render({}, storage);
    expect(clean(again.el.querySelector('[data-leg="leg-ret813"] app-leg-status-tag')?.textContent)).toBe('Listed');
  });

  it('an Unknown leg on a route the network lists says so in the sheet and links to aircanada.com', async () => {
    setScheduleSource(SEVILLE_ROUTES.filter(r => !(r.originCode === 'LIS' && r.destinationCode === 'YUL')), SEVILLE_META);
    setRouteNetworkSource({ ...ROUTE_NETWORK_FIXTURE, routes: { 'YUL-LIS': ['A', 0, null, null, null] } });
    try {
      const { el, stable, trips } = await render({ leg: SEVILLE_IDS.ret });
      trips.checkChanges();
      const c = trips.trip(SEVILLE_IDS.trip)!.changes.find(x => x.kind === 'notFound')!;
      trips.keepChange(SEVILLE_IDS.trip, c.id);
      await stable();
      const warn = el.querySelector('app-leg-sheet [data-route-only]')!;
      expect(clean(warn.textContent)).toContain('Flies this route · times not in our data. Check the Air Canada app before you go.');
      expect(warn.querySelector('a')!.getAttribute('href')).toBe('https://www.aircanada.com/');
      expect(clean(el.querySelector('app-leg-sheet .ls__fact app-provenance-tag')?.textContent)).toBe('Unknown');
    } finally {
      resetRouteNetworkSource();
    }
  });

  it('"Use instead" swaps to a backup, and Undo restores the plan', async () => {
    const { el, stable, state } = await render({ leg: SEVILLE_IDS.outbound });
    const rows = el.querySelectorAll('app-leg-sheet [data-alt]');
    expect([...rows].map(r => clean(r.querySelector('b')?.textContent))).toEqual(['AC822 · YUL → BCN', 'AC812 · YUL → LIS']);
    el.querySelector<HTMLButtonElement>('[data-alt="alt-lis812"] [data-use]')!.click();
    await stable();
    let t = stored();
    expect(t.legs.find(l => l.id === SEVILLE_IDS.outbound)!.status).toBe('abandoned');
    expect(t.legs.some(l => l.kind === 'flight' && l.refs[0].flightNumber === 'AC812' && l.status === 'planned')).toBe(true);
    expect(state.notice()?.message).toBe('Swapped to AC812 · Listing is still your step');
    state.notice()!.action!();
    await stable();
    t = stored();
    expect(t.legs.find(l => l.id === SEVILLE_IDS.outbound)!.status).toBe('listed');
    expect(t.legs).toHaveLength(4);
  });

  it('removes a backup with Undo, and lists later options to add', async () => {
    const { el, stable, state } = await render({ leg: SEVILLE_IDS.outbound });
    el.querySelector<HTMLButtonElement>('[data-alt="alt-bcn822"] .opt__x')!.click();
    await stable();
    expect((stored().legs[0] as { alternates: unknown[] }).alternates).toHaveLength(1);
    state.notice()!.action!();
    await stable();
    expect((stored().legs[0] as { alternates: unknown[] }).alternates).toHaveLength(2);
    el.querySelector<HTMLButtonElement>('[data-add]')!.click();
    await stable();
    const list = el.querySelector('[data-add-list]')!;
    // Same day via Toronto, then the next day's AC834.
    expect(clean(list.textContent)).toContain('AC834 · YUL → MAD');
    const before = (stored().legs[0] as { alternates: unknown[] }).alternates.length;
    list.querySelector<HTMLButtonElement>('button')!.click();
    await stable();
    expect((stored().legs[0] as { alternates: unknown[] }).alternates.length).toBe(before + 1);
  });

  it('links to the flight page for a hub → destination leg', async () => {
    const { el } = await render({ leg: SEVILLE_IDS.outbound });
    const a = el.querySelector<HTMLAnchorElement>('[data-details]')!;
    expect(a.getAttribute('href')).toMatch(/^\/flight\/MAD\/2026-10-08/);
    TestBed.resetTestingModule();
    const ret = await render({ leg: SEVILLE_IDS.ret });
    expect(ret.el.querySelector('[data-details]')).toBeNull();
  });

  it('?leg=<ground> opens the ground editor; Save makes it "Saved by you"', async () => {
    const { el, stable } = await render({ leg: SEVILLE_IDS.train });
    const form = el.querySelector<HTMLFormElement>('[data-ground-editor]')!;
    expect(form).toBeTruthy();
    expect(clean(el.querySelector('app-leg-sheet .ls__fact span')?.textContent)).toBe('Fri Oct 9 · Train about 2h40');
    expect(clean(el.querySelector('app-leg-sheet .ls__fact app-provenance-tag')?.textContent)).toBe('Estimated');
    expect(el.querySelector<HTMLAnchorElement>('[data-onward]')!.href).toContain('google.com/maps/dir/?api=1');
    const set = (name: string, v: string) => {
      const i = form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    // Missing times: a message, nothing saved.
    form.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await stable();
    expect(clean(el.querySelector('.ed__err')?.textContent)).toBe('Add the departure and arrival dates and times.');
    set('depTime', '10:05');
    set('arrTime', '12:45');
    set('note', 'AVE 2102');
    form.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await stable();
    const g = stored().legs.find(l => l.id === SEVILLE_IDS.train)!;
    expect(g.kind === 'ground' && g.provenance).toBe('saved');
    expect(g.kind === 'ground' && g.userTimes).toEqual({ depDateKey: '2026-10-09', depLocal: '10:05', arrDateKey: '2026-10-09', arrLocal: '12:45' });
    expect(clean(el.querySelector('[data-leg="leg-madsvq"] app-provenance-tag')?.textContent)).toBe('Saved by you');
    expect(clean(el.querySelector('[data-leg="leg-madsvq"] .tl__m')?.textContent)).toBe('Train 10:05 → 12:45 · AVE 2102');
  });

  it('a ground leg on a timetable corridor shows the Scheduled timetable for its day; the stored leg stays Estimated', async () => {
    const { el, stable } = await render({ leg: SEVILLE_IDS.train }, seeded(),
      [{ provide: GROUND_FETCH, useValue: async () => structuredClone(FIXTURE_GROUND_FILE) }]);
    await stable();
    // The ride is timetable-backed: Scheduled. The airport exit and transfer stay Estimated.
    expect(clean(el.querySelector('app-leg-sheet [data-ride-fact] span')?.textContent)).toBe('Fri Oct 9 · Train 2h39');
    expect(clean(el.querySelector('app-leg-sheet [data-ride-fact] app-provenance-tag')?.textContent)).toBe('Scheduled');
    expect(clean(el.querySelector('app-leg-sheet [data-exit-fact] span')?.textContent)).toBe('Passport, exit, get to Atocha · allow about 1h30');
    expect(clean(el.querySelector('app-leg-sheet [data-exit-fact] app-provenance-tag')?.textContent)).toBe('Estimated');
    expect(clean(el.querySelector(`[data-leg="${SEVILLE_IDS.train}"] .tl__m`)?.textContent)).toContain('Train 2h39 · not booked');
    expect(clean(el.querySelector(`[data-leg="${SEVILLE_IDS.train}"] app-provenance-tag`)?.textContent)).toBe('Scheduled');
    expect(clean(el.querySelector('app-leg-sheet [data-timetable-fact] span')?.textContent)).toBe('Renfe timetable · 2h39 ride');
    expect(clean(el.querySelector('app-leg-sheet [data-timetable-fact] app-provenance-tag')?.textContent)).toBe('Scheduled');
    expect(clean(el.querySelector('app-leg-sheet [data-timetable]')?.textContent)).toBe(
      '4 Renfe trains on weekdays, 07:00 to 21:05 Timetable · Renfe · valid to Dec 12 Renfe trains only. Iryo and Ouigo also run this route.');
    expect(stored().legs.find(l => l.id === SEVILLE_IDS.train)).toMatchObject({ provenance: 'estimated', estMinutes: 250 });
    setGroundTimetables(null);
  });

  it('the party chip edits travellers', async () => {
    const { el, stable } = await render();
    el.querySelector<HTMLButtonElement>('[data-party]')!.click();
    await stable();
    el.querySelector<HTMLButtonElement>('app-party-sheet [aria-label="One more traveller"]')!.click();
    await stable();
    expect(stored().party.count).toBe(3);
    expect(clean(el.querySelector('[data-party]')?.textContent)).toContain('3 travellers · stay together');
  });

  describe('trip menu (g8)', () => {
    it('shows honest offline ticks, the split note and the share actions', async () => {
      const { el, stable } = await render();
      el.querySelector<HTMLButtonElement>('[data-menu]')!.click();
      await stable();
      const menu = el.querySelector('app-trip-menu')!;
      expect(clean(menu.querySelector('[data-offline] .ui-sub')?.textContent)).toBe('Saved Thu Oct 1, 09:38');
      const items = [...menu.querySelectorAll('.chk li')];
      expect(items.map(li => clean(li.querySelector('b')?.textContent))).toEqual(
        ['Your plan and notes', 'Backups and return flights', 'Onward directions']);
      expect(items[0].querySelector('.box.on')).toBeTruthy();
      // No service worker in tests: the loaded schedules count.
      expect(items[1].querySelector('.box.on')).toBeTruthy();
      expect(clean(items[1].querySelector('.m')?.textContent)).toBe('Barcelona, Lisbon, Madrid, Toronto · to Oct 20');
      expect(items[2].querySelector('.box.on')).toBeNull();
      expect(clean(items[2].querySelector('.m')?.textContent)).toBe('Needs internet (Google Maps)');

      const ta = menu.querySelector<HTMLTextAreaElement>('[data-split]')!;
      expect(ta.value).toBe('Meet at Seville Santa Justa station. Whoever arrives first books the room.');
      ta.value = 'Meet at the Alcázar gate.';
      ta.dispatchEvent(new Event('change'));
      await stable();
      expect(stored().party.splitNote).toBe('Meet at the Alcázar gate.');
    });

    it('Copy link puts a /trips/import#t= link on the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      const { el, stable, state } = await render();
      el.querySelector<HTMLButtonElement>('[data-menu]')!.click();
      await stable();
      el.querySelector<HTMLButtonElement>('[data-copy]')!.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(writeText.mock.calls[0][0]).toMatch(/\/trips\/import#t=[zj][A-Za-z0-9_-]+$/);
      await vi.waitFor(() => expect(state.notice()?.message).toBe('Link copied'));
      delete (navigator as { clipboard?: unknown }).clipboard;
    });

    it('Calendar downloads the .ics and records it; Save for offline stamps the trip', async () => {
      const create = vi.fn(() => 'blob:x');
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const store = seeded();
      const file = JSON.parse(store.getItem(TRIPS_KEY)!);
      file.trips[0].offlineSavedAt = null;
      file.trips[0].calendarExportedAt = null;
      store.setItem(TRIPS_KEY, JSON.stringify(file));
      const { el, stable } = await render({}, store);
      el.querySelector<HTMLButtonElement>('[data-menu]')!.click();
      await stable();
      expect(clean(el.querySelector('[data-offline] .ui-sub')?.textContent)).toBe('Not saved for offline yet');
      el.querySelector<HTMLButtonElement>('[data-calendar]')!.click();
      await stable();
      expect(create).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(stored().calendarExportedAt).toBe(new Date(NOW_MS).toISOString());
      el.querySelector<HTMLButtonElement>('[data-save-offline]')!.click();
      await vi.waitFor(() => expect(stored().offlineSavedAt).toBe(new Date(NOW_MS).toISOString()));
      await stable();
      expect(clean(el.querySelector('[data-offline] .ui-sub')?.textContent)).toBe('Saved Thu Oct 1, 09:41');
    });

    it('Delete removes the trip and leaves for /trips', async () => {
      const { el, stable, nav, trips } = await render();
      el.querySelector<HTMLButtonElement>('[data-menu]')!.click();
      await stable();
      el.querySelector<HTMLButtonElement>('[data-delete]')!.click();
      await stable();
      expect(trips.trip(SEVILLE_IDS.trip)).toBeNull();
      expect(nav).toHaveBeenCalledWith(['/trips'], expect.objectContaining({ replaceUrl: true }));
    });
  });
});

describe('TripImportPage', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  async function renderImport(fragment: string | null) {
    configure(new MemoryStorage(), [{ provide: ActivatedRoute, useValue: { snapshot: { fragment } } }]);
    const fixture = TestBed.createComponent(TripImportPage);
    const el = fixture.nativeElement as HTMLElement;
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(el.querySelector('[data-shared], [data-invalid]')).toBeTruthy();
    });
    return { fixture, el, nav, trips: TestBed.inject(TripsService) };
  }

  it('previews a shared plan and saves a copy with a new id', async () => {
    const payload = await encodeTripShare(sevilleTrip(), [], NOW_MS);
    const { el, nav, trips } = await renderImport(`t=${payload}`);
    expect(clean(el.querySelector('[data-shared]')?.textContent)).toBe('Shared plan · Thu Oct 1');
    expect(clean(el.querySelector('.tc__name')?.textContent)).toBe('Seville');
    expect(clean(el.querySelector('.ti__split p')?.textContent)).toContain('Santa Justa');
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    const saved = trips.trips();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).not.toBe(SEVILLE_IDS.trip);
    expect(saved[0].sharedFrom).toEqual({ at: new Date(NOW_MS).toISOString() });
    expect(nav).toHaveBeenCalledWith(['/trips', saved[0].id], expect.objectContaining({ replaceUrl: true }));
  });

  it('"Not now" goes to Trips; a broken link says so', async () => {
    const { el, nav, trips } = await renderImport('t=zgarbage');
    expect(clean(el.querySelector('[data-invalid] h2')?.textContent)).toBe('This link could not be read');
    expect(trips.trips()).toHaveLength(0);
    el.querySelector<HTMLButtonElement>('.ui-circ')!.click();
    expect(nav).toHaveBeenCalledWith(['/trips'], expect.anything());
  });
});

describe('SettingsDataComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exports a JSON backup and imports one with counts', async () => {
    configure(seeded());
    const fixture = TestBed.createComponent(SettingsDataComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(clean(el.querySelector('.hint')?.textContent)).toContain('Your trips live on this device');

    let blob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((b: Blob) => { blob = b; return 'blob:y'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    el.querySelector<HTMLButtonElement>('[data-export]')!.click();
    fixture.detectChanges();
    expect(click).toHaveBeenCalled();
    const backup = await new Promise<string>(resolve => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob as unknown as Blob);
    });
    expect(JSON.parse(backup).kind).toBe('routes-backup');
    expect(clean(el.querySelector('.res')?.textContent)).toBe('Downloaded routes-trips-2026-10-01.json');

    // Import into an empty device: 1 added.
    TestBed.resetTestingModule();
    configure(new MemoryStorage());
    const f2 = TestBed.createComponent(SettingsDataComponent);
    await f2.whenStable();
    f2.componentInstance.importText(backup);
    f2.detectChanges();
    const el2 = f2.nativeElement as HTMLElement;
    expect(clean(el2.querySelector('.res')?.textContent)).toBe('Added 1 trip, updated 0');
    expect(TestBed.inject(TripsService).trips()).toHaveLength(1);
    f2.componentInstance.importText('not json');
    f2.detectChanges();
    expect(el2.querySelector('.res.is-err')).toBeTruthy();
  });
});
