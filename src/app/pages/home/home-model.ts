/**
 * Explore page data rules (spec 4.1). Pure functions over RouteEntry and the
 * schedule engine, so every list on Home can be tested without a component.
 */
import { getCoverage, getDestinationCodes } from '../../data/schedule-index';
import type { Coverage } from '../../data/schedule-index';
import type { TimeFormat } from '../../state/prefs.service';
import { findDestination } from '../../utils/airports';
import type { Itinerary } from '../../utils/connections';
import type { RouteEntry } from '../../utils/routes';
import { addDays, diffDays, formatClock, formatKey, hhmmToMin } from '../../utils/time';
import { FlightInstance, coverageHubFor, flightsOn, nextFlightDate } from '../../utils/week';
import { daysLabel, hm, prettyFlight, timeRange } from '../../ui/format';
import type { CityHit } from '../../places/city-index';

// ── Editor's pick ────────────────────────────────────────────────────────────

export interface PickCard {
  code: string;
  city: string;
  region: string;
  /** 'Tonight 21:45', 'Daily', 'Until Nov', or null. */
  badge: string | null;
  /** Mobile badge: 'Tonight', 'Today', 'Daily', 'Mar – Nov'. */
  badgeShort: string | null;
  /** 'Portugal · 6h35 · 6× wk'. */
  meta: string;
  /** '6h35 · 6× wk' (mobile). */
  metaShort: string;
}

export interface PickOptions {
  /** True when the destination has a photo. */
  hasPhoto: (code: string) => boolean;
  /** Today at the hub. */
  todayKey: string;
  /** Departures before this instant no longer count as "today". */
  nowMs?: number;
  timeFormat?: TimeFormat;
  /** At most this many cards (10). */
  limit?: number;
  /** At most this many cards per region (2). */
  perRegion?: number;
  /** Fill with photo-less destinations when fewer than this many have photos (6). */
  minPhotos?: number;
}

/** The next direct departure today at or after `nowMs`, or null. */
export function departsToday(e: RouteEntry, todayKey: string, nowMs = -Infinity): FlightInstance | null {
  return e.flights.find(f => f.dateKey === todayKey && f.depUtc >= nowMs) ?? null;
}

/** 'Nov' from 'Mar – Nov' (the last month of the last run), or null. */
export function seasonEnd(season: string | null | undefined): string | null {
  if (!season) return null;
  const m = /([A-Z][a-z]{2})\s*$/.exec(season);
  return m ? m[1] : null;
}

/**
 * Editor's pick: nonstop destinations with a photo, ranked by "departs today"
 * then days flying then city; at most `perRegion` per region and `limit` cards.
 */
export function editorsPicks(entries: readonly RouteEntry[], opts: PickOptions): PickCard[] {
  const limit = opts.limit ?? 10;
  const perRegion = opts.perRegion ?? 2;
  const minPhotos = opts.minPhotos ?? 6;
  const fmt = opts.timeFormat ?? '24h';
  const direct = entries.filter(e => e.isDirect && e.flights.length);
  const withPhoto = direct.filter(e => opts.hasPhoto(e.destination.code));
  const pool = withPhoto.length >= minPhotos ? withPhoto : [...withPhoto, ...direct.filter(e => !opts.hasPhoto(e.destination.code))];

  const today = new Map(pool.map(e => [e, departsToday(e, opts.todayKey, opts.nowMs)]));
  const ranked = [...pool].sort((a, b) => {
    const ta = today.get(a) ? 0 : 1;
    const tb = today.get(b) ? 0 : 1;
    if (withPhoto.length < minPhotos) {
      const pa = opts.hasPhoto(a.destination.code) ? 0 : 1;
      const pb = opts.hasPhoto(b.destination.code) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    return ta - tb || b.daysFlying - a.daysFlying || a.destination.city.localeCompare(b.destination.city);
  });

  const perRegionCount = new Map<string, number>();
  const out: PickCard[] = [];
  for (const e of ranked) {
    if (out.length >= limit) break;
    const d = e.destination;
    const n = perRegionCount.get(d.region) ?? 0;
    if (n >= perRegion) continue;
    perRegionCount.set(d.region, n + 1);

    const dep = today.get(e) ?? null;
    let badge: string | null = null;
    let badgeShort: string | null = null;
    if (dep) {
      const word = hhmmToMin(dep.depLocal) >= 17 * 60 ? 'Tonight' : 'Today';
      badge = `${word} ${formatClock(dep.depLocal, fmt)}`;
      badgeShort = word;
    } else if (e.daysFlying >= 7) {
      badge = badgeShort = 'Daily';
    } else if (e.season) {
      const end = seasonEnd(e.season);
      badge = end ? `Until ${end}` : e.season;
      badgeShort = e.season;
    }
    const f = e.flights[0];
    const tail = `${hm(f.durationMin)} · ${daysLabel(e.daysFlying)}`;
    out.push({
      code: d.code, city: d.city, region: d.region, badge, badgeShort,
      meta: `${d.country} · ${tail}`, metaShort: tail,
    });
  }
  return out;
}

// ── Nonstop this week ────────────────────────────────────────────────────────

/** Direct entries by days flying (desc), then city. */
export function nonstopByFrequency(entries: readonly RouteEntry[]): RouteEntry[] {
  return entries
    .filter(e => e.isDirect)
    .sort((a, b) => b.daysFlying - a.daysFlying || a.destination.city.localeCompare(b.destination.city));
}

// ── Row meta ─────────────────────────────────────────────────────────────────

/** The best connection in scope: the day's itinerary, else the week's first best. */
export function entryItinerary(e: RouteEntry): Itinerary | null {
  if (e.itinerary) return e.itinerary;
  return e.weekSummary?.days.find(d => d.best)?.best ?? null;
}

/**
 * '18:15 → 07:05⁺¹ · 6h50 · AC874' from the first flight in scope (the
 * selected day, else the first operating day). Short drops the flight number.
 * A connection reads 'via YYZ · 08:00 → 21:40 · 10h40'.
 */
export function rowMeta(e: RouteEntry, fmt: TimeFormat = '24h', short = false): string {
  const f = e.flights[0];
  if (f) {
    const base = `${timeRange(f, fmt)} · ${hm(f.durationMin)}`;
    return short || !f.flightNumber ? base : `${base} · ${prettyFlight(f.flightNumber)}`;
  }
  const it = entryItinerary(e);
  if (!it) return '';
  const span = { depLocal: it.legs[0].depLocal, arrLocal: it.legs[it.legs.length - 1].arrLocal, arrDayOffset: it.arrDayOffset };
  const via = it.hubs.length ? `via ${it.hubs.join(' ')}` : 'Nonstop';
  return short ? `${via} · ${hm(it.totalMin)}` : `${via} · ${timeRange(span, fmt)} · ${hm(it.totalMin)}`;
}

// ── Seasonal & ending soon ───────────────────────────────────────────────────

export type SeasonKind = 'starts' | 'ends' | 'pauses';

export interface SeasonEvent {
  code: string;
  kind: SeasonKind;
  /** First flight (starts) or last flight before the gap (ends, pauses). */
  dateKey: string;
  /** 'Starts Oct 2', 'Ends Oct 22', 'Pauses Oct 10'. */
  label: string;
  /** The next direct departure from today, for the row meta. */
  next: FlightInstance | null;
}

/** A gap of at least this many days after a flight counts as the route ending. */
export const SEASON_GAP_DAYS = 21;
/**
 * A gap longer than this reads "Ends" even when the route resumes later in
 * the window (a summer route back next June has ended for the season).
 */
export const SEASON_PAUSE_MAX_DAYS = 90;
/** "Soon" window for an ending route, and the window a starting route must miss. */
export const SEASON_SOON_DAYS = 7;

const KIND_WORD: Record<SeasonKind, string> = { starts: 'Starts', ends: 'Ends', pauses: 'Pauses' };

/**
 * Routes from `hub` that start, end or pause within `horizon` days of today:
 * - Starts: no flight in the next 7 days, but one within the horizon.
 * - Ends: flies within 7 days, then a gap of ≥ 21 days (known from the
 *   published window) with no flight before the window ends.
 * - Pauses: the same gap, but the route resumes inside the window within
 *   SEASON_PAUSE_MAX_DAYS (a longer gap is a seasonal end: "Ends").
 * Sorted by date, then city.
 */
export function seasonEvents(hub: string, today: string, horizon = 45): SeasonEvent[] {
  const last = addDays(today, horizon);
  const soon = addDays(today, SEASON_SOON_DAYS - 1);
  const out: SeasonEvent[] = [];
  for (const code of getDestinationCodes(hub)) {
    const dest = findDestination(code);
    if (!dest) continue;
    const first = nextFlightDate(hub, code, today);
    if (!first || first > last) continue;
    const next = flightsOn(hub, code, first)[0] ?? null;
    if (first > soon) {
      out.push({ code, kind: 'starts', dateKey: first, label: label('starts', first), next });
      continue;
    }
    const to = getCoverage(coverageHubFor(hub, code)).to;
    let d = first;
    for (let i = 0; i < 400 && d <= last; i++) {
      const n = nextFlightDate(hub, code, d, false);
      if (n && diffDays(d, n) < SEASON_GAP_DAYS) {
        d = n;
        continue;
      }
      // A gap: either a resume inside the window, or nothing more published.
      if (n && diffDays(d, n) <= SEASON_PAUSE_MAX_DAYS) out.push({ code, kind: 'pauses', dateKey: d, label: label('pauses', d), next });
      else if (n || (to && diffDays(d, to) >= SEASON_GAP_DAYS)) out.push({ code, kind: 'ends', dateKey: d, label: label('ends', d), next });
      break;
    }
  }
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey)
    || (findDestination(a.code)?.city ?? a.code).localeCompare(findDestination(b.code)?.city ?? b.code));
}

function label(kind: SeasonKind, key: string): string {
  return `${KIND_WORD[kind]} ${formatKey(key, { month: 'short', day: 'numeric' })}`;
}

/** Meta line for a season row: the next departure, or ''. */
export function seasonMeta(ev: SeasonEvent, fmt: TimeFormat = '24h', short = false): string {
  const f = ev.next;
  if (!f) return '';
  const base = `${timeRange(f, fmt)} · ${hm(f.durationMin)}`;
  return short || !f.flightNumber ? base : `${base} · ${prettyFlight(f.flightNumber)}`;
}

// ── Search by flight number ──────────────────────────────────────────────────

/** 'AC812' for 'ac 812', 'AC812' or '812'; null when the query is not a flight number. */
export function flightNumberQuery(q: string | null | undefined): string | null {
  const m = /^\s*(?:ac\s*)?(\d{1,4})\s*$/i.exec(q ?? '');
  return m ? `AC${Number(m[1])}` : null;
}

function sameFlight(n: string | null | undefined, want: string): boolean {
  return !!n && n.replace(/\s+/g, '').toUpperCase() === want;
}

/** True when a direct flight or a connection leg in scope carries flight `fn`. */
export function entryHasFlight(e: RouteEntry, fn: string): boolean {
  if (e.weekDays.some(d => d.flights.some(f => sameFlight(f.flightNumber, fn) || f.altFlightNumbers?.some(a => sameFlight(a, fn))))) {
    return true;
  }
  const its = e.itineraries ?? (e.weekSummary?.days.flatMap(d => (d.best ? [d.best] : [])) ?? []);
  return its.some(it => it.legs.some(l => sameFlight(l.flightNumber, fn)));
}

/**
 * Results for the list. The engine's text search does not match flight
 * numbers, so for a flight-number query the list is `unsearched` (the same
 * region, filters, favourites and sort, without the text query) narrowed to
 * the engine's matches plus every route that operates that flight. Order and
 * filters therefore stay those of the list.
 */
export function withFlightMatches(routes: readonly RouteEntry[], unsearched: readonly RouteEntry[], q: string): RouteEntry[] {
  const fn = flightNumberQuery(q);
  if (!fn) return [...routes];
  const seen = new Set(routes.map(r => r.destination.code));
  return unsearched.filter(e => seen.has(e.destination.code) || entryHasFlight(e, fn));
}

// ── Coverage ─────────────────────────────────────────────────────────────────

export type CoverageStatus = 'covered' | 'partial' | 'after' | 'before' | 'none';

/** Where the week (or selected day) sits against the hub's published window. */
export function coverageStatus(c: Coverage | null, weekStart: string, day: string | null): CoverageStatus {
  if (!c) return 'covered';
  if (!c.from || !c.to) return 'none';
  const from = day ?? weekStart;
  const to = day ?? addDays(weekStart, 6);
  if (from > c.to) return 'after';
  if (to < c.from) return 'before';
  if (to > c.to || from < c.from) return 'partial';
  return 'covered';
}

/** Selected weekday index (0–6), else today's when it is in the shown week, else null. */
export function focusDayIndex(weekStart: string, day: string | null, today: string): number | null {
  const key = day ?? today;
  const i = diffDays(weekStart, key);
  return i >= 0 && i < 7 ? i : null;
}

// ── Places (cities AC does not fly to; Trips v2 §5.3) ──────────────────────────

/** Explore loads the city index and shows Places from this many characters. */
export const PLACES_MIN_QUERY = 3;

/** One "Places" row: Seville · Spain · Not on AC's network → /reach/gn-2510911?dep=… */
export interface PlaceRow {
  id: string;
  name: string;
  /** 'Spain · Not on AC's network' (or 'Andalusia, Spain · …' when two hits share a name). */
  sub: string;
}

/**
 * City hits that AC does not serve itself, as rows. Hits with `servedBy`
 * are dropped: the AC destination already shows in the results.
 */
export function placeRows(hits: readonly CityHit[], query: string): PlaceRow[] {
  if (query.trim().length < PLACES_MIN_QUERY) return [];
  const rows = hits.filter(h => !h.servedBy);
  const dup = new Set(rows.map(h => h.place.name).filter((n, i, all) => all.indexOf(n) !== i));
  return rows.map(h => {
    const where = dup.has(h.place.name) && h.place.admin1 ? `${h.place.admin1}, ${h.place.country}` : h.place.country;
    return { id: h.place.id, name: h.place.name, sub: `${where || 'Unknown country'} · Not on AC's network` };
  });
}

/** The ?dep= for a Places link: the selected day, else a week from today. */
export function reachDep(selectedDateKey: string | null, todayKey: string): string {
  return selectedDateKey ?? addDays(todayKey, 7);
}
