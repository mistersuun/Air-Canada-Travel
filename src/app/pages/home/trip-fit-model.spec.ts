import { describe, expect, it } from 'vitest';
import { findDestination } from '../../utils/airports';
import { toUtcMs } from '../../utils/time';
import { applyTripFit, entryTag, NO_TRIP_FIT, tripFitCount, TripFitData, TripFitFilters, usableVisa, weatherMonthOf } from './trip-fit-model';
import { advisoryIndex, climateIndex, visaTable } from './testing/trip-fit-fixture';

const codes = ['LHR', 'ATH', 'SYD', 'CDG', 'DEL'];
const dests = codes.map(c => findDestination(c)!);
const OCT = toUtcMs('2026-10-07', '12:00', 'America/Toronto');

function data(over: Partial<TripFitData> = {}): TripFitData {
  return {
    passports: ['CA'], visa: visaTable(), climate: climateIndex(), advisories: advisoryIndex(),
    todayKey: '2026-10-07', weekMonth: 10, hubTz: 'America/Toronto', nowMs: OCT, ...over,
  };
}
const run = (f: Partial<TripFitFilters>, d = data()) => applyTripFit(dests, x => x, { ...NO_TRIP_FIT, ...f }, d);
const kept = (f: Partial<TripFitFilters>, d = data()) => run(f, d).items.map(x => x.code);

describe('applyTripFit', () => {
  it('keeps everything with no filter on', () => {
    expect(kept({})).toEqual(codes);
  });

  it('entry: no visa listed keeps own-country and visa-free listings only', () => {
    // CA passport: ATH F90 yes; LHR T, SYD T, DEL E no; CDG V no.
    expect(kept({ entry: 'noVisa' })).toEqual(['ATH']);
  });

  it('entry: no visa or authorization adds electronic-authorization listings', () => {
    expect(kept({ entry: 'noVisaOrEta' })).toEqual(['LHR', 'ATH', 'SYD']);
  });

  it('entry: a destination with no listing is left out once the data is there', () => {
    const table = visaTable();
    const withoutGreece = { ...table, cols: new Map([...table.cols].filter(([c]) => c !== 'GR')) };
    expect(kept({ entry: 'noVisaOrEta' }, data({ visa: withoutGreece }))).toEqual(['LHR', 'SYD']);
  });

  it('entry: uses the easiest listing across several passports', () => {
    expect(kept({ entry: 'noVisa' }, data({ passports: ['IN', 'CA'] }))).toEqual(['ATH', 'DEL']);
  });

  it('entry: has no effect without a passport, before the data loads, or when it is stale', () => {
    expect(kept({ entry: 'noVisa' }, data({ passports: [] }))).toEqual(codes);
    expect(kept({ entry: 'noVisa' }, data({ visa: null }))).toEqual(codes);
    const stale = data({ todayKey: '2028-06-01' }); // asOf 2026-09-01 is more than 548 days old
    expect(usableVisa(stale)).toBeNull();
    expect(kept({ entry: 'noVisa' }, stale)).toEqual(codes);
    expect(entryTag(stale, 'GR')).toBeNull();
    expect(usableVisa(data({ todayKey: '2028-02-01' }))).not.toBeNull(); // 518 days: still shown
  });

  it('weather: minimum typical high for the week month, and destinations without data are excluded and counted', () => {
    const r = run({ minHighC: 20 });
    expect(r.items.map(x => x.code)).toEqual(['ATH']);
    expect(r.noWeather).toBe(2); // SYD and DEL have no normals
  });

  it('weather: max rainy days', () => {
    expect(kept({ maxWetDays: 10 })).toEqual(['ATH', 'CDG']);
    expect(kept({ maxWetDays: 5 })).toEqual(['ATH']);
    expect(kept({ minHighC: 15, maxWetDays: 10 })).toEqual(['ATH', 'CDG']);
  });

  it('weather: an explicit month overrides the selected week; unset follows the week', () => {
    expect(weatherMonthOf({ weatherMonth: null }, 10)).toBe(10);
    expect(weatherMonthOf({ weatherMonth: 3 }, 10)).toBe(3);
    // The fixture is flat across the year, so use a month with no data to prove it is read.
    const index = climateIndex();
    const ath = index.byCode.get('ATH')!.map((m, i) => (i === 6 ? { ...m, tmaxC: 33 } : m));
    const byCode = new Map(index.byCode).set('ATH', ath);
    const d = data({ climate: { ...index, byCode } });
    expect(kept({ minHighC: 28 }, d)).toEqual([]);
    expect(kept({ minHighC: 28, weatherMonth: 7 }, d)).toEqual(['ATH']);
    expect(kept({ minHighC: 28 }, data({ climate: { ...index, byCode }, weekMonth: 7 }))).toEqual(['ATH']);
  });

  it('weather: has no effect while the climate data is not loaded', () => {
    const r = run({ minHighC: 28 }, data({ climate: null }));
    expect(r.items).toHaveLength(codes.length);
    expect(r.noWeather).toBe(0);
  });

  it('time zone: hours of difference from the hub now (Toronto is UTC-4, London UTC+1 in early October)', () => {
    // LHR 5h, CDG 6h, ATH 7h, DEL 9.5h, SYD 14h.
    expect(kept({ maxTzHours: 2 })).toEqual([]);
    expect(kept({ maxTzHours: 4 })).toEqual([]);
    expect(kept({ maxTzHours: 6 })).toEqual(['LHR', 'CDG']);
  });

  it('time zone: follows daylight-saving at the given moment', () => {
    // After Oct 25 London is back on UTC+0 while Toronto is still on UTC-4 until Nov 1: LHR is 4h, CDG 5h.
    const late = toUtcMs('2026-10-28', '12:00', 'America/Toronto');
    expect(kept({ maxTzHours: 4 }, data({ nowMs: late }))).toEqual(['LHR']);
    expect(kept({ maxTzHours: 4 })).toEqual([]);
  });

  it('advisory: hides level 2 and higher, keeps level 0-1 and destinations with no advisory', () => {
    expect(kept({ hideAdvisory: true })).toEqual(['ATH', 'SYD', 'CDG', 'DEL']); // GB is level 2
    expect(kept({ hideAdvisory: true }, data({ advisories: null }))).toEqual(codes);
  });

  it('combines filters', () => {
    expect(kept({ entry: 'noVisaOrEta', hideAdvisory: true, minHighC: 20 })).toEqual(['ATH']);
    expect(kept({ entry: 'noVisaOrEta', maxTzHours: 6 })).toEqual(['LHR']);
  });
});

describe('entryTag', () => {
  it('names the best listing across passports, and nothing for own country or no passport', () => {
    expect(entryTag(data(), 'GR')).toBe('noVisa');
    expect(entryTag(data(), 'GB')).toBe('eta');
    expect(entryTag(data(), 'IN')).toBe('visa');
    expect(entryTag(data(), 'FR')).toBe('visa');
    expect(entryTag(data(), 'CA')).toBeNull();
    expect(entryTag(data(), 'JP')).toBeNull(); // unlisted
    expect(entryTag(data({ passports: [] }), 'GR')).toBeNull();
  });
});

describe('tripFitCount', () => {
  it('counts filters but not the month alone', () => {
    expect(tripFitCount(NO_TRIP_FIT)).toBe(0);
    expect(tripFitCount({ ...NO_TRIP_FIT, weatherMonth: 3 })).toBe(0);
    expect(tripFitCount({ entry: 'noVisa', weatherMonth: 3, minHighC: 20, maxWetDays: 5, maxTzHours: 4, hideAdvisory: true })).toBe(5);
  });
});
