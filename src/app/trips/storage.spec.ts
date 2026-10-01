import { describe, expect, it, vi } from 'vitest';
import { BlockedStorage, MemoryStorage } from '../state/testing';
import { FLIGHTLOG_KEY, TRIPS_CORRUPT_KEY, TRIPS_KEY, emptyFlightLog } from './model';
import {
  loadFlightLog, loadTrips, migrateFlightLog, migrateTrips, sanitizeLeg, sanitizeTrip, saveFlightLog, saveTrips,
} from './storage';
import { SEVILLE_TRIP, SEVILLE_TRIPS_FILE, sevilleTrip } from './testing/seville-fixture';

describe('trips storage', () => {
  it('round-trips the Seville trip', () => {
    const s = new MemoryStorage();
    expect(saveTrips(s, SEVILLE_TRIPS_FILE)).toBe(true);
    const back = loadTrips(s);
    expect(back.readOnly).toBe(false);
    expect(back.file).toEqual(SEVILLE_TRIPS_FILE);
    expect(sanitizeTrip(SEVILLE_TRIP)).toEqual(SEVILLE_TRIP);
  });

  it('works with storage blocked or absent', () => {
    expect(loadTrips(new BlockedStorage())).toEqual({ file: { schema: 1, trips: [] }, readOnly: false });
    expect(saveTrips(new BlockedStorage(), SEVILLE_TRIPS_FILE)).toBe(false);
    expect(loadTrips(null).file.trips).toEqual([]);
    expect(saveTrips(null, SEVILLE_TRIPS_FILE)).toBe(false);
    expect(loadFlightLog(new BlockedStorage()).file).toEqual(emptyFlightLog());
  });

  it('keeps corrupt JSON in ac.trips.corrupt and starts empty', () => {
    const s = new MemoryStorage();
    s.setItem(TRIPS_KEY, '{"schema":1,"trips":[');
    const r = loadTrips(s);
    expect(r).toEqual({ file: { schema: 1, trips: [] }, readOnly: false });
    expect(s.getItem(TRIPS_CORRUPT_KEY)).toBe('{"schema":1,"trips":[');
  });

  it('keeps a copy in ac.trips.corrupt when sanitising drops a leg or a trip, or the schema is not a number', () => {
    const s = new MemoryStorage();
    const bad = JSON.parse(JSON.stringify(SEVILLE_TRIPS_FILE));
    bad.trips[0].legs[0].refs[0].depLocal = '25:99';
    const text = JSON.stringify(bad);
    s.setItem(TRIPS_KEY, text);
    const r = loadTrips(s);
    expect(r.file.trips[0].legs.length).toBe(SEVILLE_TRIP.legs.length - 1);
    expect(s.getItem(TRIPS_CORRUPT_KEY)).toBe(text);

    const s2 = new MemoryStorage();
    s2.setItem(TRIPS_KEY, JSON.stringify({ schema: 'one', trips: [SEVILLE_TRIP] }));
    loadTrips(s2);
    expect(s2.getItem(TRIPS_CORRUPT_KEY)).not.toBeNull();

    const s3 = new MemoryStorage();
    saveTrips(s3, SEVILLE_TRIPS_FILE);
    loadTrips(s3);
    expect(s3.getItem(TRIPS_CORRUPT_KEY)).toBeNull();
  });

  it('shows data from a newer app read-only', () => {
    const s = new MemoryStorage();
    s.setItem(TRIPS_KEY, JSON.stringify({ schema: 2, trips: [SEVILLE_TRIP] }));
    const r = loadTrips(s);
    expect(r.readOnly).toBe(true);
    expect(r.file.trips).toHaveLength(1);
    expect(migrateFlightLog({ schema: 3 }).readOnly).toBe(true);
  });

  it('migrates schema-less data and drops what it cannot read', () => {
    const t = sevilleTrip() as unknown as Record<string, unknown>;
    const legs = [...(t['legs'] as unknown[]), { kind: 'flight', id: 'bad', refs: [] }, { kind: 'boat', id: 'x' }, null];
    const { file, readOnly } = migrateTrips({ trips: [{ ...t, legs }, { id: 'no-goal' }, 42, { ...t }] });
    expect(readOnly).toBe(false);
    expect(file.trips).toHaveLength(1); // the duplicate id is dropped too
    expect(file.trips[0].legs).toHaveLength(4);
    expect(migrateTrips(null).file.trips).toEqual([]);
    expect(migrateTrips('garbage').file.trips).toEqual([]);
  });

  it('clamps the party and fills defaults', () => {
    const t = { ...sevilleTrip(), party: { count: 40 }, name: '', homeAirport: 'nope', prep: { a: { done: 'yes' }, b: { done: true } } };
    const s = sanitizeTrip(t)!;
    expect(s.party).toEqual({ count: 9, stayTogether: true, splitNote: '' });
    expect(s.name).toBe('Seville trip');
    expect(s.homeAirport).toBe('YUL');
    expect(Object.keys(s.prep)).toEqual(['b']);
    expect(sanitizeTrip({ ...sevilleTrip(), party: { count: -3 } })!.party.count).toBe(1);
    expect(sanitizeTrip({ ...sevilleTrip(), homeBy: { dateKey: '2026-02-30', hhmm: '22:00' } })).toBeNull();
    expect(sanitizeTrip({ ...sevilleTrip(), outboundDate: 'soon' })).toBeNull();
  });

  it('never throws on hostile input', () => {
    const evil = { get id() { throw new Error('boom'); } };
    expect(sanitizeTrip(evil)).toBeNull();
    expect(() => migrateTrips({ trips: [evil] })).not.toThrow();
  });

  it('demotes a "saved" ground leg without times', () => {
    const leg = sanitizeLeg({ ...sevilleTrip().legs[2], userTimes: null })!;
    expect(leg.kind === 'ground' && leg.provenance).toBe('estimated');
    const unknown = sanitizeLeg({ ...sevilleTrip().legs[1], estMinutes: null })!;
    expect(unknown.kind === 'ground' && unknown.provenance).toBe('unknown');
  });

  it('round-trips the flight log and sanitises it', () => {
    const s = new MemoryStorage();
    const log = {
      schema: 1 as const,
      notes: [{ id: 'n1', flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 14, listed: 9, text: 'Gate 52', at: '2026-10-09T18:05:00.000Z' }],
      outcomes: [{ id: 'o1', flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', kind: 'allBoarded' as const, partySize: 2, tripId: null, note: '', recordedAt: '2026-10-10T12:00:00.000Z' }],
      dismissed: ['AC1|YUL|2026-10-01'],
    };
    expect(saveFlightLog(s, log)).toBe(true);
    expect(loadFlightLog(s).file).toEqual(log);
    s.setItem(FLIGHTLOG_KEY, JSON.stringify({ notes: [{ id: 'x' }], outcomes: [{ ...log.outcomes[0], kind: 'maybe' }], dismissed: [1, 'k', 'k'] }));
    expect(loadFlightLog(s).file).toEqual({ schema: 1, notes: [], outcomes: [], dismissed: ['k'] });
  });

  it('does not write when quota is exceeded', () => {
    const s = new MemoryStorage();
    vi.spyOn(s, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveTrips(s, SEVILLE_TRIPS_FILE)).toBe(false);
  });
});
