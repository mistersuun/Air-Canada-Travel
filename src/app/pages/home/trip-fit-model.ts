/**
 * "Trip fit" filters (entry listings, typical weather, time zone, advisory).
 * Pure: the data they need is loaded on demand elsewhere and passed in, so
 * the routes engine stays synchronous. Shared by Home and the Map list.
 *
 * Missing data never empties the list by itself: a filter whose data is not
 * loaded (still loading, missing file, stale listings) has no effect. Once
 * the data is there, a destination it knows nothing about is left out of a
 * weather or entry filter (and weather gaps are counted, so the UI can say so).
 */
import type { Destination } from '../../data/destinations';
import { climateFor } from '../../recs/climate';
import type { ClimateIndex } from '../../recs/model';
import type { AdvisoryIndex } from '../../reference/reference';
import { bestEntry, visaStale, type EntryKind, type VisaTable } from '../../reference/visa';
import { tzOffsetMin } from '../../utils/time';
import type { Filters } from '../../utils/routes';

export type TripFitFilters = Pick<Filters, 'entry' | 'weatherMonth' | 'minHighC' | 'maxWetDays' | 'maxTzHours' | 'hideAdvisory'>;

export interface TripFitData {
  passports: readonly string[];
  visa: VisaTable | null;
  climate: ClimateIndex | null;
  advisories: AdvisoryIndex | null;
  /** Today at the hub (YYYY-MM-DD), for the age of the listings. */
  todayKey: string;
  /** Month (1..12) of the selected week or day: the default weather month. */
  weekMonth: number;
  hubTz: string;
  nowMs: number;
}

export const MIN_HIGH_CHOICES: readonly number[] = [15, 20, 25, 28];
export const MAX_WET_CHOICES: readonly number[] = [5, 10];
export const MAX_TZ_CHOICES: readonly number[] = [2, 4, 6];

/** Entry kinds each choice keeps. */
const ENTRY_KINDS: Record<'noVisa' | 'noVisaOrEta', readonly EntryKind[]> = {
  noVisa: ['O', 'F'],
  noVisaOrEta: ['O', 'F', 'T'],
};

export function weatherActive(f: Partial<TripFitFilters>): boolean {
  return f.minHighC != null || f.maxWetDays != null;
}

/** The month the weather filters use. */
export function weatherMonthOf(f: Partial<TripFitFilters>, weekMonth: number): number {
  return f.weatherMonth ?? weekMonth;
}

/** Listings usable now: loaded and not older than VISA_MAX_AGE_DAYS. */
export function usableVisa(data: Pick<TripFitData, 'visa' | 'todayKey'>): VisaTable | null {
  return data.visa && !visaStale(data.visa, data.todayKey) ? data.visa : null;
}

/** Row tag for a destination's best listing across the passports; null = show nothing. */
export type EntryTag = 'noVisa' | 'eta' | 'arrival' | 'visa';

export function entryTag(data: TripFitData, iso2: string): EntryTag | null {
  const table = usableVisa(data);
  if (!table || !data.passports.length) return null;
  const best = bestEntry(table, data.passports, iso2);
  switch (best?.kind) {
    case 'F': return 'noVisa';
    case 'T': return 'eta';
    case 'A': return 'arrival';
    case 'E': case 'V': return 'visa';
    default: return null; // own country, no admission, or unlisted
  }
}

export interface TripFitResult<T> {
  items: T[];
  /** Left out of a weather filter because the typical-weather data has nothing for them. */
  noWeather: number;
}

/** Apply the active trip-fit filters; `destOf` finds the destination of an item. */
export function applyTripFit<T>(
  items: readonly T[], destOf: (x: T) => Destination, f: Partial<TripFitFilters>, data: TripFitData,
): TripFitResult<T> {
  const table = usableVisa(data);
  const entryKinds = f.entry && f.entry !== 'any' && data.passports.length && table ? ENTRY_KINDS[f.entry] : null;
  const weather = weatherActive(f) && data.climate ? weatherMonthOf(f, data.weekMonth) : null;
  const advisories = f.hideAdvisory ? data.advisories : null;
  const maxTz = f.maxTzHours ?? null;
  const hubOff = maxTz !== null ? tzOffsetMin(data.hubTz, data.nowMs) : 0;
  let noWeather = 0;

  const out = items.filter(x => {
    const d = destOf(x);
    if (entryKinds) {
      const best = bestEntry(table, data.passports, d.iso2);
      if (!best || !entryKinds.includes(best.kind)) return false;
    }
    if (maxTz !== null && Math.abs(tzOffsetMin(d.tz, data.nowMs) - hubOff) > maxTz * 60) return false;
    if (advisories) {
      const a = advisories.get(d.iso2.toUpperCase());
      if (a && a.level >= 2) return false;
    }
    if (weather !== null) {
      const c = climateFor(data.climate, d.code, weather);
      if (!c) { noWeather++; return false; }
      if (f.minHighC != null && c.tmaxC < f.minHighC) return false;
      if (f.maxWetDays != null && c.wetDays > f.maxWetDays) return false;
    }
    return true;
  });
  return { items: out, noWeather };
}

/** The trip-fit filters switched off. */
export const NO_TRIP_FIT: TripFitFilters = { entry: 'any', weatherMonth: null, minHighC: null, maxWetDays: null, maxTzHours: null, hideAdvisory: false };

/** How many trip-fit filters are on (the month alone is not a filter). */
export function tripFitCount(f: Partial<TripFitFilters>): number {
  return (f.entry && f.entry !== 'any' ? 1 : 0) + (f.minHighC != null ? 1 : 0) + (f.maxWetDays != null ? 1 : 0)
    + (f.maxTzHours != null ? 1 : 0) + (f.hideAdvisory ? 1 : 0);
}
