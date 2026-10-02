import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { scheduleFacts } from '../../trips/engine/facts';
import { holidayNote } from '../../trips/engine/holidays';
import { FLIGHTLOG_KEY, LoadNote, TRIPS_KEY, Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { allItineraries } from '../../utils/connections';
import { toUtcMs } from '../../utils/time';
import { FlightPage } from './flight.page';
import { agoLabel, factsView, noteFlights, noteRow, tripConnects, tripTarget, tripsCovering, tripsFor } from './flight-model';

const TZ = 'America/Toronto';
const at = (key: string, hhmm: string) => toUtcMs(key, hhmm, TZ);
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function note(p: Partial<LoadNote> = {}): LoadNote {
  return {
    id: 'n1', flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 14, listed: 9, text: '',
    at: new Date(at('2026-10-09', '14:05')).toISOString(), ...p,
  };
}

describe('flight page model (g6)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('turns the YUL → LHR Fri Oct 9 facts into the four g6 tiles and the Thanksgiving note', () => {
    const v = factsView(scheduleFacts('YUL', 'LHR', '2026-10-09'), holidayNote('2026-10-09'));
    expect(v.covered).toBe(true);
    expect(v.tiles).toEqual([
      { label: 'Departures', value: '2 · 18:40, 22:10' },
      { label: 'Last one', value: 'AC864 22:10' },
      { label: 'Aircraft', value: 'A330-300 ×2' },
      { label: 'Next day', value: '2 departures' },
    ]);
    expect(v.holiday).toBe('Canadian Thanksgiving weekend (Mon Oct 12). Often busy, check loads.');
  });

  it('says "None in our schedule data" for a day without departures and has no tiles outside coverage', () => {
    // AC866 does not fly Thursdays, AC864 does: Oct 8 has 1; a route with no row has none.
    expect(factsView(scheduleFacts('YUL', 'LHR', '2026-10-08'), null).tiles[0].value).toBe('1 · 22:10');
    expect(factsView(scheduleFacts('YUL', 'OPO', '2026-10-08'), null).tiles[0].value).toBe('None in our schedule data');
    const out = factsView(scheduleFacts('YUL', 'LHR', '2028-01-10'), null);
    expect(out.covered).toBe(false);
    expect(out.tiles).toEqual([]);
  });

  it('writes a load note as "You checked at 14:05 · 3h ago" with no pass/fail mark against the party', () => {
    const now = at('2026-10-09', '17:10');
    const ok = noteRow(note(), 2, now);
    expect(ok.title).toBe('AC864 · 14 open, 9 listed');
    expect(ok.when).toBe('You checked at 14:05 · 3h ago');
    expect(ok).not.toHaveProperty('mark');
    const many = noteRow(note({ flightNumber: 'AC866', open: 5, listed: 20 }), 2, now);
    expect(many.title).toBe('AC866 · 5 open, 20 listed');
    expect(noteRow(note(), 1, at('2026-10-10', '09:00')).when).toBe('You checked at Fri Oct 9, 14:05 · 18h ago');
  });

  it('formats ages without odds or percentages', () => {
    expect(agoLabel(10_000)).toBe('just now');
    expect(agoLabel(25 * 60_000)).toBe('25 min ago');
    expect(agoLabel(3 * 3600_000 + 5)).toBe('3h ago');
    expect(agoLabel(50 * 3600_000)).toBe('2 days ago');
  });

  it('lists every segment of the day as a note target, connections included', () => {
    const its = allItineraries('YUL', 'LIS', '2026-10-08', { minConnect: 60 });
    const keys = noteFlights(its).map(f => f.key);
    expect(keys).toContain('AC812|YUL|2026-10-08');
    expect(keys).toContain('AC427|YUL|2026-10-08');
    expect(keys).toContain('AC810|YYZ|2026-10-08');
  });

  it('adds a same-day flight as a backup, knows one already there, and else adds a leg', () => {
    const trip = sevilleTrip();
    const day = (dest: string, key: string) => allItineraries('YUL', dest, key, { minConnect: 60 }).find(i => !i.hubs.length)!;
    expect(tripTarget(trip, day('MAD', '2026-10-08'))).toEqual({ kind: 'already', legId: SEVILLE_IDS.outbound });
    expect(tripTarget(trip, day('LIS', '2026-10-08')).kind).toBe('already');
    expect(tripTarget(trip, day('LHR', '2026-10-08'))).toEqual({ kind: 'alternate', legId: expect.any(String), flight: 'AC834' });
    expect(tripTarget(trip, day('LHR', '2026-10-09'))).toEqual({ kind: 'leg', role: 'onward' });
    expect(tripsCovering([trip], '2026-10-07').length).toBe(1);
    expect(tripsCovering([trip], '2026-10-14').length).toBe(0);
    expect(tripsCovering([{ ...trip, archived: true }], '2026-10-09').length).toBe(0);
  });

  it('connects a flight to a trip only when it goes to the trip side or comes home from it', () => {
    const trip = sevilleTrip();
    const f = (origin: string, dest: string, dateKey = '2026-10-08') => ({ origin, dest, dateKey });
    // Leg endpoints and backups.
    expect(tripConnects(trip, f('YUL', 'MAD'))).toBe(true);
    expect(tripConnects(trip, f('YUL', 'BCN'))).toBe(true);
    // Near the goal (Porto is ~400 km from Seville), from another hub too.
    expect(tripConnects(trip, f('YUL', 'OPO'))).toBe(true);
    expect(tripConnects(trip, f('YYZ', 'MAD'))).toBe(true);
    // Coming home from the trip side.
    expect(tripConnects(trip, f('LIS', 'YUL'))).toBe(true);
    // Unrelated places, even from the home hub on the trip's dates.
    expect(tripConnects(trip, f('YUL', 'LHR'))).toBe(false);
    expect(tripConnects(trip, f('YUL', 'CUN'))).toBe(false);
    expect(tripConnects(trip, f('YUL', 'YYZ'))).toBe(false);
    expect(tripConnects(trip, f('LHR', 'YUL'))).toBe(false);
    // A goal AC flies to itself counts.
    const lis = { ...trip, legs: [], goal: { ...trip.goal, acCode: 'FAO', lat: 37.01, lng: -7.97 } };
    expect(tripConnects(lis, f('YUL', 'FAO'))).toBe(true);
    // tripsFor: dates and connection both.
    expect(tripsFor([trip], f('YUL', 'MAD'))).toHaveLength(1);
    expect(tripsFor([trip], f('YUL', 'LHR'))).toHaveLength(0);
    expect(tripsFor([trip], f('YUL', 'MAD', '2026-10-20'))).toHaveLength(0);
  });

  it('connects a hop between the home hub and the home airport, and a flight the trip already holds', () => {
    const trip = { ...sevilleTrip(), fromHub: 'YUL', homeAirport: 'YOW' };
    const f = (origin: string, dest: string, dateKey = '2026-10-08') => ({ origin, dest, dateKey });
    expect(tripConnects(trip, f('YUL', 'YOW'))).toBe(true);
    expect(tripConnects(trip, f('YOW', 'YUL'))).toBe(true);
    // Home hub = home airport: a flight to another Canadian hub still does not connect.
    expect(tripConnects(sevilleTrip(), f('YUL', 'YOW'))).toBe(false);
    // A flight the trip already holds connects (tripTarget 'already').
    const mad = allItineraries('YUL', 'MAD', '2026-10-08', { minConnect: 60 }).find(i => !i.hubs.length)!;
    expect(tripsFor([trip], mad)).toHaveLength(1);
  });
});

describe('FlightPage additions (g6)', () => {
  let trips: MemoryStorage;

  function configure(nowMs: number, opts: { seedTrip?: boolean; notes?: LoadNote[] } = {}) {
    trips = new MemoryStorage();
    if (opts.seedTrip !== false) trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    if (opts.notes) trips.setItem(FLIGHTLOG_KEY, JSON.stringify({ schema: 1, notes: opts.notes, outcomes: [], dismissed: [] }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => nowMs },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: TRIPS_STORAGE, useValue: trips },
      ],
    });
  }

  async function render(code: string, date: string) {
    const fixture = TestBed.createComponent(FlightPage);
    fixture.componentRef.setInput('code', code);
    fixture.componentRef.setInput('date', date);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const stable = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { el, nav, stable, svc: TestBed.inject(TripsService), state: TestBed.inject(AppStateService) };
  }

  const storedTrip = (): Trip => JSON.parse(trips.getItem(TRIPS_KEY)!).trips.find((t: Trip) => t.id === SEVILLE_IDS.trip);

  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('shows the facts tiles and the Thanksgiving note on /flight/LHR/2026-10-09', async () => {
    configure(at('2026-10-02', '09:00'));
    const { el } = await render('LHR', '2026-10-09');
    const tiles = [...el.querySelectorAll('[data-facts] dl > div')].map(d => clean(d.textContent));
    expect(tiles).toEqual(['Departures2 · 18:40, 22:10', 'Last oneAC864 22:10', 'AircraftA330-300 ×2', 'Next day2 departures']);
    expect(clean(el.querySelector('[data-holiday]')?.textContent)).toContain('Canadian Thanksgiving weekend (Mon Oct 12)');
    expect(clean(el.querySelector('[data-facts]')?.textContent)).toContain('Scheduled');
    expect(clean(el.querySelector('[data-load-notes] [data-empty]')?.textContent))
      .toBe('Write down what you see in your load tool. Notes stay on this device.');
    // The existing sections are still there.
    expect(el.querySelector('app-ticket')).toBeTruthy();
    expect(el.textContent).toContain('If you miss this');
  });

  it('adds a load note through the sheet and shows when it was written; it persists', async () => {
    configure(at('2026-10-09', '14:05'));
    const { el, stable, svc } = await render('LHR', '2026-10-09');
    (el.querySelector('[data-load-notes] [data-add]') as HTMLButtonElement).click();
    await stable();
    const sheet = el.querySelector('app-note-sheet')!;
    const select = sheet.querySelector('[data-flight]') as HTMLSelectElement;
    select.value = 'AC864|YUL|2026-10-09';
    select.dispatchEvent(new Event('change'));
    const type = (sel: string, v: string) => {
      const i = sheet.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    type('[data-open]', '14');
    type('[data-listed]', '9');
    await stable();
    (sheet.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await stable();
    expect(el.querySelector('app-note-sheet')).toBeNull();
    const row = clean(el.querySelector('[data-load-notes] [data-note]')?.textContent);
    expect(row).toContain('AC864 · 14 open, 9 listed');
    expect(row).toContain('You checked at 14:05 · just now');
    expect(svc.notesFor('AC864', 'YUL', '2026-10-09')).toHaveLength(1);
    expect(JSON.parse(trips.getItem(FLIGHTLOG_KEY)!).notes[0]).toMatchObject({ open: 14, listed: 9, flightNumber: 'AC864' });
  });

  it('asks how a trip flight went 30 min after it left; answering records it and hides the card', async () => {
    configure(at('2026-10-08', '18:30'));
    const { el, stable, svc } = await render('MAD', '2026-10-08');
    expect(el.querySelector('app-outcome-prompt')).toBeTruthy();
    expect(clean(el.querySelector('app-outcome-prompt .op__k')?.textContent)).toBe('AC834 · Thu Oct 8 · YUL → MAD');
    expect([...el.querySelectorAll('app-outcome-prompt [data-kind]')].map(b => clean(b.textContent)))
      .toEqual(['Everyone boarded', 'Some of us', "Didn't board", "Didn't try"]);
    (el.querySelector('app-outcome-prompt [data-kind="allBoarded"]') as HTMLButtonElement).click();
    await stable();
    expect(el.querySelector('app-outcome-prompt')).toBeNull();
    expect(svc.outcomes()).toHaveLength(1);
    expect(svc.outcomes()[0]).toMatchObject({ kind: 'allBoarded', partySize: 2, tripId: SEVILLE_IDS.trip });
    expect(storedTrip().legs.find(l => l.id === SEVILLE_IDS.outbound)!.status).toBe('boarded');
  });

  it('shows no prompt before departure + 30 min', async () => {
    configure(at('2026-10-08', '18:10'));
    const { el } = await render('MAD', '2026-10-08');
    expect(el.querySelector('app-outcome-prompt')).toBeNull();
  });

  it('"Add to Seville trip" adds a flight to the trip side as a backup when the dates match', async () => {
    configure(at('2026-10-02', '09:00'));
    // Make Oct 8 YUL → OPO a connection to the trip: OPO flies Fri, so move the outbound to Fri Oct 9.
    const file = JSON.parse(JSON.stringify(SEVILLE_TRIPS_FILE));
    const leg = file.trips[0].legs.find((l: { id: string }) => l.id === SEVILLE_IDS.outbound);
    leg.refs[0] = { ...leg.refs[0], dateKey: '2026-10-09', arrDateKey: '2026-10-10' };
    trips.setItem(TRIPS_KEY, JSON.stringify(file));
    const { el, stable } = await render('OPO', '2026-10-09');
    const btn = el.querySelector('[data-add-trip]') as HTMLButtonElement;
    expect(clean(btn.textContent)).toBe('Add to Seville trip');
    btn.click();
    await stable();
    const out = storedTrip().legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    expect(out.kind === 'flight' && out.alternates.map(a => a.refs[0].flightNumber)).toEqual(['AC822', 'AC812', 'AC928']);
    expect(clean((el.querySelector('[data-add-trip]') as HTMLElement).textContent)).toBe('In Seville trip');
  });

  it('does not offer an unrelated flight on the trip dates to the trip, and starts a new one instead', async () => {
    configure(at('2026-10-02', '09:00'));
    const { el, svc } = await render('LHR', '2026-10-08');
    const btn = el.querySelector('[data-add-trip]') as HTMLButtonElement;
    expect(clean(btn.textContent)).toBe('Start a trip');
    btn.click();
    expect(svc.trips()).toHaveLength(2);
    const seville = storedTrip().legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    expect(seville.kind === 'flight' && seville.alternates).toHaveLength(2);
  });

  it('offers "Start a trip" with no trip on those dates and opens the new trip', async () => {
    configure(at('2026-10-02', '09:00'), { seedTrip: false });
    const { el, nav, svc } = await render('LHR', '2026-10-09');
    const btn = el.querySelector('[data-add-trip]') as HTMLButtonElement;
    expect(clean(btn.textContent)).toBe('Start a trip');
    btn.click();
    const t = svc.trips()[0];
    expect(t.goal.acCode ?? t.goal.name).toBeTruthy();
    expect(t.outboundDate).toBe('2026-10-09');
    expect(t.legs).toHaveLength(1);
    expect(nav).toHaveBeenCalledWith(['/trips', t.id], expect.anything());
  });
});
