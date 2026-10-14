import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { recoverView } from '../pages/today/today-model';
import { placeFromDestination } from '../places/place';
import { toUtcMs } from '../utils/time';
import { leavesGoalArea } from './engine/recover';
import { FlightLeg, Place, Trip } from './model';
import { stopForLeg } from './stops';
import { SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from './testing/seville-fixture';

function onward(dest: string, role: FlightLeg['role'] = 'onward'): FlightLeg {
  return {
    kind: 'flight', id: 'leg-onward', role, status: 'planned', statusAt: null, note: '', provenance: 'scheduled', alternates: [],
    refs: [{ flightNumber: 'AC999', origin: 'YUL', dest, dateKey: '2026-10-12', depLocal: '09:00', arrLocal: '12:00', arrDateKey: '2026-10-12', aircraft: null }],
  };
}

const place = (id: string, name: string, lat: number, lng: number): Place => ({ id, name, country: '', iso2: '', lat, lng, tz: null });
const withStops = (goal: Place, stop: Place, leg: FlightLeg): Trip => ({
  ...sevilleTrip(), goal, legs: [leg], stops: [{ id: 's1', place: stop, arriveDate: '2026-10-12' }],
});

describe('stopForLeg', () => {
  it('Cancun then Lima: an onward flight into Lima recovers toward Lima, the outbound toward Cancun', () => {
    const t = withStops(placeFromDestination('CUN'), placeFromDestination('LIM'), onward('LIM'));
    expect(stopForLeg(t, t.legs[0]).name).toBe('Lima');
    expect(stopForLeg(t, onward('CUN', 'outbound')).name).toBe('Cancún');
    expect(stopForLeg(t, onward('LIM', 'return')).name).toBe('Cancún');
  });

  it('Banff then Tofino: an onward flight into Vancouver is heading for Tofino, the nearer stop', () => {
    const banff = place('gn-banff', 'Banff', 51.18, -115.57);
    const tofino = place('gn-tofino', 'Tofino', 49.15, -125.9);
    const t = withStops(banff, tofino, onward('YVR'));
    expect(stopForLeg(t, t.legs[0]).name).toBe('Tofino');
    expect(stopForLeg({ ...t, stops: undefined }, t.legs[0]).name).toBe('Banff');
  });

  it('an onward flight leaves the goal area', () => {
    const t = withStops(placeFromDestination('CUN'), placeFromDestination('LIM'), onward('LIM'));
    expect(leavesGoalArea(t, t.legs[0])).toBe(true);
    expect(leavesGoalArea(t, onward('CUN', 'outbound'))).toBe(false);
  });
});

describe('recovery on an onward leg', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('names and searches toward the leg\'s own stop', () => {
    const lis = placeFromDestination('LIS');
    const t = withStops(sevilleTrip().goal, lis, onward('LIS'));
    const nowMs = toUtcMs('2026-10-12', '08:00', 'America/Toronto');
    const view = (trip: Trip) => recoverView({ trip, at: 'YUL', legId: 'leg-onward', nowMs, connect: {}, fmt: '24h' });
    expect(view(t).goal).toBe('Lisbon');
    expect(view({ ...t, legs: [onward('LIS', 'outbound')] }).goal).toBe('Seville');
  });
});
