/**
 * Logbook stamps (F3). Computed from boarded flights every time, never
 * stored, so they can never drift from the log.
 *
 * - Place stamps: one per airport you have flown to (the passport page).
 * - Inspiration stamps: for a new traveller, faint stamps of places the home
 *   hub flies to nonstop. Labelled as inspiration, not a to-do list.
 * - Quiet achievements: listed only once earned; no points, levels or streaks.
 */
import { geoInterpolate } from 'd3-geo';
import { getDestinationCodes } from '../data/schedule-index';
import { DESTINATIONS, HUBS, REGIONS } from '../data/destinations';
import { findHub } from '../utils/airports';
import { type BoardedFlight, airportInfo } from './logbook';

export interface PlaceStamp {
  code: string;
  city: string;
  region: string;
  /** Boarded flights that arrived here. */
  count: number;
  firstDateKey: string;
}

/**
 * Airports you have arrived at, oldest first. A hub you only came home to
 * (arriving from a non-hub airport) is not stamped; hub-to-hub flights are.
 */
export function placeStamps(flights: readonly BoardedFlight[]): PlaceStamp[] {
  const out = new Map<string, PlaceStamp>();
  for (const f of flights) {
    if (findHub(f.dest) && !findHub(f.origin)) continue;
    const a = airportInfo(f.dest);
    if (!a) continue;
    const cur = out.get(f.dest);
    if (cur) {
      cur.count++;
      if (f.dateKey < cur.firstDateKey) cur.firstDateKey = f.dateKey;
    } else {
      out.set(f.dest, { code: f.dest, city: a.city, region: a.region, count: 1, firstDateKey: f.dateKey });
    }
  }
  return [...out.values()].sort((p, q) => p.firstDateKey.localeCompare(q.firstDateKey) || p.code.localeCompare(q.code));
}

export interface InspirationStamp { code: string; city: string; region: string }

/**
 * Faint placeholder stamps: the hub's nonstop destinations, spread across
 * regions (one from each region in turn) so the grid is not all Caribbean.
 * Deterministic: alphabetical within a region.
 */
export function inspirationStamps(hubCode: string, limit = 8): InspirationStamp[] {
  const byRegion = new Map<string, InspirationStamp[]>();
  for (const code of [...getDestinationCodes(hubCode)].sort()) {
    const d = DESTINATIONS.find(x => x.code === code);
    if (!d) continue;
    const list = byRegion.get(d.region) ?? [];
    list.push({ code: d.code, city: d.city, region: d.region });
    byRegion.set(d.region, list);
  }
  const regions = [...byRegion.keys()].sort((a, b) => REGIONS.indexOf(a) - REGIONS.indexOf(b));
  const out: InspirationStamp[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const r of regions) {
      const s = byRegion.get(r)![round];
      if (s && out.length < limit) { out.push(s); added = true; }
    }
    if (!added) break;
  }
  return out;
}

export type AchievementId = 'equator' | 'arctic' | 'allRegions' | 'redEye' | 'dayTripper' | 'everyHub' | 'antipodes';

export interface Achievement {
  id: AchievementId;
  label: string;
  /** A fact about what earned it ('YYZ → GRU'); never a target or a count to chase. */
  detail: string;
}

export const ARCTIC_CIRCLE_LAT = 66.5634;
export const ANTIPODES_CODES = ['SYD', 'AKL', 'MEL', 'BNE'] as const;
const SAMPLES = 64;
const RED_EYE_FROM_MIN = 22 * 60;

/** Latitudes along the great circle between two airports (SAMPLES + 1 points, ends included). */
export function pathLatitudes(origin: string, dest: string): number[] {
  const a = airportInfo(origin);
  const b = airportInfo(dest);
  if (!a || !b) return [];
  const f = geoInterpolate([a.lng, a.lat], [b.lng, b.lat]);
  const lats: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) lats.push(f(i / SAMPLES)[1]);
  return lats;
}

export function crossesEquator(origin: string, dest: string): boolean {
  const lats = pathLatitudes(origin, dest);
  if (!lats.length) return false;
  return Math.min(...lats) <= 0 && Math.max(...lats) >= 0;
}

export function entersArctic(origin: string, dest: string): boolean {
  const lats = pathLatitudes(origin, dest);
  return lats.length > 0 && Math.max(...lats) >= ARCTIC_CIRCLE_LAT;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Departs 22:00 or later (origin-local) and lands the next calendar day or later. */
export function isRedEye(f: BoardedFlight): boolean {
  if (!f.depLocal || !f.arrDateKey) return false;
  return toMin(f.depLocal) >= RED_EYE_FROM_MIN && f.arrDateKey > f.dateKey;
}

const route = (f: Pick<BoardedFlight, 'origin' | 'dest'>) => `${f.origin} → ${f.dest}`;

/** The earned achievements, in a fixed order. Unearned ones are simply absent. */
export function achievements(flights: readonly BoardedFlight[]): Achievement[] {
  const out: Achievement[] = [];

  const eq = flights.find(f => crossesEquator(f.origin, f.dest));
  if (eq) out.push({ id: 'equator', label: 'Crossed the equator', detail: route(eq) });

  const ar = flights.find(f => entersArctic(f.origin, f.dest));
  if (ar) out.push({ id: 'arctic', label: 'Over the Arctic Circle', detail: route(ar) });

  const allRegions = REGIONS.filter(r => r !== 'All');
  const seen = new Set<string>();
  for (const f of flights) {
    const a = airportInfo(f.dest);
    if (a) seen.add(a.region);
  }
  if (flights.length && allRegions.every(r => seen.has(r))) {
    out.push({ id: 'allRegions', label: 'All regions', detail: `${allRegions.length} regions` });
  }

  const re = flights.find(isRedEye);
  if (re) out.push({ id: 'redEye', label: 'Red-eye', detail: route(re) });

  const dt = flights.find(f =>
    flights.some(g => g.dateKey === f.dateKey && g.origin === f.dest && g.dest === f.origin && g.key !== f.key));
  if (dt) {
    const first = flights.find(g => g.dateKey === dt.dateKey && g.origin === dt.dest && g.dest === dt.origin
      && g.key !== dt.key)!;
    // Out is the one that left first on the day.
    const out1 = (dt.depLocal ?? '') <= (first.depLocal ?? '') ? dt : first;
    out.push({ id: 'dayTripper', label: 'Day tripper', detail: `${route(out1)} and back` });
  }

  const touched = new Set<string>();
  for (const f of flights) { touched.add(f.origin); touched.add(f.dest); }
  if (HUBS.every(h => touched.has(h.code))) {
    out.push({ id: 'everyHub', label: 'Every hub', detail: `${HUBS.length} hubs` });
  }

  const anti = ANTIPODES_CODES.find(c => touched.has(c));
  if (anti) {
    const a = airportInfo(anti);
    out.push({ id: 'antipodes', label: 'Antipodes', detail: a?.city ?? anti });
  }
  return out;
}

/** A steady tilt for a stamp, -5 to +5 degrees, from its code (so it never jumps between renders). */
export function stampAngle(code: string): number {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 1009;
  return (h % 11) - 5;
}
