import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_FETCH } from '../../live/flight-status.service';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { GROUND_FETCH, GroundTimetableService } from '../../places/ground-timetable.service';
import { FIXTURE_GROUND_FILE } from '../../places/testing/ground-fixture';
import { groundTimetables, setGroundTimetables } from '../../places/timetable';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { FLIGHTLOG_KEY, TRIPS_KEY, type Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { toUtcMs } from '../../utils/time';
import { RecoverPage } from './recover.page';
import { TodayBannerComponent } from './today-banner.component';
import { TodayPage } from './today.page';

const AT_1640 = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
const AT_1805 = toUtcMs('2026-10-08', '18:05', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

let storage: MemoryStorage;
/** The ground.json fetch (the service worker's cached copy in the app); specs count its calls. */
let groundFetch: ReturnType<typeof vi.fn>;

function seeded(withNote = true): MemoryStorage {
  const s = new MemoryStorage();
  s.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  if (withNote) {
    s.setItem(FLIGHTLOG_KEY, JSON.stringify({
      schema: 1, outcomes: [], dismissed: [],
      notes: [{
        id: 'n1', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', open: null, listed: null,
        text: 'Gate 52, 9 on the list', at: new Date(toUtcMs('2026-10-08', '16:20', 'America/Toronto')).toISOString(),
      }],
    }));
  }
  return s;
}

function configure(nowMs: number, store = seeded()) {
  storage = store;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => nowMs },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: STATUS_FETCH, useValue: async () => ({ status: 503, body: { error: 'not-configured' } }) },
      { provide: GROUND_FETCH, useValue: (groundFetch = vi.fn(async () => null)) },
    ],
  });
}

const stored = (): Trip => JSON.parse(storage.getItem(TRIPS_KEY)!).trips.find((t: Trip) => t.id === SEVILLE_IDS.trip);
const legStatus = (legId: string) => stored().legs.find(l => l.id === legId)!.status;

async function render<T>(cmp: new (...a: never[]) => T, nowMs: number, inputs: Record<string, string> = {}, store?: MemoryStorage) {
  configure(nowMs, store);
  const fixture = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const navUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return {
    fixture, el, nav, navUrl, stable,
    text: (sel: string) => clean(el.querySelector(sel)?.textContent),
    state: TestBed.inject(AppStateService), trips: TestBed.inject(TripsService),
  };
}

describe('Today', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('banner on Explore shows the travel day and links to /today', async () => {
    const { el, text } = await render(TodayBannerComponent, AT_1640);
    expect(text('[data-today-banner]')).toBe('Today · Montréal → MadridAC834 17:55 YUL time · Listed');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/today');
  });

  it('banner renders nothing on another day', async () => {
    const { el } = await render(TodayBannerComponent, AT_1640 - 2 * 86_400_000);
    expect(el.querySelector('[data-today-banner]')).toBeNull();
    expect(clean(el.textContent)).toBe('');
  });

  it('shows the travel-day timeline as an ordered list, past rows dimmed', async () => {
    const { el } = await render(TodayPage, AT_1805);
    const items = [...el.querySelectorAll('[data-timeline] ol > li')];
    expect(items.map(i => i.getAttribute('data-kind'))).toContain('depart');
    expect(items.find(i => i.getAttribute('data-kind') === 'depart')?.hasAttribute('data-past')).toBe(true);
    expect(items.find(i => i.getAttribute('data-kind') === 'arrive')?.hasAttribute('data-past')).toBe(false);
    expect(clean(el.querySelector('[data-kind="arrive"]')?.textContent)).toContain('+6h vs Montréal');
  });

  it('g4: time, status, countdown, note, three buttons, left to do and the backup', async () => {
    const { el, text } = await render(TodayPage, AT_1640);
    expect(text('.td__eyebrow')).toBe('Today · Thu Oct 8 · at YUL');
    expect(text('h1')).toBe('Montréal → Madrid');
    expect(text('.td__time')).toBe('17:55');
    expect(text('app-leg-status-tag')).toBe('Listed');
    expect(text('.td__sub')).toBe('AC834 · A330-300 · leaves in 1h15');
    expect(text('[data-note]')).toBe('Your note, 16:20 YUL time: Gate 52, 9 on the list');
    expect(text('[data-boarded]')).toBe('I boarded');
    expect(text('[data-not-boarded]')).toBe("I didn't board");
    expect(text('[data-plans-changed]')).toBe('Plans changed');
    const rows = [...el.querySelectorAll('.td__chk')].map(r => [clean(r.textContent), r.getAttribute('aria-checked')]);
    expect(rows).toEqual([['Listed for AC834', 'true'], ["Check in for AC834Before your pass's cutoff", 'false']]);
    expect(text('[data-backup]')).toBe("Backup tonight: AC812 to Lisbon 21:45Still possible if you don't clear AC834");
  });

  it('"I boarded" sets the status and records the outcome, with Undo', async () => {
    const { el, stable, state, trips } = await render(TodayPage, AT_1640);
    el.querySelector<HTMLButtonElement>('[data-boarded]')!.click();
    await stable();
    expect(legStatus(SEVILLE_IDS.outbound)).toBe('boarded');
    expect(trips.outcomes().map(o => [o.flightNumber, o.kind])).toEqual([['AC834', 'allBoarded']]);
    expect(el.querySelector('[data-final]')?.textContent).toContain('AC834 marked Boarded');
    expect(el.querySelector('[data-boarded]')).toBeNull();
    const notice = state.notice()!;
    expect(notice.message).toBe('Cleared · YUL → MAD · 5,552 km');
    notice.action!();
    await stable();
    expect(legStatus(SEVILLE_IDS.outbound)).toBe('listed');
    expect(trips.outcomes()).toEqual([]);
    expect(el.querySelector('[data-boarded]')).toBeTruthy();
  });

  it('"I didn\'t board" marks the leg and opens recovery at YUL', async () => {
    const { el, nav } = await render(TodayPage, AT_1640);
    el.querySelector<HTMLButtonElement>('[data-not-boarded]')!.click();
    expect(legStatus(SEVILLE_IDS.outbound)).toBe('notBoarded');
    expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip, 'recover'], { queryParams: { at: 'YUL', leg: SEVILLE_IDS.outbound } });
  });

  it('ticking Check in sets Checked in', async () => {
    const { el, stable } = await render(TodayPage, AT_1640);
    el.querySelector<HTMLButtonElement>(`[data-item="checkin:${SEVILLE_IDS.outbound}"]`)!.click();
    await stable();
    expect(legStatus(SEVILLE_IDS.outbound)).toBe('checkedIn');
    expect(el.querySelector(`[data-item="checkin:${SEVILLE_IDS.outbound}"]`)?.getAttribute('aria-checked')).toBe('true');
  });

  it('adds a note inline', async () => {
    const { el, stable, text, trips } = await render(TodayPage, AT_1640, {}, seeded(false));
    expect(el.querySelector('[data-note]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-add-note]')!.click();
    await stable();
    const input = el.querySelector<HTMLInputElement>('#td-note')!;
    input.value = 'Gate 52';
    input.dispatchEvent(new Event('input'));
    await stable();
    el.querySelector<HTMLFormElement>('.td__nf')!.dispatchEvent(new Event('submit'));
    await stable();
    expect(trips.notes().map(n => [n.flightNumber, n.text])).toEqual([['AC834', 'Gate 52']]);
    expect(text('[data-note]')).toBe('Your note, 16:40 YUL time: Gate 52');
  });

  it('Plans changed: pick another flight, change dates, drop the trip (with Undo)', async () => {
    const { el, stable, nav, navUrl, state } = await render(TodayPage, AT_1640);
    const open = async () => {
      el.querySelector<HTMLButtonElement>('[data-plans-changed]')!.click();
      await stable();
    };
    await open();
    document.querySelector<HTMLButtonElement>('[data-choice="pick"]')!.click();
    await stable();
    expect(nav).toHaveBeenLastCalledWith(['/trips', SEVILLE_IDS.trip, 'recover'], { queryParams: { at: 'YUL', leg: SEVILLE_IDS.outbound } });
    expect(legStatus(SEVILLE_IDS.outbound)).toBe('listed');

    await open();
    document.querySelector<HTMLButtonElement>('[data-choice="dates"]')!.click();
    await stable();
    expect(navUrl).toHaveBeenLastCalledWith(`/trips/${SEVILLE_IDS.trip}?tab=return`);

    await open();
    document.querySelector<HTMLButtonElement>('[data-choice="drop"]')!.click();
    await stable();
    expect(stored().archived).toBe(true);
    expect(nav).toHaveBeenLastCalledWith(['/trips']);
    state.notice()!.action!();
    expect(stored().archived).toBe(false);
  });

  it('says "Nothing planned today" with a link to Trips', async () => {
    const { el, text } = await render(TodayPage, AT_1640 + 3 * 86_400_000);
    expect(text('[data-empty] h1')).toBe('Nothing planned today');
    expect(el.querySelector('[data-empty] a')?.getAttribute('href')).toBe('/trips');
  });

  it('makes no direct network calls besides the ground timetable (cached data); live status goes through its own injectable fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render(TodayPage, AT_1640);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(groundFetch).toHaveBeenCalledTimes(1);
  });

  it('loads the ground timetable itself, so ground legs get real times without another screen', async () => {
    setGroundTimetables(null);
    configure(AT_1640);
    groundFetch.mockImplementation(async () => structuredClone(FIXTURE_GROUND_FILE));
    const fixture = TestBed.createComponent(TodayPage);
    await fixture.whenStable();
    await vi.waitFor(() => expect(TestBed.inject(GroundTimetableService).status()).toBe('ready'));
    expect(groundFetch).toHaveBeenCalledTimes(1);
    expect(groundTimetables()?.corridors.size).toBeGreaterThan(0);
    setGroundTimetables(null);
  });
});

describe('Recover', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  function notBoardedStore(): MemoryStorage {
    const s = seeded(false);
    const file = JSON.parse(s.getItem(TRIPS_KEY)!);
    file.trips[0].legs = file.trips[0].legs.map((l: { id: string }) => (l.id === SEVILLE_IDS.outbound ? { ...l, status: 'notBoarded' } : l));
    s.setItem(TRIPS_KEY, JSON.stringify(file));
    return s;
  }

  it('g5: header, goal card, greyed reasons, tomorrow and the nights note', async () => {
    const { el, text } = await render(RecoverPage, AT_1805, { id: SEVILLE_IDS.trip, at: 'YUL', leg: SEVILLE_IDS.outbound }, notBoardedStore());
    expect(text('h1')).toBe('Still reachable');
    expect(text('.rc__sub')).toBe('From YUL · now 18:05');
    expect(text('[data-goal]')).toBe('Goal Seville · home by Tue 22:00 · AC834 marked Not boarded');
    const tonight = [...el.querySelectorAll('[data-group="tonight"] .rc__row')];
    expect(tonight.map(r => [r.getAttribute('data-gateway'), r.getAttribute('data-status'), !!r.querySelector('.rc__use')])).toEqual([
      ['LIS', 'usable', true], ['BCN', 'closed', false], ['MAD', 'missedConnection', false],
    ]);
    expect(clean(tonight[0].querySelector('.rc__rt')!.textContent)).toBe('LisbonLISAC812 21:45 → 09:20⁺¹then bus about 6h45 · Seville Fri evening');
    expect(clean(tonight[1].textContent)).toContain('boarding has likely closed');
    expect(clean(tonight[2].textContent)).toContain('AC427 lands 21:53, after AC824 leaves at 19:15');
    expect(clean(el.querySelector('[data-group="tomorrow"] .rc__row .rc__rt')!.textContent)).toBe('Madrid againMADFri AC834 17:55 · Seville Sat midday');
    expect(text('[data-note]')).toBe('Your Tuesday return still works either way. Lisbon tonight keeps all 3 nights in Seville; waiting for Madrid tomorrow leaves 2.');
  });

  it('shows the other gateways for tomorrow on request', async () => {
    const { el, stable } = await render(RecoverPage, AT_1805, { id: SEVILLE_IDS.trip, at: 'YUL', leg: SEVILLE_IDS.outbound }, notBoardedStore());
    const before = el.querySelectorAll('[data-group="tomorrow"] .rc__row').length;
    el.querySelector<HTMLButtonElement>('[data-more]')!.click();
    await stable();
    expect(el.querySelectorAll('[data-group="tomorrow"] .rc__row').length).toBeGreaterThan(before);
    expect(el.querySelector('[data-more]')).toBeNull();
  });

  it('"Use" swaps the leg, opens the trip and flashes "Listing is still your step" with Undo', async () => {
    const { el, navUrl, state } = await render(RecoverPage, AT_1805, { id: SEVILLE_IDS.trip, at: 'YUL', leg: SEVILLE_IDS.outbound }, notBoardedStore());
    el.querySelector<HTMLButtonElement>('[data-gateway="LIS"] .rc__use')!.click();
    const trip = stored();
    const fresh = trip.legs.find(l => l.kind === 'flight' && l.refs[0].flightNumber === 'AC812');
    expect(fresh?.status).toBe('planned');
    expect(legStatus(SEVILLE_IDS.outbound)).toBe('notBoarded');
    expect(navUrl).toHaveBeenCalledWith(`/trips/${SEVILLE_IDS.trip}`);
    const notice = state.notice()!;
    expect(notice.message).toBe('Swapped to AC812 · Listing is still your step');
    notice.action!();
    expect(stored().legs.some(l => l.kind === 'flight' && l.refs[0].flightNumber === 'AC812')).toBe(false);
  });

  it('a missing trip says so', async () => {
    const { text } = await render(RecoverPage, AT_1805, { id: 'nope' });
    expect(text('h1')).toBe('Trip not found');
  });
});
