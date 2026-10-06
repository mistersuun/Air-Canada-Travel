import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { toUtcMs } from '../../utils/time';
import { DestTripActionsComponent, coveringTrip, tripAddition } from './dest-trip-actions.component';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');

function configure(seed: boolean, now = NOW_MS) {
  const store = new MemoryStorage();
  if (seed) store.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: NOW, useValue: () => now },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
    ],
  });
}

async function render(code: string, day: string | null) {
  TestBed.inject(AppStateService).selectDay(day);
  const f = TestBed.createComponent(DestTripActionsComponent);
  f.componentRef.setInput('code', code);
  f.detectChanges();
  await f.whenStable();
  return f;
}

beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
afterEach(() => resetScheduleSource());

describe('DestTripActionsComponent', () => {
  it('offers "Start a trip to Lisbon" without a covering trip, and starts one', async () => {
    configure(false);
    const f = await render('LIS', '2026-10-08');
    const btn = f.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent!.trim()).toBe('Start a trip to Lisbon');
    btn.click();
    await f.whenStable();
    const trip = TestBed.inject(TripsService).trips()[0];
    expect(trip.goal).toMatchObject({ id: 'ac-LIS', name: 'Lisbon', acCode: 'LIS' });
    expect(trip.outboundDate).toBe('2026-10-08');
    expect(trip.homeBy).toEqual({ dateKey: '2026-10-13', hhmm: '22:00' });
    // No flight is chosen for the user: the trip starts empty and they are sent to pick one.
    expect(trip.legs).toEqual([]);
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/flight/LIS/2026-10-08');
    expect(TestBed.inject(AppStateService).notice()?.message).toContain('Pick your flight');
  });

  it('sends the user to the day picker when nothing flies on the selected day', async () => {
    configure(false);
    const f = await render('LIS', '2026-10-10');
    (f.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await f.whenStable();
    expect(TestBed.inject(TripsService).trips()[0].legs).toEqual([]);
    expect(TestBed.inject(Router).url.split('?')[0]).toBe('/calendar/LIS');
  });

  it('offers "Add to Seville trip" when the active trip covers the selected day', async () => {
    configure(true);
    const f = await render('LIS', '2026-10-08');
    expect((f.nativeElement as HTMLElement).textContent!.trim()).toBe('Add to Seville trip');
    // Outside the trip dates: Start again.
    const g = await render('LIS', '2026-10-20');
    expect((g.nativeElement as HTMLElement).textContent!.trim()).toBe('Start a trip to Lisbon');
  });

  it('with no day selected, offers the trip that is under way today', async () => {
    configure(true, toUtcMs('2026-10-10', '09:00', 'America/Toronto'));
    const f = await render('LIS', null);
    expect((f.nativeElement as HTMLElement).textContent!.trim()).toBe('Add to Seville trip');
  });

  it('adds a same-day flight as a backup of the outbound leg, or a new leg otherwise', () => {
    configure(true);
    const trips = TestBed.inject(TripsService);
    const trip = trips.trip(SEVILLE_IDS.trip)!;
    expect(coveringTrip(trips.activeTrips(), '2026-10-08')?.id).toBe(trip.id);
    expect(coveringTrip(trips.activeTrips(), null)).toBeNull();
    const lhr = tripAddition(trip, 'LHR', '2026-10-08');
    expect(lhr.it!.legs[0].flightNumber).toBe('AC864');
    expect(lhr.backupOf?.id).toBe(SEVILLE_IDS.outbound);
    expect(lhr.role).toBe('outbound');
    const back = tripAddition(trip, 'MAD', '2026-10-12');
    expect(back.it!.legs[0].flightNumber).toBe('AC835');
    expect(back.role).toBe('return');
  });
});
