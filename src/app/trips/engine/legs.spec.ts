import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { flightsOn } from '../../utils/week';
import { toUtcMs } from '../../utils/time';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../testing/seville-fixture';
import {
  itineraryFromRefs, itineraryFromSnapshot, legWindow, nextOpenLeg, refFromInstance, refsFromItinerary, resolveRef,
  sameRefs, sortLegs,
} from './legs';
import { directItinerary } from '../../utils/connections';
import type { TripLeg } from '../model';

describe('trip legs ↔ schedules', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('snapshots an instance and resolves it again', () => {
    const f = flightsOn('YUL', 'MAD', '2026-10-08')[0];
    const ref = refFromInstance(f);
    expect(ref).toEqual({
      flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08',
      depLocal: '17:55', arrLocal: '06:50', arrDateKey: '2026-10-09', aircraft: '333',
    });
    expect(resolveRef(ref)).toBe(f);
    expect(resolveRef({ ...ref, flightNumber: 'ac 834' })).toBe(f);
    expect(resolveRef({ ...ref, flightNumber: 'AC999' })).toBeNull();
    expect(resolveRef({ ...ref, dateKey: '2026-11-08' })).toBeNull();
  });

  it('round-trips itineraries through refs', () => {
    const it0 = directItinerary(flightsOn('LIS', 'YUL', '2026-10-13')[0]);
    const refs = refsFromItinerary(it0);
    const back = itineraryFromRefs(refs)!;
    expect(back.legs[0]).toBe(it0.legs[0]);
    expect(back.arriveUtc).toBe(it0.arriveUtc);
    expect(itineraryFromRefs([{ ...refs[0], flightNumber: 'AC1' }])).toBeNull();
    expect(itineraryFromRefs([])).toBeNull();
    const snap = itineraryFromSnapshot(refs)!;
    expect(snap.departUtc).toBe(it0.departUtc);
    expect(snap.arriveUtc).toBe(it0.arriveUtc);
    expect(snap.legs[0].durationMin).toBe(it0.legs[0].durationMin);
  });

  it('builds windows for flights and ground legs', () => {
    const trip = sevilleTrip();
    const [out, train, bus] = trip.legs;
    expect(legWindow(out)).toEqual({
      depUtc: toUtcMs('2026-10-08', '17:55', 'America/Toronto'),
      arrUtc: toUtcMs('2026-10-09', '06:50', 'Europe/Madrid'),
    });
    const tw = legWindow(train)!;
    expect(tw.depUtc).toBe(toUtcMs('2026-10-09', '12:00', 'Europe/Madrid'));
    expect(tw.arrUtc - tw.depUtc).toBe(250 * 60_000);
    expect(legWindow(bus)).toEqual({
      depUtc: toUtcMs('2026-10-12', '09:00', 'Europe/Madrid'),
      arrUtc: toUtcMs('2026-10-12', '14:45', 'Europe/Lisbon'),
    });
  });

  it('keeps legs chronological and finds the next open one', () => {
    const trip = sevilleTrip();
    const shuffled = [trip.legs[3], trip.legs[1], trip.legs[0], trip.legs[2]];
    expect(sortLegs(shuffled).map(l => l.id)).toEqual(trip.legs.map(l => l.id));
    expect(nextOpenLeg(trip, 0)!.id).toBe(SEVILLE_IDS.outbound);
    trip.legs[0].status = 'boarded';
    expect(nextOpenLeg(trip, 0)!.id).toBe(SEVILLE_IDS.train);
    trip.legs.forEach(l => (l.status = 'abandoned'));
    expect(nextOpenLeg(trip, 0)).toBeNull();
  });

  it('compares ref lists', () => {
    const t = sevilleTrip();
    const out = t.legs[0];
    if (out.kind !== 'flight') throw new Error();
    expect(sameRefs(out.refs, out.refs.map(r => ({ ...r, depLocal: '00:00' })))).toBe(true);
    expect(sameRefs(out.refs, out.alternates[0].refs)).toBe(false);
    expect(sameRefs(out.refs, [])).toBe(false);
  });

  it('never sorts an unsaved ground leg before the flight that lands at its airport', () => {
    const flight = (id: string, depKey: string, dep: string, arrKey: string, arr: string): TripLeg => ({
      kind: 'flight', id, role: 'outbound', status: 'planned', statusAt: null, note: '', provenance: 'scheduled', alternates: [],
      refs: [{ flightNumber: 'AC1', origin: 'YUL', dest: 'LHR', dateKey: depKey, depLocal: dep, arrLocal: arr, arrDateKey: arrKey, aircraft: null }],
    });
    const ground = (dateKey: string): TripLeg => ({
      kind: 'ground', id: 'g', mode: 'bus', status: 'planned', statusAt: null, note: '', provenance: 'estimated', userTimes: null,
      from: { name: 'London', code: 'LHR', lat: 51.47, lng: -0.45, tz: 'Europe/London' },
      to: { name: 'Oxford', lat: 51.75, lng: -1.26, tz: 'Europe/London' }, dateKey, estMinutes: 90,
    });
    // Lands 19:45 the same day: the ground leg follows it (not noon).
    const day = [ground('2026-10-08'), flight('f', '2026-10-08', '08:00', '2026-10-08', '19:45')];
    expect(sortLegs(day).map(l => l.id)).toEqual(['f', 'g']);
    expect(legWindow(day[0], day)!.depUtc).toBe(toUtcMs('2026-10-08', '20:30', 'Europe/London'));
    // Dated on the departure day of an overnight flight.
    const night = [ground('2026-10-08'), flight('f', '2026-10-08', '13:30', '2026-10-09', '01:15')];
    expect(sortLegs(night).map(l => l.id)).toEqual(['f', 'g']);
  });

  it('places an unsaved ground leg to an airport ahead of the flight leaving it that day', () => {
    const trip = sevilleTrip();
    const bus = trip.legs.find(l => l.id === SEVILLE_IDS.bus)!;
    if (bus.kind !== 'ground') throw new Error();
    const unsaved = { ...bus, userTimes: null, provenance: 'estimated' as const, dateKey: '2026-10-13', estMinutes: 60 };
    const legs = trip.legs.map(l => (l.id === bus.id ? unsaved : l));
    // AC813 leaves LIS 11:25 on Oct 13: arrive 2 h ahead → leave 08:25 at the latest.
    expect(legWindow(unsaved, legs)!.depUtc).toBe(toUtcMs('2026-10-13', '08:25', 'Europe/Lisbon'));
    expect(sortLegs([...legs].reverse()).map(l => l.id)).toEqual(trip.legs.map(l => l.id));
  });
});
