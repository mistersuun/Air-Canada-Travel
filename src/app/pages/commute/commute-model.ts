/**
 * Commute-to-base planner (/commute) for crew who live in one city and report
 * at a hub: which scheduled flights home → base arrive at least a buffer before
 * report, how many a day, and the trip home after duty. Pure. Published
 * schedules only: counts and times, never seats or odds.
 */
import { isCovered } from '../../data/schedule-index';
import { DESTINATIONS, HUBS } from '../../data/destinations';
import { airportTz } from '../../utils/airports';
import { ConnectOptions, Itinerary, NO_OPTS, directItineraries, findItineraries } from '../../utils/connections';
import { MINUTE_MS, addDays, toUtcMs, utcToLocal } from '../../utils/time';
import { coverageHubFor } from '../../utils/week';

export { COMMUTE_BUFFERS, DEFAULT_COMMUTE_BUFFER } from '../../recs/profile';

/** Default report time at base. */
export const DEFAULT_REPORT_HHMM = '08:00';
/** Default release time after duty, for the trip home. */
export const DEFAULT_RELEASE_HHMM = '17:00';
/** A flight home must leave at least this long after release. */
export const HOME_AFTER_RELEASE_MIN = 45;
/** Arrivals the day before count from this local time at base ("the evening before"). */
export const DAY_BEFORE_FROM = '17:00';
/** Days in the range view. */
export const COMMUTE_DAYS = 14;
/** A day with fewer qualifying arrivals than this is flagged. */
export const MIN_OPTIONS = 2;

export interface CommuteInput {
  home: string;
  base: string;
  bufferMin: number;
  nowMs: number;
  /** One-stop itineraries count too (the app's Show connections setting). */
  showConnections: boolean;
  connect?: ConnectOptions;
}

export interface CommuteOption {
  itinerary: Itinerary;
  nonstop: boolean;
  /** Arrives the evening before report (not on the report day). */
  dayBefore: boolean;
  /** The latest arrival that still works. */
  latest: boolean;
  departHhmm: string;
  arriveHhmm: string;
  flights: string[];
}

export interface CommuteResult {
  options: CommuteOption[];
  count: number;
  nonstopCount: number;
  /** Latest arrival time at base that still works (report minus buffer), 'HH:MM' base-local. */
  deadlineHhmm: string;
  /** The deadline falls on the day before the report date (report minus buffer crosses midnight). */
  deadlineDayBefore: boolean;
}

export interface CommuteDay {
  dateKey: string;
  /** Qualifying arrivals on that date (null when the schedules do not reach it). */
  count: number | null;
  /** Of `count`, arrivals the evening before (included in the count). */
  eveningBefore: number;
  /** Today at base: flights already departed are not counted, so it is never flagged. */
  today: boolean;
  /** Today, and the report time has already passed. */
  past: boolean;
  /** Latest arrival that day that still works, 'HH:MM'. */
  lastHhmm: string | null;
  fewer: boolean;
}

/** Hubs and destinations as { code, name }, sorted by name. */
export function commuteAirports(): { code: string; name: string }[] {
  const seen = new Set<string>();
  const out: { code: string; name: string }[] = [];
  for (const a of [...HUBS.map(h => ({ code: h.code, name: h.name })), ...DESTINATIONS.map(d => ({ code: d.code, name: d.city }))]) {
    if (seen.has(a.code)) continue;
    seen.add(a.code);
    out.push(a);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

/** Why the settings cannot be searched, or null. */
export function commuteProblem(home: string, base: string): 'home' | 'same' | null {
  if (!home) return 'home';
  return home === base ? 'same' : null;
}

function toOption(it: Itinerary, dayBefore: boolean): CommuteOption {
  const last = it.legs[it.legs.length - 1];
  return {
    itinerary: it, nonstop: it.legs.length === 1, dayBefore, latest: false,
    departHhmm: it.legs[0].depLocal, arriveHhmm: last.arrLocal,
    flights: it.legs.map(l => l.flightNumber ?? ''),
  };
}

/** Nonstop first, then by the time asked for. */
function sorted(list: CommuteOption[], by: 'arrive' | 'depart'): CommuteOption[] {
  const k = (o: CommuteOption) => (by === 'arrive' ? o.itinerary.arriveUtc : o.itinerary.departUtc);
  return list.sort((a, b) => Number(b.nonstop) - Number(a.nonstop) || k(a) - k(b) || a.itinerary.departUtc - b.itinerary.departUtc);
}

/** Scheduled (not estimated, not departed) itineraries leaving `from` on the given local dates. */
function candidates(from: string, to: string, days: readonly string[], input: CommuteInput): Itinerary[] {
  const connect = input.connect ?? NO_OPTS;
  const cov = coverageHubFor(from, to) ?? from;
  const out: Itinerary[] = [];
  for (const day of days) {
    if (!isCovered(day, cov)) continue;
    const its = [
      ...directItineraries(from, to, day),
      ...(input.showConnections ? findItineraries(from, to, day, connect).filter(it => it.legs.length > 1) : []),
    ];
    for (const it of its) if (!it.estimated && it.departUtc > input.nowMs) out.push(it);
  }
  return out;
}

function latestOf(options: readonly CommuteOption[]): CommuteOption | null {
  return options.reduce<CommuteOption | null>((m, o) => (!m || o.itinerary.arriveUtc > m.itinerary.arriveUtc ? o : m), null);
}

/**
 * Every itinerary home → base that arrives at least bufferMin before the
 * report time (base-local), on the report day or the evening before.
 */
export function commuteOptions(input: CommuteInput, reportKey: string, reportHhmm: string): CommuteResult {
  const baseTz = airportTz(input.base);
  const cutoff = toUtcMs(reportKey, reportHhmm, baseTz) - input.bufferMin * MINUTE_MS;
  const before = addDays(reportKey, -1);
  const days = [addDays(reportKey, -2), before, reportKey, addDays(reportKey, 1)];
  const list: CommuteOption[] = [];
  for (const it of candidates(input.home, input.base, days, input)) {
    if (it.arriveUtc > cutoff) continue;
    const arr = it.legs[it.legs.length - 1].arrLocal;
    if (it.arrDateKey === reportKey) list.push(toOption(it, false));
    else if (it.arrDateKey === before && arr >= DAY_BEFORE_FROM) list.push(toOption(it, true));
  }
  const options = sorted(list, 'arrive');
  const latest = latestOf(options);
  if (latest) latest.latest = true;
  return {
    options, count: options.length, nonstopCount: options.filter(o => o.nonstop).length,
    deadlineHhmm: utcToLocal(cutoff, baseTz).hhmm,
    deadlineDayBefore: utcToLocal(cutoff, baseTz).dateKey < reportKey,
  };
}

/**
 * The 14-day view: for each day from todayKey, arrivals by the same report time,
 * on the day or the evening before. Today only counts flights that have not left,
 * so it is never flagged (and is marked past once its report time has gone).
 */
export function commuteDays(input: CommuteInput, reportHhmm: string, todayKey: string, days = COMMUTE_DAYS): CommuteDay[] {
  const cov = coverageHubFor(input.home, input.base) ?? input.home;
  const baseTz = airportTz(input.base);
  const out: CommuteDay[] = [];
  for (let i = 0; i < days; i++) {
    const dateKey = addDays(todayKey, i);
    const today = i === 0;
    const past = today && toUtcMs(dateKey, reportHhmm, baseTz) <= input.nowMs;
    if (!isCovered(dateKey, cov)) {
      out.push({ dateKey, count: null, eveningBefore: 0, today, past, lastHhmm: null, fewer: false });
      continue;
    }
    const opts = commuteOptions(input, dateKey, reportHhmm).options;
    out.push({
      dateKey, count: opts.length, eveningBefore: opts.filter(o => o.dayBefore).length, today, past,
      lastHhmm: latestOf(opts)?.arriveHhmm ?? null, fewer: !today && opts.length < MIN_OPTIONS,
    });
  }
  return out;
}

/**
 * The trip home after duty: base → home on the release date, leaving at least
 * HOME_AFTER_RELEASE_MIN after release (base-local). Nonstop first, then by departure.
 */
export function tripHomeOptions(input: CommuteInput, releaseKey: string, releaseHhmm: string): CommuteOption[] {
  const earliest = toUtcMs(releaseKey, releaseHhmm, airportTz(input.base)) + HOME_AFTER_RELEASE_MIN * MINUTE_MS;
  const list = candidates(input.base, input.home, [releaseKey], input)
    .filter(it => it.departUtc >= earliest)
    .map(it => toOption(it, false));
  return sorted(list, 'depart');
}
