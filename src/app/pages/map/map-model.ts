/**
 * Pure helpers for the map page: list items from route entries, search,
 * sort, the labelled neighbours of a selection, and the framing maths that
 * turns "show these points inside the visible part of the map" into the
 * `[center]` / `[zoom]` inputs of app-route-map.
 */
import { geoCentroid, geoNaturalEarth1 } from 'd3-geo';
import type { Coverage } from '../../data/schedule-index';
import { DotDay, entryDots } from '../../ui/dot-row.component';
import { hm } from '../../ui/format';
import { greatCircleKm, LatLng } from '../../utils/geo';
import { matchesQuery, RouteEntry } from '../../utils/routes';
import { addDays } from '../../utils/time';

export type MapSort = 'distance' | 'time';
export const MAP_SORTS: readonly MapSort[] = ['distance', 'time'];

export interface MapItem {
  code: string;
  city: string;
  lat: number;
  lng: number;
  kind: 'direct' | 'connect';
  /** Great-circle km from the hub. */
  km: number;
  /** Shortest nonstop (or best connection) time in scope, minutes; null when unknown. */
  durationMin: number | null;
  /** Nonstop departures this week (direct), or days with a connection (connect). */
  count: number;
  /** First connecting hub ('YYZ') for connection-only items. */
  via: string | null;
  dots: DotDay[];
  entry: RouteEntry;
}

/** One list item per route entry; connection-only entries only when `withConnections`. */
export function mapItems(entries: readonly RouteEntry[], hub: LatLng, withConnections: boolean): MapItem[] {
  const out: MapItem[] = [];
  for (const e of entries) {
    const d = e.destination;
    const direct = e.isDirect;
    if (!direct && !withConnections) continue;
    let durationMin: number | null = null;
    let count = 0;
    let via: string | null = null;
    if (direct) {
      const flights = e.flights.length ? e.flights : e.weekDays.flatMap(w => w.flights);
      for (const f of flights) if (durationMin === null || f.durationMin < durationMin) durationMin = f.durationMin;
      count = e.weekDays.reduce((n, w) => n + w.flights.length, 0);
    } else {
      const best = [e.itinerary, ...(e.weekSummary?.days.map(x => x.best) ?? [])].filter(x => !!x);
      for (const it of best) if (durationMin === null || it!.totalMin < durationMin) durationMin = it!.totalMin;
      count = e.weekSummary?.connectDays ?? e.daysFlying;
      via = e.itinerary?.hubs[0] ?? e.weekSummary?.hubs[0] ?? null;
    }
    out.push({
      code: d.code,
      city: d.city,
      lat: d.lat,
      lng: d.lng,
      kind: direct ? 'direct' : 'connect',
      km: greatCircleKm(hub, d),
      durationMin,
      count,
      via,
      dots: entryDots(e),
      entry: e,
    });
  }
  return out;
}

/** Accent-insensitive search on city, country, code and region (the same matcher as Home). */
export function filterItems(items: readonly MapItem[], q: string | null | undefined): MapItem[] {
  return q?.trim() ? items.filter(i => matchesQuery(i.entry.destination, q)) : [...items];
}

/**
 * Nonstops first, then connection-only items. Within each group, distance:
 * nearest first; time: shortest first (unknown last). Ties by city.
 */
export function sortItems(items: readonly MapItem[], sort: MapSort): MapItem[] {
  const byCity = (a: MapItem, b: MapItem) => a.city.localeCompare(b.city);
  const group = (i: MapItem) => (i.kind === 'direct' ? 0 : 1);
  const key = (i: MapItem) => (sort === 'time' ? i.durationMin ?? Number.MAX_SAFE_INTEGER : i.km);
  return [...items].sort((a, b) => group(a) - group(b) || key(a) - key(b) || byCity(a, b));
}

/** '5h · 3 this week' (direct) or '9h10 · via YYZ' (connection only). */
export function itemMeta(i: MapItem): string {
  const parts: string[] = [];
  if (i.durationMin !== null) parts.push(hm(i.durationMin));
  if (i.kind === 'direct') parts.push(`${i.count} this week`);
  else parts.push(i.via ? `via ${i.via}` : 'Connections only');
  return parts.join(' · ');
}

/** The `n` items of the same kind nearest to `code` (great-circle), excluding it. */
export function nearestTo(items: readonly MapItem[], code: string | null, n = 2): string[] {
  const c = code ? items.find(i => i.code === code) : null;
  if (!c) return [];
  return items
    .filter(i => i.code !== code && i.kind === c.kind)
    .map(i => ({ code: i.code, d: greatCircleKm(c, i) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(x => x.code);
}

/**
 * Up to `n` same-kind neighbours of `code` to label next to it: nearest
 * first, skipping any closer than a separation (15% of the hub distance,
 * at least 150 km) to the selection or an already-picked one, so labels of
 * near-identical places (LGA beside EWR) do not pile up.
 */
export function labelNeighbours(items: readonly MapItem[], code: string | null, n = 2): string[] {
  const c = code ? items.find(i => i.code === code) : null;
  if (!c) return [];
  const sep = Math.max(150, c.km * 0.15);
  const picked: MapItem[] = [c];
  for (const near of nearestTo(items, code, items.length)) {
    if (picked.length > n) break;
    const it = items.find(i => i.code === near)!;
    if (picked.every(p => greatCircleKm(p, it) >= sep)) picked.push(it);
  }
  return picked.slice(1).map(i => i.code);
}

/**
 * What the overview frames: the nonstops (connections would always zoom out
 * to the whole world), and of those only the nearest three quarters when
 * there are more than eight, so a few long-haul outliers (Sydney, Tokyo) do
 * not shrink the busy part of the map to a speck. Falls back to everything.
 */
export function overviewItems(items: readonly MapItem[]): MapItem[] {
  const direct = items.filter(i => i.kind === 'direct');
  if (!direct.length) return [...items];
  if (direct.length <= 8) return direct;
  return [...direct].sort((a, b) => a.km - b.km).slice(0, Math.ceil(direct.length * 0.75));
}

/** True when nothing in the shown week (or selected day) is published yet. */
export function outsideCoverage(c: Coverage | null, weekStart: string, day: string | null): boolean {
  if (!c || !c.from || !c.to) return false;
  const from = day ?? weekStart;
  const to = day ?? addDays(weekStart, 6);
  return from > c.to || to < c.from;
}

// ---- Framing ------------------------------------------------------------------------------

export type LngLat = readonly [number, number];
export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }

/**
 * The box the map element should occupy so that its centre is the centre of
 * the visible area (`vis`, in page coordinates) while still covering the whole
 * page (`page`). app-route-map zooms and centres about its own middle, so this
 * puts the framed view in the part of the map the list does not cover.
 */
export function mapBox(page: Size, vis: Rect): Rect {
  const cx = vis.x + vis.w / 2;
  const cy = vis.y + vis.h / 2;
  const w = Math.round(2 * Math.max(cx, page.w - cx));
  const h = Math.round(2 * Math.max(cy, page.h - cy));
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
}

/** World scale for a width (Natural Earth's sphere is ~5.5 scale units wide). */
const worldScale = (w: number) => w / 5.5;

/**
 * app-route-map's fitted scale for view="fit" before `zoom` applies; it must
 * mirror RouteMapComponent.projection exactly.
 */
export function fittedScale(hub: LngLat, all: readonly LngLat[], box: Size, padding = 16): number {
  const { w, h } = box;
  if (all.length === 0) return w * 0.9;
  const pad = Math.min(padding, w / 4, h / 4);
  const p = geoNaturalEarth1().fitExtent([[pad, pad], [w - pad, h - pad]], {
    type: 'MultiPoint',
    coordinates: [hub, ...all].map(c => [c[0], c[1]]),
  });
  return Math.min(p.scale(), worldScale(w) * 12);
}

/**
 * `[center]` and `[zoom]` for app-route-map so that the hub and `focus` fit
 * inside the visible size `vis` (with `inset` px to spare for labels), given
 * that the map draws `all` points in a box of size `box`.
 */
export function frameView(
  hub: LngLat, all: readonly LngLat[], focus: readonly LngLat[], box: Size, vis: Size,
  inset: { x: number; y: number } = { x: 64, y: 36 }, padding = 16,
): { center: [number, number]; zoom: number } {
  const s0 = fittedScale(hub, all, box, padding);
  const pts = [hub, ...focus].map(c => [c[0], c[1]] as [number, number]);
  // Labels sit to the right of their dot, so the horizontal inset is larger.
  const fw = Math.max(40, vis.w - 2 * inset.x);
  const fh = Math.max(40, vis.h - 2 * inset.y);
  let center: [number, number] = [hub[0], hub[1]];
  let s1 = worldScale(vis.w) * 3;
  if (pts.length > 1) {
    const mp = { type: 'MultiPoint' as const, coordinates: pts };
    let lng = geoCentroid(mp)[0];
    // Two passes: the fitted centre's longitude becomes the next rotation.
    for (let pass = 0; pass < 2; pass++) {
      const q = geoNaturalEarth1().rotate([-lng, 0]).fitSize([fw, fh], mp);
      s1 = q.scale();
      const c = q.invert!([fw / 2, fh / 2]);
      if (!c) break;
      center = [round(c[0]), round(c[1])];
      lng = c[0];
    }
  }
  // Never closer than ~8× the world view: two nearby airports would fill the screen.
  s1 = Math.min(s1, worldScale(vis.w) * 8);
  const zoom = Math.min(12, Math.max(0.6, s1 / s0));
  return { center, zoom: Math.round(zoom * 1000) / 1000 };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
