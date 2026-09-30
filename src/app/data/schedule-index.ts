/**
 * Hand-written access layer over the generated schedules (critique 6).
 *
 * - The data lives in public/data/schedules.json (written by
 *   scripts/fetch-schedules.py), outside the JS bundle: loadSchedules() fetches
 *   and installs it before the app starts (app.config.ts), and the service
 *   worker caches it with the app. decodeSchedules() turns the compact file
 *   into ScheduleRoute records.
 * - Builds ROUTE_INDEX (`${origin}-${dest}` → records) so lookups are O(1)
 *   instead of a linear find over ~700 routes.
 * - Makes the schedule source injectable: specs call setScheduleSource(fixture)
 *   and resetScheduleSource() so behavioural tests never depend on live data
 *   that expires with the next weekly scrape (critique 9).
 * - Computes coverage windows globally and per airport (critique 7), reading
 *   the file's meta when present.
 *
 * Nothing in here knows about destinations or time zones; see utils/.
 */

/** One published schedule row: a flight on some weekdays between two dates. */
export interface FlightSchedule {
  fromDate: string;
  toDate: string;
  /** 'Mon,Wed,Fri'. */
  days: string;
  flightNumber: string;
  /** 'HH:MM' local at the origin. */
  departure: string;
  /** 'HH:MM' local at the destination. */
  arrival: string;
  /** IATA equipment code ('789'). */
  aircraft: string;
}

/** A generated schedule row. `arrDayOffset` is optional (the PDFs have no marker; see critique 5). */
export interface ScheduleRecord extends FlightSchedule {
  arrDayOffset?: number;
}

export interface ScheduleRoute {
  originCode: string;
  destinationCode: string;
  schedules: readonly ScheduleRecord[];
}

/** The file's `meta` block (all fields optional). */
export interface SchedulesMeta {
  generatedAt?: string;
  coverageFrom?: string;
  coverageTo?: string;
  coverageByHub?: Readonly<Record<string, { from: string; to: string }>>;
  pdfCount?: number;
  routeCount?: number;
  recordCount?: number;
  sources?: readonly string[];
}

/** A record in the file: [fromDate, toDate, 'M-W-F--' day mask, flight, departure, arrival, aircraft]. */
export type EncodedSchedule = readonly [string, string, string, string, string, string, string];

/** public/data/schedules.json, as written by scripts/fetch-schedules.py. */
export interface SchedulesFile {
  version: number;
  meta?: SchedulesMeta;
  /** 'YUL-CDG' → records. */
  routes: Readonly<Record<string, readonly EncodedSchedule[]>>;
}

/** Where the app fetches the schedules (relative to the base href). */
export const SCHEDULES_URL = 'data/schedules.json';

export interface CoverageWindow {
  /** First date key with published data, or null when there is none. */
  from: string | null;
  /** Last date key with published data (inclusive), or null. */
  to: string | null;
}

export interface Coverage extends CoverageWindow {
  /** ISO timestamp of the last scrape, when known. */
  generatedAt: string | null;
  /** The airport this window was computed for, or null for the global window. */
  hub: string | null;
}

interface SourceState {
  routes: readonly ScheduleRoute[];
  meta: SchedulesMeta | null;
  index: Map<string, readonly ScheduleRecord[]>;
  originsByDest: Map<string, string[]>;
  destsByOrigin: Map<string, string[]>;
  global: CoverageWindow;
  byAirport: Map<string, CoverageWindow>;
  aircraft: string[];
}

const DAY_LETTERS = 'MTWRFSU';
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const maskCache = new Map<string, string>();

/** 'M-W-F--' → 'Mon,Wed,Fri' (the PDFs' mask: R = Thursday, U = Sunday). */
export function decodeDayMask(mask: string): string {
  let days = maskCache.get(mask);
  if (days === undefined) {
    days = [...mask].map((c, i) => (c === DAY_LETTERS[i] ? DAY_NAMES[i] : '')).filter(Boolean).join(',');
    maskCache.set(mask, days);
  }
  return days;
}

/** Turns the compact schedules file into routes. Throws on a file it cannot read. */
export function decodeSchedules(file: SchedulesFile): { routes: ScheduleRoute[]; meta: SchedulesMeta | null } {
  if (!file || typeof file !== 'object' || file.version !== 1 || !file.routes || typeof file.routes !== 'object') {
    throw new Error('Unsupported schedules file');
  }
  const routes: ScheduleRoute[] = [];
  for (const [key, rows] of Object.entries(file.routes)) {
    const [originCode, destinationCode] = key.split('-');
    if (!originCode || !destinationCode || !Array.isArray(rows)) continue;
    routes.push({
      originCode,
      destinationCode,
      schedules: rows.map(r => ({
        fromDate: r[0], toDate: r[1], days: decodeDayMask(r[2]), flightNumber: r[3],
        departure: r[4], arrival: r[5], aircraft: r[6],
      })),
    });
  }
  return { routes, meta: file.meta ?? null };
}

function widen(w: CoverageWindow, from: string, to: string): void {
  if (w.from === null || from < w.from) w.from = from;
  if (w.to === null || to > w.to) w.to = to;
}

function build(routes: readonly ScheduleRoute[], meta: SchedulesMeta | null): SourceState {
  const index = new Map<string, readonly ScheduleRecord[]>();
  const originsByDest = new Map<string, string[]>();
  const destsByOrigin = new Map<string, string[]>();
  const global: CoverageWindow = { from: null, to: null };
  const byAirport = new Map<string, CoverageWindow>();
  const aircraft = new Set<string>();

  const windowFor = (code: string) => {
    let w = byAirport.get(code);
    if (!w) byAirport.set(code, (w = { from: null, to: null }));
    return w;
  };

  for (const r of routes) {
    const key = `${r.originCode}-${r.destinationCode}`;
    const existing = index.get(key);
    index.set(key, existing ? [...existing, ...r.schedules] : r.schedules);
    if (!r.schedules.length) continue;

    const o = originsByDest.get(r.destinationCode) ?? [];
    if (!o.includes(r.originCode)) o.push(r.originCode);
    originsByDest.set(r.destinationCode, o);
    const d = destsByOrigin.get(r.originCode) ?? [];
    if (!d.includes(r.destinationCode)) d.push(r.destinationCode);
    destsByOrigin.set(r.originCode, d);

    for (const s of r.schedules) {
      widen(global, s.fromDate, s.toDate);
      widen(windowFor(r.originCode), s.fromDate, s.toDate);
      widen(windowFor(r.destinationCode), s.fromDate, s.toDate);
      if (s.aircraft) aircraft.add(s.aircraft);
    }
  }

  if (meta?.coverageFrom) global.from = meta.coverageFrom;
  if (meta?.coverageTo) global.to = meta.coverageTo;

  return {
    routes, meta, index, originsByDest, destsByOrigin, global, byAirport,
    aircraft: [...aircraft].sort(),
  };
}

/** The loaded (published) data that resetScheduleSource() restores. */
let baseline: { routes: readonly ScheduleRoute[]; meta: SchedulesMeta | null } = { routes: [], meta: null };
let state: SourceState = build(baseline.routes, baseline.meta);
let version = 0;

/**
 * Live binding: `${origin}-${dest}` → schedule records of the current source.
 * Reassigned by setScheduleSource(); importers always see the current map.
 */
export let ROUTE_INDEX: ReadonlyMap<string, readonly ScheduleRecord[]> = state.index;

/**
 * Replace the schedule data (tests inject fixtures here).
 * Bumps scheduleVersion() so memoised engine caches invalidate.
 */
export function setScheduleSource(routes: readonly ScheduleRoute[], meta: SchedulesMeta | null = null): void {
  state = build(routes, meta);
  ROUTE_INDEX = state.index;
  version++;
}

/** Restore the published data (the last installSchedules/loadSchedules). */
export function resetScheduleSource(): void {
  setScheduleSource(baseline.routes, baseline.meta);
}

/** Installs a schedules file as the published data. */
export function installSchedules(file: SchedulesFile): void {
  baseline = decodeSchedules(file);
  resetScheduleSource();
}

/** True once published data is installed. */
export function schedulesLoaded(): boolean {
  return baseline.routes.length > 0;
}

/**
 * Fetches and installs public/data/schedules.json (app startup). The service
 * worker serves it from cache offline. Resolves false, leaving the source
 * empty, when it cannot be loaded, so the app still starts (and says so).
 */
export async function loadSchedules(
  url: string = SCHEDULES_URL,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<boolean> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    installSchedules((await res.json()) as SchedulesFile);
    return true;
  } catch (err) {
    console.error(`[schedules] could not load ${url}:`, err);
    return false;
  }
}

/** Increments on every source change; used as a cache key by the engine. */
export function scheduleVersion(): number {
  return version;
}

export function getRouteSchedules(): readonly ScheduleRoute[] {
  return state.routes;
}

/** Same signature as the generated helper, but O(1) and source-aware. */
export function getSchedulesForRoute(originCode: string, destinationCode: string): readonly ScheduleRecord[] {
  return state.index.get(`${originCode}-${destinationCode}`) ?? [];
}

/** Airport codes with at least one published flight to `destCode`. */
export function getOriginCodes(destCode: string): readonly string[] {
  return state.originsByDest.get(destCode) ?? [];
}

/** Airport codes with at least one published flight from `originCode`. */
export function getDestinationCodes(originCode: string): readonly string[] {
  return state.destsByOrigin.get(originCode) ?? [];
}

export function getSchedulesMeta(): SchedulesMeta | null {
  return state.meta;
}

/** Every aircraft type code present in the data, sorted. */
export function getAircraftCodes(): readonly string[] {
  return state.aircraft;
}

/**
 * Published coverage window. With `hub`, the window of that airport's flights
 * (each hub PDF and seasonal route ends at a different date); without, the
 * global window (the file's meta when present, else min/max of the data).
 */
export function getCoverage(hub?: string | null): Coverage {
  const generatedAt = state.meta?.generatedAt ?? null;
  if (hub) {
    const w = state.byAirport.get(hub);
    if (w) return { from: w.from, to: w.to, generatedAt, hub };
  }
  return { from: state.global.from, to: state.global.to, generatedAt, hub: null };
}

/** Coverage window per airport code (origins and destinations). */
export function getCoverageByAirport(): ReadonlyMap<string, CoverageWindow> {
  return state.byAirport;
}

/** True when `dateKey` lies inside the (hub's) published window, inclusive. */
export function isCovered(dateKey: string, hub?: string | null): boolean {
  const c = getCoverage(hub);
  return c.from !== null && c.to !== null && dateKey >= c.from && dateKey <= c.to;
}
