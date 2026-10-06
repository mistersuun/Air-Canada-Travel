import { describe, expect, it } from 'vitest';
import type { LegEnd, Place } from '../trips/model';
import { SEVILLE_PLACE } from '../trips/testing/seville-fixture';
import { toUtcMs, utcToLocal } from '../utils/time';
import { CORRIDORS } from './corridors';
import {
  GroundEstimate, aboutDuration, airportEnd, arrivalAtGoal, findCorridor, groundEstimate, landConnected,
  onwardLinks, placeEnd,
} from './ground';

const MAD = airportEnd('MAD')!;
const at = (code: string) => airportEnd(code)!;
const place = (p: Partial<Place> & Pick<Place, 'lat' | 'lng' | 'iso2'>): Place =>
  ({ id: 'gn-1', name: 'X', country: '', tz: null, ...p });

describe('corridors', () => {
  it('every row is reviewed and has sane numbers', () => {
    expect(CORRIDORS.length).toBeGreaterThanOrEqual(18);
    for (const c of CORRIDORS) {
      expect(c.reviewed).toBe('2026-10');
      expect(airportEnd(c.code), c.code).not.toBeNull();
      expect(c.rideMin).toBeGreaterThan(0);
      expect(c.exitMin).toBeGreaterThan(0);
    }
  });

  it('MAD → Seville is a 2h40 train, 90 min to get to Atocha, last about 21:00', () => {
    const g = groundEstimate(MAD, SEVILLE_PLACE);
    expect(g).toEqual({
      mode: 'train', label: 'Train about 2h40', rideMin: 160, exitMin: 90,
      exitLabel: 'Passport, exit, get to Atocha', totalMin: 250, frequency: 'trains roughly hourly',
      lastDepLocal: '21:00', shortFlightToo: false, source: 'corridor', provenance: 'estimated',
    });
  });

  it('LIS, BCN and OPO → Seville', () => {
    expect(groundEstimate(at('LIS'), SEVILLE_PLACE)).toMatchObject({ mode: 'bus', label: 'Bus about 6h45', exitMin: 75, lastDepLocal: '22:25' });
    expect(groundEstimate(at('BCN'), SEVILLE_PLACE)).toMatchObject({
      mode: 'train', label: 'Train about 6h20, or a short flight', shortFlightToo: true,
    });
    expect(groundEstimate(at('OPO'), SEVILLE_PLACE)).toMatchObject({ mode: 'bus', label: 'Bus about 9h' });
  });

  it('matches a city leg end without a GeoNames id by distance, in either direction', () => {
    const seville: LegEnd = { name: 'Seville', lat: 37.3886, lng: -5.9823 };
    expect(findCorridor(MAD, seville)?.reverse).toBe(false);
    const back = groundEstimate(seville, { name: 'Lisbon', code: 'LIS', lat: 38.77, lng: -9.13 });
    // Towards the airport: no passport or exit, but the transfer from Oriente to the airport still counts.
    expect(back).toMatchObject({ mode: 'bus', label: 'Bus about 6h45', exitMin: 30, exitLabel: 'Get to LIS airport', totalMin: 435, lastDepLocal: null });
  });

  it('labels Eurostar and other rows', () => {
    const paris = place({ id: 'gn-2988507', lat: 48.85, lng: 2.35, iso2: 'FR' });
    expect(groundEstimate(at('LHR'), paris).label).toBe('Eurostar about 2h20');
    expect(groundEstimate(at('BRU'), paris)).toMatchObject({ label: 'Train about 1h25', exitMin: 60 });
  });
});

describe('heuristic', () => {
  it('under 60 km by road is a taxi or transit', () => {
    const g = groundEstimate(MAD, place({ lat: 40.42, lng: -3.70, iso2: 'ES' }));
    expect(g.mode).toBe('car');
    expect(g.label).toMatch(/^Taxi or transit about \d+ min$/);
    expect(g.exitMin).toBe(60);
    expect(g.source).toBe('heuristic');
    expect(g.provenance).toBe('estimated');
    expect(g.rideMin! % 5).toBe(0);
  });

  it('60 to 700 km is a bus or train at 70 km/h on 1.3 × the distance', () => {
    // Valladolid, ~170 km from MAD airport.
    const g = groundEstimate(MAD, place({ lat: 41.65, lng: -4.72, iso2: 'ES' }));
    expect(g.mode).toBe('bus');
    expect(g.label).toMatch(/^Bus or train about \dh(\d\d)?$/);
    expect(g.shortFlightToo).toBe(false);
    expect(g.totalMin).toBe(60 + g.rideMin!);
  });

  it('over 700 km adds a short flight', () => {
    const g = groundEstimate(MAD, place({ lat: 48.85, lng: 2.35, iso2: 'FR', id: 'gn-5' }));
    expect(g.shortFlightToo).toBe(true);
    expect(g.label).toContain(', or a short flight');
  });

  it('across the sea or between countries without a land link it is unknown', () => {
    const cmn = groundEstimate(at('CMN'), SEVILLE_PLACE);
    expect(cmn).toMatchObject({ mode: 'unknown', label: 'Onward travel unknown', provenance: 'unknown', totalMin: null, source: 'none' });
    // Same country, but an island gateway.
    expect(groundEstimate(at('PMI'), SEVILLE_PLACE).mode).toBe('unknown');
    expect(groundEstimate(at('TFS'), SEVILLE_PLACE).mode).toBe('unknown');
    // On the island itself it is fine.
    expect(groundEstimate(at('PMI'), place({ lat: 39.57, lng: 2.65, iso2: 'ES' })).mode).toBe('car');
    // A place on an island reached from the mainland.
    expect(groundEstimate(at('BCN'), place({ lat: 39.57, lng: 2.65, iso2: 'ES' })).mode).toBe('unknown');
  });

  it('land links', () => {
    expect(landConnected('ES', 'PT')).toBe(true);
    expect(landConnected('GB', 'FR')).toBe(true);
    expect(landConnected('US', 'CA')).toBe(true);
    expect(landConnected('MA', 'ES')).toBe(false);
    expect(landConnected('GB', 'ES')).toBe(false);
    expect(landConnected('IS', 'NO')).toBe(false);
  });

  it('every estimate is Estimated or Unknown', () => {
    const ends = ['MAD', 'LIS', 'BCN', 'OPO', 'CMN', 'PMI', 'LHR', 'CDG', 'YUL', 'HNL'].map(at);
    const goals: Place[] = [SEVILLE_PLACE, place({ lat: 45.5, lng: -73.6, iso2: 'CA' }), place({ lat: 21.3, lng: -157.8, iso2: 'US' })];
    for (const e of ends) for (const p of goals) {
      expect(['estimated', 'unknown']).toContain(groundEstimate(e, p).provenance);
    }
  });
});

describe('arrivalAtGoal', () => {
  const g = groundEstimate(MAD, SEVILLE_PLACE);
  const tz = 'Europe/Madrid';

  it('AC834 landing 06:50 reaches Seville around 11:00', () => {
    const r = arrivalAtGoal(toUtcMs('2026-10-09', '06:50', tz), g, tz);
    expect(r.overnightLikely).toBe(false);
    expect(r.lastDepMissed).toBe(false);
    expect(utcToLocal(r.utc!, tz)).toEqual({ dateKey: '2026-10-09', hhmm: '11:00' });
  });

  it('landing at 23:50 misses the last train: next morning', () => {
    const r = arrivalAtGoal(toUtcMs('2026-10-09', '23:50', tz), g, tz);
    expect(r.lastDepMissed).toBe(true);
    expect(r.overnightLikely).toBe(true);
    // Out at 01:20 on the 10th, leave at 08:00 that morning.
    expect(utcToLocal(r.utc!, tz)).toEqual({ dateKey: '2026-10-10', hhmm: '10:40' });
  });

  it('landing at 20:00 is past the last train (out 21:30)', () => {
    const r = arrivalAtGoal(toUtcMs('2026-10-09', '20:00', tz), g, tz);
    expect(r.lastDepMissed).toBe(true);
    expect(utcToLocal(r.utc!, tz)).toEqual({ dateKey: '2026-10-10', hhmm: '10:40' });
  });

  it('a long ride ending after 23:30 is overnight without a last-train time', () => {
    const bcn = groundEstimate(at('BCN'), SEVILLE_PLACE);
    const r = arrivalAtGoal(toUtcMs('2026-10-09', '17:00', tz), bcn, tz);
    expect(r.lastDepMissed).toBe(false);
    expect(r.overnightLikely).toBe(true);
    expect(utcToLocal(r.utc!, tz)).toEqual({ dateKey: '2026-10-10', hhmm: '14:20' });
  });

  it('a 00:30 departure after midnight is tonight\'s only when ready in the evening', () => {
    const deps = [{ depMin: 30, rideMin: 120, product: '0' }];
    const dir = {
      src: 't', op: 'Op', from: 'A', to: 'B', tz, validFrom: '2026-01-01', validTo: '2026-12-31',
      wk: deps, sat: deps, sun: deps, noService: new Set<string>(), note: null,
    } as unknown as NonNullable<GroundEstimate['timetable']>['dir'];
    const tt = { ...g, timetable: { dir } } as unknown as GroundEstimate;
    const evening = arrivalAtGoal(toUtcMs('2026-10-09', '23:00', tz), tt, tz);
    expect(evening.lastDepMissed).toBe(false);
    expect(evening.departure).toMatchObject({ dateKey: '2026-10-10', hhmm: '00:30' });
    expect(evening.overnightLikely).toBe(true); // arrives 02:30, a late arrival either way
    const morning = arrivalAtGoal(toUtcMs('2026-10-09', '06:00', tz), tt, tz);
    expect(morning.lastDepMissed).toBe(true);
    expect(morning.overnightLikely).toBe(true);
  });

  it('a long wait to a small-hours train still counts the last departure as missed', () => {
    const mk = (depMin: number[]) => depMin.map(d => ({ depMin: d, rideMin: 120, product: '0' }));
    const deps = mk([4 * 60 + 30, 17 * 60 + 30]);
    const dir = {
      src: 't', op: 'Op', from: 'A', to: 'B', tz, validFrom: '2026-01-01', validTo: '2026-12-31',
      wk: deps, sat: deps, sun: deps, noService: new Set<string>(), note: null,
    } as unknown as NonNullable<GroundEstimate['timetable']>['dir'];
    const tt = { ...g, exitMin: 0, timetable: { dir } } as unknown as GroundEstimate;
    const r = arrivalAtGoal(toUtcMs('2026-10-09', '18:00', tz), tt, tz);
    expect(r.lastDepMissed).toBe(true);
  });

  it('unknown onward has no arrival', () => {
    const cmn = groundEstimate(at('CMN'), SEVILLE_PLACE);
    expect(arrivalAtGoal(0, cmn, 'Africa/Casablanca')).toEqual({ utc: null, overnightLikely: false, lastDepMissed: false, departure: null });
  });

  it('a ride that would end past midnight waits for the morning', () => {
    const custom: GroundEstimate = { ...g, lastDepLocal: null };
    const r = arrivalAtGoal(toUtcMs('2026-10-09', '20:00', tz), custom, tz);
    expect(r.lastDepMissed).toBe(false);
    expect(r.overnightLikely).toBe(true);
    expect(utcToLocal(r.utc!, tz)).toEqual({ dateKey: '2026-10-10', hhmm: '10:40' });
    const early = arrivalAtGoal(toUtcMs('2026-10-09', '18:00', tz), custom, tz);
    expect(early.overnightLikely).toBe(false);
    expect(utcToLocal(early.utc!, tz)).toEqual({ dateKey: '2026-10-09', hhmm: '22:10' });
  });
});

describe('links and helpers', () => {
  it('builds onward links', () => {
    const l = onwardLinks(MAD, placeEnd(SEVILLE_PLACE));
    expect(l.google).toBe('https://www.google.com/maps/dir/?api=1&origin=40.47,-3.57&destination=37.3886,-5.9823&travelmode=transit');
    expect(l.rome2rio).toBe('https://www.rome2rio.com/map/Madrid-MAD-Airport/Seville');
    expect(l.omio).toBe('https://www.omio.com/');
    expect(l.skyscanner).toBe('https://www.skyscanner.ca/');
  });

  it('formats durations', () => {
    expect(aboutDuration(160)).toBe('2h40');
    expect(aboutDuration(540)).toBe('9h');
    expect(aboutDuration(45)).toBe('45 min');
    expect(aboutDuration(65)).toBe('1h05');
  });

  it('airport and place ends', () => {
    expect(airportEnd('YUL')).toMatchObject({ name: 'Montréal', code: 'YUL', tz: 'America/Toronto' });
    expect(airportEnd('ZZZ')).toBeNull();
    expect(placeEnd({ ...SEVILLE_PLACE, acCode: 'SVQ' }).code).toBe('SVQ');
  });
});
