import { describe, expect, it } from 'vitest';
import { placeFromDestination } from '../places/place';
import { Trip, TRIPS_SCHEMA } from './model';
import { decodeTripShare, encodeTripShare, toBase64Url } from './share-codec';
import { migrateTrips, sanitizeTrip, tripsLossy } from './storage';
import { forGroup } from '../group/group-doc';
import { currentStop, isMultiStop, lastStopPlace, stopNames, tripStops, withStop, withoutStop } from './stops';
import { SEVILLE_PLACE, SEVILLE_TRIP, sevilleTrip } from './testing/seville-fixture';

const LISBON = placeFromDestination('LIS');
const withLisbon = (): Trip => withStop(sevilleTrip(), { id: 'stop-lis', place: LISBON, arriveDate: '2026-10-12' });

describe('stops helpers', () => {
  it('a trip without stops has one stop, the goal', () => {
    const t = sevilleTrip();
    expect(isMultiStop(t)).toBe(false);
    expect(tripStops(t).map(s => s.place.name)).toEqual(['Seville']);
    expect(lastStopPlace(t)).toEqual(SEVILLE_PLACE);
    expect(currentStop(t, '2026-10-20').id).toBe('goal');
    expect(stopNames(t)).toBe('Seville');
  });

  it('the goal stays first and the last stop is where you head home from', () => {
    const t = withLisbon();
    expect(t.goal.name).toBe('Seville');
    expect(isMultiStop(t)).toBe(true);
    expect(tripStops(t).map(s => s.id)).toEqual(['goal', 'stop-lis']);
    expect(tripStops(t)[0].leaveDate).toBe('2026-10-12');
    expect(lastStopPlace(t).name).toBe('Lisbon');
    expect(stopNames(t)).toBe('Seville and Lisbon');
  });

  it('currentStop is the latest stop you have arrived at', () => {
    const t = withLisbon();
    expect(currentStop(t, '2026-10-09').id).toBe('goal');
    expect(currentStop(t, '2026-10-12').id).toBe('stop-lis');
    expect(currentStop(t, '2026-10-13').place.name).toBe('Lisbon');
  });

  it('keeps stops ordered by arrival and removes them again', () => {
    let t = withLisbon();
    t = withStop(t, { id: 'stop-mad', place: placeFromDestination('MAD'), arriveDate: '2026-10-10' });
    expect(t.stops!.map(s => s.id)).toEqual(['stop-mad', 'stop-lis']);
    t = withoutStop(withoutStop(t, 'stop-mad'), 'stop-lis');
    expect(t.stops).toBeUndefined();
    expect('stops' in t).toBe(false);
  });
});

describe('trips schema 1 -> 2', () => {
  it('is 2', () => expect(TRIPS_SCHEMA).toBe(2));

  it('a schema-1 file (no stops) loads losslessly and is not read-only', () => {
    const v1 = JSON.parse(JSON.stringify({ schema: 1, trips: [SEVILLE_TRIP] }));
    const { file, readOnly } = migrateTrips(v1);
    expect(readOnly).toBe(false);
    expect(file.schema).toBe(2);
    expect(file.trips).toHaveLength(1);
    // Every v1 field survives untouched and no stops appear.
    expect(file.trips[0]).toEqual(SEVILLE_TRIP);
    expect(file.trips[0].stops).toBeUndefined();
    expect(tripsLossy(v1, file)).toBe(false);
  });

  it('stops round-trip through sanitizeTrip, dropping only bad ones', () => {
    const raw = JSON.parse(JSON.stringify(withLisbon()));
    raw.stops.push({ id: 'bad', place: { id: '' }, arriveDate: 'nope' });
    raw.stops.push({ ...raw.stops[0] });   // duplicate id
    const t = sanitizeTrip(raw)!;
    expect(t.stops).toEqual([{ id: 'stop-lis', place: LISBON, arriveDate: '2026-10-12' }]);
    expect(tripsLossy({ trips: [raw] }, { schema: 2, trips: [t] })).toBe(true);
  });

  it('a leaveDate before the arrival is dropped', () => {
    const raw = JSON.parse(JSON.stringify(withLisbon()));
    raw.stops[0].leaveDate = '2026-10-01';
    expect(sanitizeTrip(raw)!.stops![0].leaveDate).toBeUndefined();
    raw.stops[0].leaveDate = '2026-10-13';
    expect(sanitizeTrip(raw)!.stops![0].leaveDate).toBe('2026-10-13');
  });

  it('a schema-3 file stays read-only', () => {
    expect(migrateTrips({ schema: 3, trips: [] }).readOnly).toBe(true);
  });
});

describe('share links with stops', () => {
  it('round-trips the stops', async () => {
    const payload = await encodeTripShare(withLisbon(), [], Date.parse('2026-10-01T12:00:00Z'));
    const back = await decodeTripShare(payload);
    expect(back!.trip.stops).toEqual([{ id: 'stop-lis', place: LISBON, arriveDate: '2026-10-12' }]);
    expect(lastStopPlace(back!.trip).name).toBe('Lisbon');
  });

  it('the group copy of a trip keeps its stops', () => {
    expect(forGroup(withLisbon()).stops).toEqual(withLisbon().stops);
  });

  it('still decodes a link made before stops existed (old-format fixture)', async () => {
    const { prep: _p, changes: _c, offlineSavedAt: _o, calendarExportedAt: _k, calendarRefs: _r, archived: _a, ...base } = sevilleTrip();
    const old = { s: 1, at: '2026-09-30T10:00:00.000Z', trip: base, notes: [] };
    const payload = 'j' + toBase64Url(new TextEncoder().encode(JSON.stringify(old)));
    const back = await decodeTripShare(payload);
    expect(back).not.toBeNull();
    expect(back!.trip.goal.name).toBe('Seville');
    expect(back!.trip.stops).toBeUndefined();
    expect(back!.trip.legs).toHaveLength(4);
    expect(lastStopPlace(back!.trip).name).toBe('Seville');
  });
});
