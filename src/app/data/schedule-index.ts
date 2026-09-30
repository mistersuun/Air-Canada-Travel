/**
 * Hand-written access layer over the generated schedules (critique 6).
 *
 * - Builds ROUTE_INDEX (`${origin}-${dest}` → records) from ROUTE_SCHEDULES so
 *   lookups are O(1) instead of a linear find over ~600 routes.
 * - Makes the schedule source injectable: specs call setScheduleSource(fixture)
 *   and resetScheduleSource() so behavioural tests never depend on live data
 *   that expires with the next weekly scrape (critique 9).
 * - Computes coverage windows globally and per airport (critique 7), reading
 *   SCHEDULES_META when the generator emits it.
 *
 * Nothing in here knows about destinations or time zones; see utils/.
 */
import * as generated from './schedules';
import type { FlightSchedule } from './schedules';

/** A generated schedule row. `arrDayOffset` is optional (the PDFs have no marker; see critique 5). */
export interface ScheduleRecord extends FlightSchedule {
  arrDayOffset?: number;
}

export interface ScheduleRoute {
  originCode: string;
  destinationCode: string;
  schedules: readonly ScheduleRecord[];
}

/** Shape of SCHEDULES_META when the scraper emits it (all fields optional). */
export interface SchedulesMeta {
  generatedAt?: string;
  coverageFrom?: string;
  coverageTo?: string;
  pdfCount?: number;
  recordCount?: number;
  sources?: readonly string[];
}

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

function readGeneratedMeta(): SchedulesMeta | null {
  // SCHEDULES_META only exists once WS1's generator lands; read it defensively
  // (a dynamic lookup, so the bundler does not warn about a missing export).
  const meta = Object.entries(generated).find(([name]) => name === 'SCHEDULES_META')?.[1];
  return meta && typeof meta === 'object' ? (meta as SchedulesMeta) : null;
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

let state: SourceState = build(generated.ROUTE_SCHEDULES, readGeneratedMeta());
let version = 0;

/**
 * Live binding: `${origin}-${dest}` → schedule records of the current source.
 * Reassigned by setScheduleSource(); importers always see the current map.
 */
export let ROUTE_INDEX: ReadonlyMap<string, readonly ScheduleRecord[]> = state.index;

/**
 * Replace the schedule data (tests, or a future async JSON load).
 * Bumps scheduleVersion() so memoised engine caches invalidate.
 */
export function setScheduleSource(routes: readonly ScheduleRoute[], meta: SchedulesMeta | null = null): void {
  state = build(routes, meta);
  ROUTE_INDEX = state.index;
  version++;
}

/** Restore the generated schedules.ts data. */
export function resetScheduleSource(): void {
  setScheduleSource(generated.ROUTE_SCHEDULES, readGeneratedMeta());
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
 * global window (SCHEDULES_META when present, else min/max of the data).
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
