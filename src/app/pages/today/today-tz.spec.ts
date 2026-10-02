/**
 * Today in a browser far from the departure airport: day boundaries and
 * countdowns follow the airport's own calendar (with the BC 2026 and Morocco
 * overrides), never the device's time zone. The device runs in Tokyo here and
 * the clock is injected.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { GROUND_FETCH } from '../../places/ground-timetable.service';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { activeTravelDay } from '../../trips/engine/today';
import { type FlightLeg, TRIPS_KEY, type Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../trips/testing/seville-fixture';
import { dateKey, toUtcMs } from '../../utils/time';
import { bannerText, dayWord, leavesLabel, resolveToday, todayView } from './today-model';
import { TodayPage } from './today.page';

const CONNECT = { minConnect: 60 };
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** A trip with a single outbound flight leg. */
function oneLegTrip(ref: FlightLeg['refs'][0]): Trip {
  const t = sevilleTrip();
  const out = t.legs.find(l => l.id === SEVILLE_IDS.outbound) as FlightLeg;
  return { ...t, outboundDate: ref.dateKey, legs: [{ ...out, refs: [ref], alternates: [] }] };
}

describe('Today uses the departure airport time zone (device in Tokyo)', () => {
  let savedTz: string | undefined;

  beforeAll(() => {
    savedTz = process.env['TZ'];
    process.env['TZ'] = 'Asia/Tokyo';
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = savedTz;
  });
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('really runs with a non-Canadian device time zone', () => {
    expect(new Date(Date.UTC(2026, 9, 8)).getTimezoneOffset()).toBe(-540);
  });

  it('is not the travel day yet when it is already Oct 8 on the device but Oct 7 at YUL', () => {
    // Wed Oct 7 12:00 in Montréal = Thu Oct 8 01:00 in Tokyo.
    const now = toUtcMs('2026-10-07', '12:00', 'America/Toronto');
    expect(dateKey(new Date(now))).toBe('2026-10-08');
    const trips = [sevilleTrip()];
    expect(activeTravelDay(trips, now)).toBeNull();
    expect(resolveToday(trips, now)).toBeNull();
    expect(bannerText(trips, now, '24h')).toBeNull();
    const v = todayView({ trip: trips[0], legId: SEVILLE_IDS.outbound, nowMs: now, notes: [], outcomes: [], connect: CONNECT, fmt: '24h' })!;
    expect(v.eyebrow).toBe('Tomorrow · Thu Oct 8 · at YUL');
    expect(v.time).toBe('17:55');
    expect(v.zone).toBe('YUL time');
    expect(v.sub).toBe('AC834 · A330-300 · leaves in 29h55');
  });

  it('is the travel day at YUL even when the device calendar has moved on', () => {
    // Thu Oct 8 16:40 in Montréal = Fri Oct 9 05:40 in Tokyo.
    const now = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
    expect(dateKey(new Date(now))).toBe('2026-10-09');
    const trips = [sevilleTrip()];
    expect(resolveToday(trips, now)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound });
    expect(bannerText(trips, now, '24h')).toEqual({ title: 'Today · Montréal → Madrid', detail: 'AC834 17:55 YUL time · Listed' });
    const v = todayView({ trip: trips[0], legId: SEVILLE_IDS.outbound, nowMs: now, notes: [], outcomes: [], connect: CONNECT, fmt: '24h' })!;
    expect(v.eyebrow).toBe('Today · Thu Oct 8 · at YUL');
    expect(v.sub).toBe('AC834 · A330-300 · leaves in 1h15');
  });

  it('counts "N days" in calendar days at the airport', () => {
    // Fri Oct 2 22:00 → Thu Oct 8 06:00 at YUL: 5 days 8 hours, 6 calendar days.
    const now = toUtcMs('2026-10-02', '22:00', 'America/Toronto');
    const dep = toUtcMs('2026-10-08', '06:00', 'America/Toronto');
    expect(leavesLabel(dep, now, 'America/Toronto')).toBe('leaves in 6 days');
    expect(leavesLabel(dep, now)).toBe('leaves in 5 days');
  });

  it('follows BC permanent daylight time from Nov 2026 (YVR stays UTC−7)', () => {
    const trip = oneLegTrip({
      flightNumber: 'AC854', origin: 'YVR', dest: 'LHR', dateKey: '2026-11-03',
      depLocal: '07:00', arrLocal: '00:50', arrDateKey: '2026-11-04', aircraft: '789',
    });
    // 13:00Z = 06:00 at YVR under UTC−7 (it would be 05:00 under the old PST).
    const now = Date.UTC(2026, 10, 3, 13, 0);
    expect(dayWord('2026-11-03', now, 'YVR')).toBe('Today');
    const v = todayView({ trip, legId: SEVILLE_IDS.outbound, nowMs: now, notes: [], outcomes: [], connect: CONNECT, fmt: '24h' })!;
    expect(v.sub).toContain('leaves in 1h');
    expect(v.sub).not.toContain('leaves in 1h0');
    expect(v.zone).toBe('YVR time');
    // 06:30Z = Nov 2 23:30 at YVR (Nov 3 15:30 in Tokyo): not the travel day yet.
    const late = Date.UTC(2026, 10, 3, 6, 30);
    expect(dateKey(new Date(late))).toBe('2026-11-03');
    expect(activeTravelDay([trip], late)).toBeNull();
    expect(dayWord('2026-11-03', late, 'YVR')).toBe('Tomorrow');
  });

  it('follows Morocco staying on UTC+0 after Sep 20 2026', () => {
    const trip = oneLegTrip({
      flightNumber: 'AC881', origin: 'CMN', dest: 'YUL', dateKey: '2026-10-10',
      depLocal: '00:30', arrLocal: '04:00', arrDateKey: '2026-10-10', aircraft: '333',
    });
    // Oct 9 23:45Z is still Oct 9 in Casablanca (UTC+0), Oct 10 08:45 in Tokyo.
    const now = Date.UTC(2026, 9, 9, 23, 45);
    expect(activeTravelDay([trip], now)).toBeNull();
    const v = todayView({ trip, legId: SEVILLE_IDS.outbound, nowMs: now, notes: [], outcomes: [], connect: CONNECT, fmt: '24h' })!;
    expect(v.eyebrow).toBe('Tomorrow · Sat Oct 10 · at CMN');
    expect(v.sub).toContain('leaves in 45m');
  });

  it('renders the airport-local time labelled with the airport', async () => {
    const store = new MemoryStorage();
    store.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => toUtcMs('2026-10-08', '16:40', 'America/Toronto') },
        { provide: TRIPS_STORAGE, useValue: store },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: GROUND_FETCH, useValue: async () => null },
      ],
    });
    const fixture = TestBed.createComponent(TodayPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(clean(el.querySelector('.td__eyebrow')?.textContent)).toBe('Today · Thu Oct 8 · at YUL');
    expect(clean(el.querySelector('.td__time')?.textContent)).toBe('17:55');
    expect(clean(el.querySelector('[data-zone]')?.textContent)).toBe('YUL time');
    expect(clean(el.querySelector('.td__sub')?.textContent)).toBe('AC834 · A330-300 · leaves in 1h15');
  });
});
