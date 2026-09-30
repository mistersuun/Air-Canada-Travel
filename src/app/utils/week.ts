/**
 * Direct-flight engine: turns schedule records into dated flight instances.
 *
 * Every departure on a day is returned (filter, not find), de-duplicated on
 * flight number + departure time, sorted by departure instant. Times stay
 * local at each airport; depUtc/arrUtc are real instants computed with each
 * airport's IANA zone, and arrDayOffset (−1..+2) is inferred from them when
 * the data has none (critique 5, 15).
 */
import {
  ScheduleRecord,
  getCoverage,
  getSchedulesForRoute,
  isCovered,
  scheduleVersion,
} from '../data/schedule-index';
import { airportTz, isHub } from './airports';
import {
  MINUTE_MS,
  WEEKDAY_SHORT,
  addDays,
  formatKey,
  hhmmToMin,
  keyToDate,
  toKey,
  toUtcMs,
  weekKeys,
  weekdayIndex,
} from './time';

export interface FlightInstance {
  /** 'AC880'; null for an estimated (invented) leg. */
  flightNumber: string | null;
  origin: string;
  dest: string;
  /** Local departure date at the origin. */
  dateKey: string;
  /** 'HH:MM' local at the origin. */
  depLocal: string;
  /** 'HH:MM' local at the destination. */
  arrLocal: string;
  /** Local arrival date at the destination. */
  arrDateKey: string;
  depUtc: number;
  arrUtc: number;
  /** arrDateKey − dateKey in days: 0 same day, 1 for '+1', −1 across the date line westbound. */
  arrDayOffset: number;
  durationMin: number;
  /** IATA equipment code ('789'); null for an estimated leg. */
  aircraft: string | null;
  /** True when the leg is not from published schedules (verify in the AC app). */
  estimated: boolean;
}

export type CoverageState = 'covered' | 'outside';

export interface DayFlight {
  dateKey: string;
  /** Local-midnight Date for display. */
  date: Date;
  /** Every direct departure that day, sorted by depUtc. */
  flights: FlightInstance[];
  flies: boolean;
  /** 'outside' when the date is beyond the published window: unknown, not "no flights". */
  coverage: CoverageState;
  /** @deprecated First flight's number; use flights[0]. Kept for pre-WS5 callers. */
  flightNumber?: string;
  /** @deprecated First flight's local departure; use flights[0].depLocal. */
  departure?: string;
  /** @deprecated First flight's local arrival; use flights[0].arrLocal. */
  arrival?: string;
  /** @deprecated First flight's aircraft; use flights[0].aircraft. */
  aircraft?: string;
}

// ── Compiled schedule records ───────────────────────────────────────────────

interface CompiledRecord {
  rec: ScheduleRecord;
  mask: number; // bit i = weekday i (0 = Mon)
}

const DAY_BITS: Record<string, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

/** 'Mon,Wed,Sun' → bitmask (bit 0 = Monday). Unknown tokens are ignored. */
export function parseDayMask(days: string): number {
  let mask = 0;
  for (const raw of days.split(',')) {
    const bit = DAY_BITS[raw.trim().slice(0, 3).toLowerCase()];
    if (bit !== undefined) mask |= 1 << bit;
  }
  return mask;
}

const compiled = new WeakMap<readonly ScheduleRecord[], CompiledRecord[]>();

function compile(records: readonly ScheduleRecord[]): CompiledRecord[] {
  let c = compiled.get(records);
  if (!c) {
    c = records
      .filter(r => r.fromDate <= r.toDate && !Number.isNaN(hhmmToMin(r.departure)) && !Number.isNaN(hhmmToMin(r.arrival)))
      .map(rec => ({ rec, mask: parseDayMask(rec.days) }));
    compiled.set(records, c);
  }
  return c;
}

// ── Instances ───────────────────────────────────────────────────────────────

/**
 * Builds one dated instance from a schedule record departing on `dateKey`.
 * When the record has no arrDayOffset, the offset is the smallest one in
 * −1..+2 that gives a positive block time.
 */
export function buildInstance(rec: ScheduleRecord, origin: string, dest: string, dateKey: string): FlightInstance {
  const depUtc = toUtcMs(dateKey, rec.departure, airportTz(origin));
  const destTz = airportTz(dest);
  let offset: number;
  let arrUtc: number;
  if (typeof rec.arrDayOffset === 'number') {
    offset = rec.arrDayOffset;
    arrUtc = toUtcMs(addDays(dateKey, offset), rec.arrival, destTz);
  } else {
    offset = 2;
    arrUtc = toUtcMs(addDays(dateKey, 2), rec.arrival, destTz);
    for (let k = -1; k <= 2; k++) {
      const a = toUtcMs(addDays(dateKey, k), rec.arrival, destTz);
      if (a > depUtc) {
        offset = k;
        arrUtc = a;
        break;
      }
    }
  }
  return {
    flightNumber: rec.flightNumber || null,
    origin,
    dest,
    dateKey,
    depLocal: rec.departure,
    arrLocal: rec.arrival,
    arrDateKey: addDays(dateKey, offset),
    depUtc,
    arrUtc,
    arrDayOffset: offset,
    durationMin: Math.round((arrUtc - depUtc) / MINUTE_MS),
    aircraft: rec.aircraft || null,
    estimated: false,
  };
}

let cacheVersion = -1;
const dayCache = new Map<string, FlightInstance[]>();

function cacheFor(key: string): FlightInstance[] | undefined {
  if (cacheVersion !== scheduleVersion()) {
    dayCache.clear();
    cacheVersion = scheduleVersion();
  }
  return dayCache.get(key);
}

/**
 * Every published direct departure origin → dest on the local date `dateKey`,
 * de-duplicated (flight number + departure) and sorted by departure instant.
 * The returned array is cached and shared: treat it as read-only.
 */
export function flightsOn(origin: string, dest: string, dateKey: string): FlightInstance[] {
  const key = `${origin}-${dest}|${dateKey}`;
  const hit = cacheFor(key);
  if (hit) return hit;

  const records = getSchedulesForRoute(origin, dest);
  let out: FlightInstance[] = [];
  if (records.length) {
    const bit = 1 << weekdayIndex(dateKey);
    const seen = new Set<string>();
    for (const c of compile(records)) {
      const r = c.rec;
      if (!(c.mask & bit) || dateKey < r.fromDate || dateKey > r.toDate) continue;
      const id = `${r.flightNumber}|${r.departure}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(buildInstance(r, origin, dest, dateKey));
    }
    out.sort((a, b) => a.depUtc - b.depUtc || String(a.flightNumber).localeCompare(String(b.flightNumber)));
  }
  if (dayCache.size > 60_000) dayCache.clear();
  dayCache.set(key, out);
  return out;
}

/** Coverage hub for a route: the hub end of it (return legs use the dest hub). */
export function coverageHubFor(origin: string, dest: string): string | null {
  if (isHub(origin)) return origin;
  if (isHub(dest)) return dest;
  return null;
}

function coverageState(dateKey: string, origin: string, dest: string): CoverageState {
  return isCovered(dateKey, coverageHubFor(origin, dest)) ? 'covered' : 'outside';
}

function toDayFlight(origin: string, dest: string, key: string): DayFlight {
  const flights = flightsOn(origin, dest, key);
  const first = flights[0];
  const day: DayFlight = {
    dateKey: key,
    date: keyToDate(key),
    flights,
    flies: flights.length > 0,
    coverage: coverageState(key, origin, dest),
  };
  if (first) {
    day.flightNumber = first.flightNumber ?? undefined;
    day.departure = first.depLocal;
    day.arrival = first.arrLocal;
    day.aircraft = first.aircraft ?? undefined;
  }
  return day;
}

/**
 * One DayFlight per day Mon–Sun. `weekStart` is a Monday date key (preferred)
 * or a Date (read in the local calendar; legacy callers).
 */
export function getFlightsForWeek(origin: string, dest: string, weekStart: string | Date): DayFlight[] {
  return weekKeys(toKey(weekStart)).map(k => toDayFlight(origin, dest, k));
}

/** The DayFlight for one date (all flights that day). */
export function getFlightForDay(origin: string, dest: string, date: string | Date): DayFlight {
  return toDayFlight(origin, dest, toKey(date));
}

export function routeHasFlightsInWeek(origin: string, dest: string, weekStart: string | Date): boolean {
  const start = toKey(weekStart);
  for (let i = 0; i < 7; i++) if (flightsOn(origin, dest, addDays(start, i)).length) return true;
  return false;
}

export function routeHasFlightOnDay(origin: string, dest: string, date: string | Date): boolean {
  return flightsOn(origin, dest, toKey(date)).length > 0;
}

/**
 * First date ≥ `fromKey` (> when inclusive is false) with a direct flight,
 * bounded by the published coverage. Null when none is published.
 */
export function nextFlightDate(origin: string, dest: string, fromKey: string, inclusive = true): string | null {
  const start = inclusive ? fromKey : addDays(fromKey, 1);
  let best: string | null = null;
  for (const c of compile(getSchedulesForRoute(origin, dest))) {
    const r = c.rec;
    if (!c.mask || r.toDate < start) continue;
    let k = start > r.fromDate ? start : r.fromDate;
    if (best !== null && k >= best) continue;
    for (let i = 0; i < 7 && k <= r.toDate; i++, k = addDays(k, 1)) {
      if (c.mask & (1 << weekdayIndex(k))) {
        if (best === null || k < best) best = k;
        break;
      }
    }
  }
  const to = getCoverage(coverageHubFor(origin, dest)).to;
  return best !== null && (to === null || best <= to) ? best : null;
}

/** Number of distinct days in [fromKey, toKey] with at least one direct flight. */
export function countFlyingDays(origin: string, dest: string, fromKey: string, toKey_: string): number {
  let n = 0;
  for (let k = fromKey, i = 0; k <= toKey_ && i < 800; k = addDays(k, 1), i++) {
    if (flightsOn(origin, dest, k).length) n++;
  }
  return n;
}

// ── Legacy Date helpers and labels ──────────────────────────────────────────

/** Returns the Monday (local midnight) of the week containing `date`. Does not mutate input. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const jsDay = d.getDay();
  d.setDate(d.getDate() - (jsDay === 0 ? 6 : jsDay - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 'Jun 8 – 14, 2026', 'Sep 28 – Oct 4, 2026' across months, and
 * 'Dec 28, 2026 – Jan 3, 2027' across years.
 */
export function formatWeekLabel(weekStart: string | Date): string {
  const start = toKey(weekStart);
  const end = addDays(start, 6);
  const sy = start.slice(0, 4);
  const ey = end.slice(0, 4);
  if (sy !== ey) {
    return `${formatKey(start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatKey(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  const startStr = formatKey(start, { month: 'short', day: 'numeric' });
  const endStr = start.slice(5, 7) === end.slice(5, 7)
    ? formatKey(end, { day: 'numeric' })
    : formatKey(end, { month: 'short', day: 'numeric' });
  return `${startStr} – ${endStr}, ${ey}`;
}

/** 'Jun 8' — week strip prev/next arrows. */
export function formatWeekNavLabel(weekStart: string | Date): string {
  return formatKey(toKey(weekStart), { month: 'short', day: 'numeric' });
}

/** 'Tue, Jun 9' — flight rows. */
export function formatDayLabel(date: string | Date): string {
  return formatKey(toKey(date), { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Short weekday name for a date key ('Mon'). */
export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[weekdayIndex(key)];
}
