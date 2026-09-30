/**
 * One-stop connection engine.
 *
 * A connection is from → hub → to where each leg is a "segment":
 *   - real published flights when the pair exists in the schedules (the
 *     international legs, and domestic hub-to-hub legs once WS1 emits them);
 *   - otherwise, between two hubs only, an ESTIMATED leg from HUB_FLIGHTS:
 *     flightNumber null, aircraft null, estimated true.
 * Layovers are computed on UTC instants (each airport's zone), so YVR→YUL→LHR
 * is no longer off by three hours. Itineraries keep
 * one option per reachable onward flight (fed by the latest possible first
 * leg), ranked by arrival, then total trip time — never by shortest layover alone.
 */
import { Destination, HUBS } from '../data/destinations';
import { getSchedulesForRoute, scheduleVersion } from '../data/schedule-index';
import { airportName, airportTz, findDestination, findHub } from './airports';
import { FlightInstance, flightsOn } from './week';
import {
  MINUTE_MS,
  addDays,
  diffDays,
  formatDuration,
  keyToDate,
  toKey,
  toUtcMs,
  utcToLocal,
  weekKeys,
} from './time';

export interface Itinerary {
  /** 1 leg for a direct flight, 2 for a one-stop connection. */
  legs: FlightInstance[];
  /** Minutes on the ground between consecutive legs (length legs − 1). */
  layovers: number[];
  /** Door-to-door elapsed minutes, first departure to last arrival. */
  totalMin: number;
  departUtc: number;
  arriveUtc: number;
  /** True when any leg is estimated (not from published schedules). */
  estimated: boolean;
  /** Connection airports, in order ([] for direct). */
  hubs: string[];
  origin: string;
  dest: string;
  /** Local departure date at the origin. */
  dateKey: string;
  /** Local arrival date at the destination. */
  arrDateKey: string;
  /** arrDateKey − dateKey in days. */
  arrDayOffset: number;
}

export interface ConnectOptions {
  /** Minimum connection time in minutes (default 60). */
  minConnect?: number;
  /** Maximum same-day layover in minutes (default 360). */
  maxLayover?: number;
  /**
   * Allow layovers that cross midnight at the hub (default false). Overnight
   * layovers may last up to max(maxLayover, OVERNIGHT_MAX_LAYOVER).
   */
  allowOvernight?: boolean;
  /** Hubs never to connect through. */
  avoidHubs?: readonly string[];
  /** When non-empty, only connect through these hubs. */
  viaHubs?: readonly string[];
}

/**
 * A keyed itinerary predicate. findItineraries applies it BEFORE choosing one
 * feeder per onward leg, so a feeder that satisfies the filter is kept even
 * when a later (unfiltered-best) feeder into the same onward flight is not.
 * `key` must identify the predicate's behaviour (it is part of the cache key).
 */
export interface ItineraryFilter {
  key: string;
  keep: (it: Itinerary) => boolean;
}

/** Shared empty options. ConnectOptions objects are treated as immutable (memoised by identity). */
export const NO_OPTS: ConnectOptions = Object.freeze({});

export const DEFAULT_MIN_CONNECT = 60;
export const DEFAULT_MAX_LAYOVER = 360;
export const OVERNIGHT_MAX_LAYOVER = 14 * 60;
/** Layovers longer than this get a warning pill in the UI. */
export const LONG_LAYOVER = 360;

/**
 * Invented domestic frequencies used only when no real hub-to-hub schedule
 * exists: local departure times at the first hub and a block time in minutes.
 */
export const HUB_FLIGHTS: Record<string, Record<string, { duration: number; flights: string[] }>> = {
  YUL: {
    YYZ: { duration: 80, flights: ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'] },
    YOW: { duration: 35, flights: ['07:00','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YVR: { duration: 330, flights: ['08:00','10:30','14:00','17:00','20:00'] },
    YYC: { duration: 290, flights: ['08:00','10:00','14:00','18:00'] },
    YHZ: { duration: 105, flights: ['07:00','10:00','14:00','17:00','20:00'] },
    YEG: { duration: 295, flights: ['08:00','14:00','18:00'] },
    YWG: { duration: 185, flights: ['08:00','14:00','18:00'] },
    YQB: { duration: 50, flights: ['07:00','10:00','14:00','17:00','20:00'] },
  },
  YYZ: {
    YUL: { duration: 80, flights: ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'] },
    YOW: { duration: 60, flights: ['07:00','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YVR: { duration: 305, flights: ['07:00','08:00','09:30','11:00','13:00','15:00','17:00','19:00','21:00'] },
    YYC: { duration: 270, flights: ['07:00','08:30','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YHZ: { duration: 120, flights: ['07:00','10:00','13:00','16:00','19:00'] },
    YEG: { duration: 280, flights: ['08:00','11:00','15:00','19:00'] },
    YWG: { duration: 170, flights: ['07:00','10:00','14:00','18:00'] },
    YQB: { duration: 90, flights: ['07:00','10:00','14:00','17:00','20:00'] },
  },
  YVR: {
    YYZ: { duration: 275, flights: ['06:00','07:30','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YUL: { duration: 290, flights: ['07:00','10:00','14:00','18:00'] },
    YYC: { duration: 75, flights: ['06:00','07:00','08:00','09:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YEG: { duration: 85, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YWG: { duration: 155, flights: ['07:00','11:00','16:00'] },
  },
  YYC: {
    YYZ: { duration: 235, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YUL: { duration: 255, flights: ['07:00','11:00','15:00','19:00'] },
    YVR: { duration: 90, flights: ['06:00','07:00','08:00','09:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YEG: { duration: 55, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YOW: { duration: 225, flights: ['07:00','12:00','17:00'] },
  },
  YOW: {
    YYZ: { duration: 60, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YUL: { duration: 35, flights: ['07:00','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YVR: { duration: 320, flights: ['08:00','14:00'] },
    YYC: { duration: 280, flights: ['08:00','14:00'] },
  },
  YHZ: {
    YYZ: { duration: 130, flights: ['06:00','08:00','10:00','13:00','16:00','19:00'] },
    YUL: { duration: 110, flights: ['07:00','10:00','14:00','17:00','20:00'] },
    YOW: { duration: 100, flights: ['08:00','14:00','18:00'] },
  },
  YEG: {
    YYZ: { duration: 250, flights: ['06:00','09:00','13:00','17:00'] },
    YVR: { duration: 90, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YYC: { duration: 50, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YUL: { duration: 265, flights: ['07:00','14:00','18:00'] },
  },
  YQB: {
    YYZ: { duration: 100, flights: ['06:00','08:00','11:00','15:00','18:00'] },
    YUL: { duration: 50, flights: ['07:00','10:00','14:00','17:00','20:00'] },
  },
  YWG: {
    YYZ: { duration: 160, flights: ['06:00','09:00','14:00','18:00'] },
    YVR: { duration: 165, flights: ['07:00','12:00','17:00'] },
    YYC: { duration: 130, flights: ['07:00','11:00','16:00'] },
    YUL: { duration: 175, flights: ['07:00','14:00','18:00'] },
  },
};

/** Block minutes for each estimated hub pair, keyed 'YUL-YYZ'. */
export const HUB_PAIR_MINUTES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(HUB_FLIGHTS).flatMap(([from, tos]) =>
    Object.entries(tos).map(([to, v]) => [`${from}-${to}`, v.duration] as const)),
);

// ── Segments ────────────────────────────────────────────────────────────────

/** An invented leg departing `depLocal` (origin local) on `dateKey`. */
export function estimatedInstance(origin: string, dest: string, dateKey: string, depLocal: string, durationMin: number): FlightInstance {
  const depUtc = toUtcMs(dateKey, depLocal, airportTz(origin));
  const arrUtc = depUtc + durationMin * MINUTE_MS;
  const arr = utcToLocal(arrUtc, airportTz(dest));
  return {
    flightNumber: null,
    origin,
    dest,
    dateKey,
    depLocal,
    arrLocal: arr.hhmm,
    arrDateKey: arr.dateKey,
    depUtc,
    arrUtc,
    arrDayOffset: diffDays(dateKey, arr.dateKey),
    durationMin,
    aircraft: null,
    estimated: true,
  };
}

/** True when from → to has published flights or an estimated hub table. */
export function hasSegment(from: string, to: string): boolean {
  return getSchedulesForRoute(from, to).length > 0 || !!HUB_FLIGHTS[from]?.[to];
}

let segVersion = -1;
const segCache = new Map<string, FlightInstance[]>();

/**
 * Flights from → to departing on local `dateKey`: real ones when the pair has
 * any published schedule, else estimated ones for known hub pairs, else [].
 */
export function segmentFlights(from: string, to: string, dateKey: string): FlightInstance[] {
  if (getSchedulesForRoute(from, to).length) return flightsOn(from, to, dateKey);
  const table = HUB_FLIGHTS[from]?.[to];
  if (!table) return [];
  if (segVersion !== scheduleVersion()) {
    segCache.clear();
    segVersion = scheduleVersion();
  }
  const key = `${from}-${to}|${dateKey}`;
  let out = segCache.get(key);
  if (!out) {
    out = table.flights
      .map(t => estimatedInstance(from, to, dateKey, t, table.duration))
      .sort((a, b) => a.depUtc - b.depUtc);
    if (segCache.size > 20_000) segCache.clear();
    segCache.set(key, out);
  }
  return out;
}

// ── Itineraries ─────────────────────────────────────────────────────────────

function makeItinerary(legs: FlightInstance[]): Itinerary {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const layovers: number[] = [];
  for (let i = 1; i < legs.length; i++) {
    layovers.push(Math.round((legs[i].depUtc - legs[i - 1].arrUtc) / MINUTE_MS));
  }
  return {
    legs,
    layovers,
    totalMin: Math.round((last.arrUtc - first.depUtc) / MINUTE_MS),
    departUtc: first.depUtc,
    arriveUtc: last.arrUtc,
    estimated: legs.some(l => l.estimated),
    hubs: legs.slice(0, -1).map(l => l.dest),
    origin: first.origin,
    dest: last.dest,
    dateKey: first.dateKey,
    arrDateKey: last.arrDateKey,
    arrDayOffset: diffDays(first.dateKey, last.arrDateKey),
  };
}

/** Wraps a direct flight as a one-leg itinerary. */
export function directItinerary(flight: FlightInstance): Itinerary {
  return makeItinerary([flight]);
}

/** Every direct flight on `dateKey` as one-leg itineraries, by arrival. */
export function directItineraries(from: string, to: string, dateKey: string): Itinerary[] {
  return flightsOn(from, to, dateKey).map(directItinerary).sort(compareItineraries);
}

/** Arrival first, then total time, then published before estimated. */
export function compareItineraries(a: Itinerary, b: Itinerary): number {
  return a.arriveUtc - b.arriveUtc
    || a.totalMin - b.totalMin
    || Number(a.estimated) - Number(b.estimated)
    || a.departUtc - b.departUtc;
}

interface ResolvedOptions {
  minConnect: number;
  maxLayover: number;
  allowOvernight: boolean;
  avoid: Set<string>;
  via: Set<string>;
  key: string;
}

const resolvedCache = new WeakMap<ConnectOptions, ResolvedOptions>();

function resolved(opts: ConnectOptions): ResolvedOptions {
  let r = resolvedCache.get(opts);
  if (!r) {
    const minConnect = opts.minConnect ?? DEFAULT_MIN_CONNECT;
    const maxLayover = opts.maxLayover ?? DEFAULT_MAX_LAYOVER;
    const allowOvernight = opts.allowOvernight ?? false;
    const avoid = new Set(opts.avoidHubs ?? []);
    const via = new Set(opts.viaHubs ?? []);
    const key = `${minConnect}|${maxLayover}|${allowOvernight}|${[...avoid].sort()}|${[...via].sort()}`;
    r = { minConnect, maxLayover, allowOvernight, avoid, via, key };
    resolvedCache.set(opts, r);
  }
  return r;
}

let itinVersion = -1;
const itinCache = new Map<string, Itinerary[]>();

/**
 * All one-stop itineraries from → hub → to departing `from` on local
 * `dateKey`, through any hub in HUBS: one per reachable onward flight, fed by
 * the latest first leg that makes the connection. Sorted by arrival, then
 * total time. Direct flights are not included.
 */
export function findItineraries(
  from: string,
  to: string,
  dateKey: string,
  opts: ConnectOptions = NO_OPTS,
  filter?: ItineraryFilter,
): Itinerary[] {
  if (from === to) return [];
  const o = resolved(opts);
  if (itinVersion !== scheduleVersion()) {
    itinCache.clear();
    itinVersion = scheduleVersion();
  }
  const cacheKey = `${from}-${to}|${dateKey}|${o.key}|${filter?.key ?? ''}`;
  const hit = itinCache.get(cacheKey);
  if (hit) return hit;

  const out: Itinerary[] = [];
  for (const { code: hub } of HUBS) {
    if (hub === from || hub === to || o.avoid.has(hub)) continue;
    if (o.via.size && !o.via.has(hub)) continue;

    if (!hasSegment(hub, to)) continue;
    const leg1s = segmentFlights(from, hub, dateKey);
    if (!leg1s.length) continue;

    // Leg 2 can leave on any local date a leg 1 arrives, or the day after when overnight is allowed.
    const dates = new Set<string>();
    for (const l of leg1s) {
      dates.add(l.arrDateKey);
      if (o.allowOvernight) dates.add(addDays(l.arrDateKey, 1));
    }
    const leg2s: FlightInstance[] = [];
    for (const d of dates) leg2s.push(...segmentFlights(hub, to, d));
    if (!leg2s.length) continue;

    const pairs: [FlightInstance, FlightInstance][] = [];
    for (const l1 of leg1s) {
      for (const l2 of leg2s) {
        if (l1.estimated && l2.estimated) continue; // never chain two invented legs
        const lay = (l2.depUtc - l1.arrUtc) / MINUTE_MS;
        if (lay < o.minConnect) continue;
        const overnight = l2.dateKey !== l1.arrDateKey;
        if (overnight && !o.allowOvernight) continue;
        const max = overnight ? Math.max(o.maxLayover, OVERNIGHT_MAX_LAYOVER) : o.maxLayover;
        if (lay > max) continue;
        if (filter && !filter.keep(makeItinerary([l1, l2]))) continue;
        pairs.push([l1, l2]);
      }
    }
    for (const legs of bestPerOnwardLeg(pairs)) out.push(makeItinerary(legs));
  }
  out.sort(compareItineraries);
  if (itinCache.size > 20_000) itinCache.clear();
  itinCache.set(cacheKey, out);
  return out;
}

/**
 * For each onward (second) leg keep one feeder: the one leaving latest (the
 * shortest trip), preferring the earlier arrival and then a published leg.
 * Every reachable onward flight stays listed, so later departures remain
 * available as standby backups.
 */
function bestPerOnwardLeg(pairs: [FlightInstance, FlightInstance][]): [FlightInstance, FlightInstance][] {
  const best = new Map<FlightInstance, [FlightInstance, FlightInstance]>();
  for (const p of pairs) {
    const cur = best.get(p[1]);
    if (!cur
      || p[0].depUtc > cur[0].depUtc
      || (p[0].depUtc === cur[0].depUtc && (p[0].arrUtc < cur[0].arrUtc
        || (p[0].arrUtc === cur[0].arrUtc && cur[0].estimated && !p[0].estimated)))) {
      best.set(p[1], p);
    }
  }
  return [...best.values()];
}

/** The top-ranked connection, or null. */
export function bestItinerary(from: string, to: string, dateKey: string, opts: ConnectOptions = NO_OPTS): Itinerary | null {
  return findItineraries(from, to, dateKey, opts)[0] ?? null;
}

/** Direct flights and connections together, ranked. */
export function allItineraries(from: string, to: string, dateKey: string, opts: ConnectOptions = NO_OPTS): Itinerary[] {
  return [...directItineraries(from, to, dateKey), ...findItineraries(from, to, dateKey, opts)].sort(compareItineraries);
}

// ── Week summary ────────────────────────────────────────────────────────────

export interface WeekDaySummary {
  dateKey: string;
  /** Number of direct departures. */
  direct: number;
  /** Number of connecting itineraries. */
  connections: number;
  /** Best connecting itinerary that day, if any. */
  best: Itinerary | null;
}

export interface WeekSummary {
  days: WeekDaySummary[];
  /** Days with at least one direct flight. */
  directDays: number;
  /** Days with at least one connection. */
  connectDays: number;
  /** Days with connections but no direct flight. */
  connectOnlyDays: number;
  /** Distinct hubs used by the daily best connections, most used first. */
  hubs: string[];
  /** True when any daily best connection relies on an estimated leg. */
  estimated: boolean;
}

/**
 * Per-day direct and connection counts for a week. Optional predicates let
 * callers (computeRoutes) apply UI filters to flights and itineraries (the
 * itinerary filter is applied before feeder selection, see ItineraryFilter).
 */
export function summarizeWeek(
  from: string,
  to: string,
  weekStart: string,
  opts: ConnectOptions = NO_OPTS,
  keepFlight: (f: FlightInstance) => boolean = () => true,
  keepItinerary?: ItineraryFilter,
): WeekSummary {
  const hubCount = new Map<string, number>();
  let directDays = 0, connectDays = 0, connectOnlyDays = 0, estimated = false;
  const days = weekKeys(weekStart).map(k => {
    const direct = flightsOn(from, to, k).filter(keepFlight).length;
    const its = findItineraries(from, to, k, opts, keepItinerary);
    const best = its[0] ?? null;
    if (direct) directDays++;
    if (its.length) connectDays++;
    if (its.length && !direct) connectOnlyDays++;
    if (best) {
      estimated ||= best.estimated;
      for (const h of best.hubs) hubCount.set(h, (hubCount.get(h) ?? 0) + 1);
    }
    return { dateKey: k, direct, connections: its.length, best };
  });
  const hubs = [...hubCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
  return { days, directDays, connectDays, connectOnlyDays, hubs, estimated };
}

// ── Return trips and backups ────────────────────────────────────────────────

export interface ReturnOption {
  /** Local departure date of the return, at the destination. */
  dateKey: string;
  /** Nights at the destination, counted from the outbound arrival date. */
  nights: number;
  /** Direct and connecting options home, ranked by arrival. */
  itineraries: Itinerary[];
}

/**
 * Return options dest → home for each stay length. Nights are counted from
 * the outbound's local ARRIVAL date (critique 34): pass the chosen outbound
 * itinerary, or a departure date key (the earliest-arriving outbound that day
 * is used to find the arrival date).
 */
export function findReturnOptions(
  dest: string,
  home: string,
  outbound: string | Itinerary,
  nights: readonly number[],
  opts: ConnectOptions = NO_OPTS,
): ReturnOption[] {
  let arrivalKey: string;
  if (typeof outbound === 'string') {
    const first = allItineraries(home, dest, outbound, opts)[0];
    arrivalKey = first ? first.arrDateKey : outbound;
  } else {
    arrivalKey = outbound.arrDateKey;
  }
  return nights.map(n => {
    const dateKey = addDays(arrivalKey, n);
    return { dateKey, nights: n, itineraries: allItineraries(dest, home, dateKey, opts) };
  });
}

export interface Alternatives {
  /** Later options through the same hub(s) (or later directs), same day. */
  laterSameRoute: Itinerary[];
  /** Options through other hubs (or direct, if the chosen one connects) leaving later the same day. */
  otherHubsSameDay: Itinerary[];
  /** Earliest-arriving option the next day. */
  nextDayFirst: Itinerary | null;
}

/**
 * "If you miss this" schedule options for a chosen itinerary, all ranked by
 * arrival. Only options departing after the chosen one are listed.
 */
export function findAlternatives(from: string, to: string, chosen: Itinerary, opts: ConnectOptions = NO_OPTS): Alternatives {
  const sameHubs = (it: Itinerary) => it.hubs.join('>') === chosen.hubs.join('>');
  const later = allItineraries(from, to, chosen.dateKey, opts).filter(it => it.departUtc > chosen.departUtc);
  return {
    laterSameRoute: later.filter(sameHubs),
    otherHubsSameDay: later.filter(it => !sameHubs(it)),
    nextDayFirst: allItineraries(from, to, addDays(chosen.dateKey, 1), opts)[0] ?? null,
  };
}

/** True when a layover deserves a warning (under the minimum or over 6h). */
export function isLayoverAlert(minutes: number, minConnect = DEFAULT_MIN_CONNECT): boolean {
  return minutes < minConnect || minutes > LONG_LAYOVER;
}

// ── Deprecated adapters (critique 13) ───────────────────────────────────────
// Kept so route-card, flight-modal and app.component compile until WS3/WS5/WS6
// move to Itinerary. Do not use in new code.

/** @deprecated Use FlightInstance. */
export interface ConnectionLeg {
  from: string;
  to: string;
  departure: string;
  arrival: string;
  /** '' for an estimated leg. */
  flightNumber: string;
  /** '' for an estimated leg. */
  aircraft: string;
}

/** @deprecated Use Itinerary. */
export interface ConnectionOption {
  destination: Destination;
  viaHub: string;
  viaHubName: string;
  leg1Duration: number;
  layoverMinutes: number;
  leg1: ConnectionLeg;
  leg2: ConnectionLeg;
  date: Date;
  /** The itinerary this adapter was built from. */
  itinerary: Itinerary;
}

/** @deprecated */
export interface ConnectingRoute {
  destination: Destination;
  isDirect: boolean;
  connections: ConnectionOption[];
}

function toLeg(f: FlightInstance): ConnectionLeg {
  return {
    from: f.origin,
    to: f.dest,
    departure: f.depLocal,
    arrival: f.arrLocal,
    flightNumber: f.flightNumber ?? '',
    aircraft: f.aircraft ?? '',
  };
}

/** @deprecated Adapter from Itinerary to the old ConnectionOption shape. */
export function toConnectionOption(it: Itinerary): ConnectionOption | null {
  const destination = findDestination(it.dest);
  if (!destination || it.legs.length !== 2) return null;
  const hub = it.hubs[0];
  return {
    destination,
    viaHub: hub,
    viaHubName: findHub(hub)?.name ?? airportName(hub),
    leg1Duration: it.legs[0].durationMin,
    layoverMinutes: it.layovers[0],
    leg1: toLeg(it.legs[0]),
    leg2: toLeg(it.legs[1]),
    date: keyToDate(it.dateKey),
    itinerary: it,
  };
}

/** @deprecated Use findItineraries. */
export function findConnections(homeHub: string, destCode: string, date: string | Date, opts: ConnectOptions = NO_OPTS): ConnectionOption[] {
  return findItineraries(homeHub, destCode, toKey(date), opts)
    .map(toConnectionOption)
    .filter((c): c is ConnectionOption => c !== null);
}

/** @deprecated Use summarizeWeek(...).connectDays > 0. */
export function findConnectionsForWeek(homeHub: string, destCode: string, weekStart: string | Date, opts: ConnectOptions = NO_OPTS): boolean {
  return weekKeys(toKey(weekStart)).some(k => findItineraries(homeHub, destCode, k, opts).length > 0);
}

/** @deprecated Use bestItinerary. Returns the top-ranked connection (not the shortest layover). */
export function getBestConnection(homeHub: string, destCode: string, date: string | Date, opts: ConnectOptions = NO_OPTS): ConnectionOption | null {
  return findConnections(homeHub, destCode, date, opts)[0] ?? null;
}

/** '1h 45m'. Same as formatDuration. */
export function formatLayover(minutes: number): string {
  return formatDuration(minutes);
}
