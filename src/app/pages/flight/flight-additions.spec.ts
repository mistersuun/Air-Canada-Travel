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
import { agoLabel, factsView, noteFlights, noteRow, tripTarget, tripsCovering } from './flight-model';

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

  it('says "None found" for a day without departures and has no tiles outside coverage', () => {
    // AC866 does not fly Thursdays, AC864 does: Oct 8 has 1; a route with no row has none.
    expect(factsView(scheduleFacts('YUL', 'LHR', '2026-10-08'), null).tiles[0].value).toBe('1 · 22:10');
    expect(factsView(scheduleFacts('YUL', 'OPO', '2026-10-08'), null).tiles[0].value).toBe('None found');
    const out = factsView(scheduleFacts('YUL', 'LHR', '2028-01-10'), null);
    expect(out.covered).toBe(false);
    expect(out.tiles).toEqual([]);
  });

  it('writes a load note as "You checked at 14:05 · 3h ago" with a check or an x against the party', () => {
    const now = at('2026-10-09', '17:10');
    const ok = noteRow(note(), 2, now);
    expect(ok.title).toBe('AC864 · 14 open, 9 listed');
    expect(ok.when).toBe('You checked at 14:05 · 3h ago');
    expect(ok.mark).toBe('ok');
    expect(ok.markLabel).toBe('Open seats cover your 2');
    const short = noteRow(note({ flightNumber: 'AC866', open: 1, listed: 11 }), 2, now);
    expect(short.mark).toBe('short');
    expect(short.markLabel).toBe('Fewer open seats than your 2');
    expect(noteRow(note({ open: null, listed: null, text: 'Gate 52' }), 1, now).mark).toBeNull();
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

  it('"Add to Seville trip" adds the flight as a backup when the dates match', async () => {
    configure(at('2026-10-02', '09:00'));
    const { el, stable } = await render('LHR', '2026-10-08');
    const btn = el.querySelector('[data-add-trip]') as HTMLButtonElement;
    expect(clean(btn.textContent)).toBe('Add to Seville trip');
    btn.click();
    await stable();
    const out = storedTrip().legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    expect(out.kind === 'flight' && out.alternates.map(a => a.refs[0].flightNumber)).toEqual(['AC822', 'AC812', 'AC864']);
    expect(clean((el.querySelector('[data-add-trip]') as HTMLElement).textContent)).toBe('In Seville trip');
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
