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
});
