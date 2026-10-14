import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { placeFromDestination } from '../places/place';
import { directItineraries } from '../utils/connections';
import { toUtcMs } from '../utils/time';
import { AppStateService, NOW } from '../state/app-state.service';
import { PROFILE_STORAGE } from '../recs/profile.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { TRIPS_KEY } from './model';
import { TRIPS_STORAGE } from './storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from './testing/seville-fixture';
import { TripsService } from './trips.service';

const nowMs = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const ID = SEVILLE_IDS.trip;

function make(): { svc: TripsService; store: MemoryStorage; state: AppStateService } {
  const store = new MemoryStorage();
  store.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => nowMs },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: PROFILE_STORAGE, useValue: new MemoryStorage() },
    ],
  });
  return { svc: TestBed.inject(TripsService), store, state: TestBed.inject(AppStateService) };
}

describe('trip editing', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('renames and persists, ignoring blank names', () => {
    const { svc, store } = make();
    svc.rename(ID, '  Spring in Spain ');
    expect(svc.trip(ID)!.name).toBe('Spring in Spain');
    expect(JSON.parse(store.getItem(TRIPS_KEY)!).trips[0].name).toBe('Spring in Spain');
    svc.rename(ID, '   ');
    expect(svc.trip(ID)!.name).toBe('Spring in Spain');
  });

  it('removes a leg and its waiting changes, and Undo puts it back in order', () => {
    const { svc, state } = make();
    svc.removeLeg(ID, SEVILLE_IDS.train);
    expect(svc.trip(ID)!.legs.map(l => l.id)).not.toContain(SEVILLE_IDS.train);
    expect(state.notice()?.actionLabel).toBe('Undo');
    state.notice()!.action!();
    expect(svc.trip(ID)!.legs.map(l => l.id)).toEqual([SEVILLE_IDS.outbound, SEVILLE_IDS.train, SEVILLE_IDS.bus, SEVILLE_IDS.ret]);
  });

  it('removing an unknown leg does nothing', () => {
    const { svc } = make();
    const before = svc.trip(ID);
    svc.removeLeg(ID, 'nope');
    expect(svc.trip(ID)).toBe(before);
  });

  it('adds stops in arrival order, removes one with Undo, and keeps goal first', () => {
    const { svc, state } = make();
    const lis = svc.addStop(ID, placeFromDestination('LIS'), '2026-10-12');
    const mad = svc.addStop(ID, placeFromDestination('MAD'), '2026-10-10');
    expect(svc.trip(ID)!.stops!.map(s => s.id)).toEqual([mad, lis]);
    expect(svc.trip(ID)!.goal.name).toBe('Seville');
    svc.removeStop(ID, mad);
    expect(svc.trip(ID)!.stops!.map(s => s.id)).toEqual([lis]);
    state.notice()!.action!();
    expect(svc.trip(ID)!.stops!.map(s => s.id)).toEqual([mad, lis]);
    svc.removeStop(ID, lis);
    svc.removeStop(ID, mad);
    expect(svc.trip(ID)!.stops).toBeUndefined();
    expect(svc.addStop('nope', placeFromDestination('LIS'), '2026-10-12')).toBe('');
  });

  it('moves the outbound date: the flight is swapped, the old one dropped, the ground leg re-dated', () => {
    const { svc } = make();
    const it = directItineraries('YUL', 'MAD', '2026-10-09')[0];
    svc.setOutboundDate(ID, '2026-10-09', it);
    const t = svc.trip(ID)!;
    expect(t.outboundDate).toBe('2026-10-09');
    expect(t.legs.find(l => l.id === SEVILLE_IDS.outbound)!.status).toBe('abandoned');
    const fresh = t.legs.find(l => l.kind === 'flight' && l.role === 'outbound' && l.status === 'planned');
    expect(fresh && fresh.kind === 'flight' && fresh.refs[0].dateKey).toBe('2026-10-09');
    expect(t.homeBy.dateKey).toBe('2026-10-13');
  });

  it('without a flight that day the legs stay and only the date moves; home-by follows when it would be before', () => {
    const { svc } = make();
    svc.setOutboundDate(ID, '2026-10-20', null);
    const t = svc.trip(ID)!;
    expect(t.outboundDate).toBe('2026-10-20');
    expect(t.legs).toHaveLength(4);
    expect(t.legs[0].status).toBe('listed');
    expect(t.homeBy.dateKey).toBe('2026-10-25');   // the 5-day stay is kept
  });
});
