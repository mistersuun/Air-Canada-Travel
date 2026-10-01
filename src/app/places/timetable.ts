/**
 * Real ground timetables from public/data/ground.json, built by
 * scripts/build-ground.py from open GTFS feeds (Renfe, SNCF, Eurostar,
 * FlixBus, DELFI, TFI). Each corridor direction holds typical weekday,
 * Saturday and Sunday departures (local time at the origin station) and the
 * dates they are valid for. Pure functions plus one module-level signal, so
 * every synchronous caller of groundEstimate() recomputes once the file loads.
 */
import { signal } from '@angular/core';
import { addDays, isDateKey, minToHhmm, weekdayIndex } from '../utils/time';

/** One departure: minutes after local midnight, ride minutes, index into `products`. */
export interface Departure { depMin: number; rideMin: number; product: string }

export interface TimetableSource {
  name: string;
  credit: string;
  licence: string;
  licenceUrl: string;
  url: string;
  fetched: string;
}

export interface TimetableDir {
  src: string;
  /** Operator shown to the traveller ('Renfe'). */
  op: string;
  from: string;
  to: string;
  /** Origin station time zone: departures are wall-clock times here. */
  tz: string;
  validFrom: string;
  validTo: string;
  wk: readonly Departure[];
  sat: readonly Departure[];
  sun: readonly Departure[];
  /** Dates inside validity with no departure at all. */
  noService: ReadonlySet<string>;
  note: string | null;
}

export interface TimetableCorridor { mode: 'train' | 'bus'; out: TimetableDir | null; back: TimetableDir | null }

export interface GroundTimetables {
  builtAt: string;
  license: string;
  licenseUrl: string;
  licenseNote: string;
  sources: Readonly<Record<string, TimetableSource>>;
  corridors: ReadonlyMap<string, TimetableCorridor>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function decodeDeps(raw: unknown, products: string[]): Departure[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Departure[] = [];
  for (const d of raw) {
    if (!Array.isArray(d) || d.length < 3) return null;
    const [dep, ride, p] = d;
    if (![dep, ride, p].every(n => Number.isInteger(n))) return null;
    if (dep < 0 || dep >= 1440 || ride <= 0 || ride > 24 * 60 || p < 0 || p >= products.length) return null;
    out.push({ depMin: dep, rideMin: ride, product: products[p] });
  }
  return out.sort((a, b) => a.depMin - b.depMin);
}

function decodeDir(raw: unknown): TimetableDir | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const products = Array.isArray(r['p']) && r['p'].every(x => typeof x === 'string') ? (r['p'] as string[]) : null;
  if (!products) return null;
  const validFrom = str(r['validFrom']);
  const validTo = str(r['validTo']);
  if (!isDateKey(validFrom) || !isDateKey(validTo) || validFrom > validTo || !str(r['tz'])) return null;
  const wk = decodeDeps(r['wk'], products);
  const sat = decodeDeps(r['sat'], products);
  const sun = decodeDeps(r['sun'], products);
  if (!wk || !sat || !sun) return null;
  const x = Array.isArray(r['x']) ? (r['x'] as unknown[]).filter((k): k is string => isDateKey(k)) : [];
  return {
    src: str(r['src']), op: str(r['op']), from: str(r['from']), to: str(r['to']), tz: str(r['tz']),
    validFrom, validTo, wk, sat, sun, noService: new Set(x), note: str(r['note']) || null,
  };
}

/** GroundTimetables from parsed ground.json, or null when the file is not one. Bad corridors are skipped. */
export function decodeGround(file: unknown): GroundTimetables | null {
  if (!file || typeof file !== 'object') return null;
  const f = file as Record<string, unknown>;
  if (f['v'] !== 1 || !f['corridors'] || typeof f['corridors'] !== 'object') return null;
  const sources: Record<string, TimetableSource> = {};
  for (const [id, s] of Object.entries((f['sources'] ?? {}) as Record<string, unknown>)) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    sources[id] = {
      name: str(o['name']) || id, credit: str(o['credit']), licence: str(o['licence']),
      licenceUrl: str(o['licenceUrl']), url: str(o['url']), fetched: str(o['fetched']),
    };
  }
  const corridors = new Map<string, TimetableCorridor>();
  for (const [key, raw] of Object.entries(f['corridors'] as Record<string, unknown>)) {
    if (!/^[A-Z]{3}-\d+$/.test(key) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const mode = r['mode'] === 'bus' ? 'bus' : r['mode'] === 'train' ? 'train' : null;
    const out = decodeDir(r['out']);
    const back = decodeDir(r['back']);
    if (!mode || (!out && !back)) continue;
    corridors.set(key, { mode, out, back });
  }
  return {
    builtAt: str(f['builtAt']), license: str(f['license']), licenseUrl: str(f['licenseUrl']),
    licenseNote: str(f['licenseNote']), sources, corridors,
  };
}

// ── The loaded file ─────────────────────────────────────────────────────────

const loaded = signal<GroundTimetables | null>(null);

/** The timetables once ground.json has loaded (a signal read: callers in computeds update when it arrives). */
export function groundTimetables(): GroundTimetables | null {
  return loaded();
}

/** Set by GroundTimetableService (and specs). */
export function setGroundTimetables(t: GroundTimetables | null): void {
  loaded.set(t);
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/** The direction for a corridor row: gateway → city (out) or city → gateway (reverse). */
export function timetableFor(
  t: GroundTimetables | null | undefined, code: string, geonameId: number, reverse: boolean,
): TimetableDir | null {
  const c = t?.corridors.get(`${code}-${geonameId}`);
  if (!c) return null;
  return (reverse ? c.back : c.out) ?? null;
}

export type DayKind = 'wk' | 'sat' | 'sun';

export function dayKind(dateKey: string): DayKind {
  const wd = weekdayIndex(dateKey); // 0 = Monday
  return wd === 5 ? 'sat' : wd === 6 ? 'sun' : 'wk';
}

/** 'weekdays', 'Saturdays', 'Sundays'. */
export const DAY_KIND_LABEL: Record<DayKind, string> = { wk: 'weekdays', sat: 'Saturdays', sun: 'Sundays' };

/** That date's departures (sorted); [] when nothing runs; null outside the timetable's dates. */
export function departuresOn(dir: TimetableDir, dateKey: string): readonly Departure[] | null {
  if (dateKey < dir.validFrom || dateKey > dir.validTo) return null;
  if (dir.noService.has(dateKey)) return [];
  return dir[dayKind(dateKey)];
}

/** How far ahead nextDeparture looks for the next running day. */
export const NEXT_DEPARTURE_DAYS = 3;

/**
 * The first departure at or after `fromMin` on `dateKey`, else the first one
 * on a following day (up to NEXT_DEPARTURE_DAYS). Null when the timetable
 * stops covering the dates before one is found.
 */
export function nextDeparture(
  dir: TimetableDir, dateKey: string, fromMin: number,
): { dateKey: string; hhmm: string; dep: Departure; sameDay: boolean } | null {
  for (let i = 0; i <= NEXT_DEPARTURE_DAYS; i++) {
    const key = addDays(dateKey, i);
    const deps = departuresOn(dir, key);
    if (deps === null) return null;
    const dep = deps.find(d => i > 0 || d.depMin >= fromMin);
    if (dep) return { dateKey: key, hhmm: minToHhmm(dep.depMin), dep, sameDay: i === 0 };
  }
  return null;
}

/** The middle ride time of a day (the lower middle for an even count). */
export function typicalRide(deps: readonly Departure[]): number {
  const r = deps.map(d => d.rideMin).sort((a, b) => a - b);
  return r[Math.floor((r.length - 1) / 2)];
}

/** 'Dec 20' for a date key. */
export function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
}
