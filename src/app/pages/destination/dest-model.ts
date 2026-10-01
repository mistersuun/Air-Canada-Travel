/**
 * Destination page model: pure functions over the schedule engine, so the
 * page template stays thin and every rule has a spec.
 */
import type { Coverage } from '../../data/schedule-index';
import { isCovered } from '../../data/schedule-index';
import { isRouteOnly, routeFact, routeFactDetail } from '../../data/route-network';
import { aircraftName } from '../../utils/aircraft';
import {
  NO_OPTS, directItineraries, findItineraries, type ConnectOptions, type Itinerary,
} from '../../utils/connections';
import { routeSeason } from '../../utils/season';
import {
  WEEKDAY_SHORT, addDays, addMonths, diffDays, formatClock, formatKey, monthKeys, monthOf, weekKeys, weekdayIndex,
} from '../../utils/time';
import { coverageHubFor, flightsOn, nextFlightDate } from '../../utils/week';
import { monthAvailability } from '../../utils/routes';
import type { TimeFormat } from '../../state/prefs.service';
import { countdown, hm, isOutside, operatesLabel, prettyFlight, weekRangeLabel } from '../../ui/format';

/** How far ahead the timelines look (spec: "up to 21 days ahead"). */
export const HORIZON_DAYS = 21;

// ── Aircraft ────────────────────────────────────────────────────────────────

/** 'Boeing 777-300ER' → '777-300ER', 'Airbus A330-300' → 'A330-300'. */
export function shortAircraft(code: string | null | undefined): string {
  return aircraftName(code).replace(/^(Airbus|Boeing|Bombardier|De Havilland|Embraer)\s+/, '');
}

/** The most frequent value (ties: first seen), or null for an empty list. */
export function mostFrequent<T>(xs: readonly T[]): T | null {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  // Map iterates in first-seen order; a strict > keeps the earliest on a tie.
  for (const [x, c] of n) {
    if (c > bestN) {
      best = x;
      bestN = c;
    }
  }
  return best;
}

// ── Timelines ───────────────────────────────────────────────────────────────

export type TimelineMode = 'direct' | 'via';

export interface TimelineItem {
  it: Itinerary;
  /** 'Today, Oct 1 · in 2h 10m', 'Fri, Oct 2'. */
  dateLabel: string;
  /** '12:45' or '12:45 PM'. */
  time: string;
  /** 'AC5 · arrives 15:25 +1', 'AC300 + AC1 · arrives 15:40 +1'. */
  detail: string;
  /** '777-300ER · 13h40', '1 stop · YYZ · 15h10'. */
  sub: string;
}

/**
 * Itineraries from → to departing at or after `nowMs`, day by day from
 * `startKey` for `horizon` days. 'direct' lists nonstop flights only; 'via'
 * lists one-stop connections only (never through `exclude`).
 */
export function upcoming(
  from: string,
  to: string,
  startKey: string,
  nowMs: number,
  mode: TimelineMode,
  opts: ConnectOptions = NO_OPTS,
  horizon = HORIZON_DAYS,
  max = 40,
): Itinerary[] {
  const out: Itinerary[] = [];
  const hub = coverageHubFor(from, to);
  for (let i = 0; i < horizon && out.length < max; i++) {
    const k = addDays(startKey, i);
    const its = (mode === 'direct'
      ? directItineraries(from, to, k)
      : isCovered(k, hub) ? findItineraries(from, to, k, opts) : []
    ).slice().sort((a, b) => a.departUtc - b.departUtc || a.arriveUtc - b.arriveUtc);
    for (const it of its) {
      if (it.departUtc >= nowMs) out.push(it);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** How far the "next connection" search looks when the timeline is empty. */
export const CONNECTION_SEARCH_DAYS = 120;

/**
 * First date ≥ `fromKey` with a one-stop connection from → to, within the
 * published window and `maxDays`; null when none. Only called when the
 * timelines are empty, so the day-by-day search stays rare.
 */
export function nextConnectionDate(
  from: string,
  to: string,
  fromKey: string,
  opts: ConnectOptions = NO_OPTS,
  maxDays = CONNECTION_SEARCH_DAYS,
): string | null {
  const hub = coverageHubFor(from, to);
  for (let i = 0; i < maxDays; i++) {
    const k = addDays(fromKey, i);
    if (!isCovered(k, hub)) {
      if (i > 0 && isCovered(addDays(k, -1), hub)) return null; // walked off the end of the window
      continue;
    }
    if (findItineraries(from, to, k, opts).length) return k;
  }
  return null;
}

/** 'Today, Oct 1' / 'Fri, Oct 2' (the mockup's date line). */
export function timelineDay(key: string, today: string): string {
  const day = key === today ? 'Today' : WEEKDAY_SHORT[weekdayIndex(key)];
  return `${day}, ${formatKey(key, { month: 'short', day: 'numeric' })}`;
}

/** Flight numbers of an itinerary: 'AC5', 'AC300 + AC1', 'Estimated + AC1'. */
export function itinFlights(it: Itinerary): string {
  return it.legs.map(l => prettyFlight(l.flightNumber) || 'Estimated').join(' + ');
}

/**
 * Timeline rows. The first row gets a countdown when it leaves within a day
 * (`countdownFirst`, the outbound timeline only, as in the mockup).
 */
export function timelineItems(
  its: readonly Itinerary[],
  today: string,
  nowMs: number,
  fmt: TimeFormat = '24h',
  countdownFirst = true,
): TimelineItem[] {
  return its.map((it, i) => {
    const first = it.legs[0];
    const last = it.legs[it.legs.length - 1];
    const soon = countdownFirst && i === 0 && it.departUtc - nowMs < 24 * 3600_000;
    const offset = it.arrDayOffset ? ` ${it.arrDayOffset > 0 ? '+' : '−'}${Math.abs(it.arrDayOffset)}` : '';
    const sub = it.hubs.length
      ? `1 stop · ${it.hubs.join(' ')} · ${hm(it.totalMin)}`
      : [shortAircraft(first.aircraft), hm(it.totalMin)].filter(Boolean).join(' · ');
    return {
      it,
      dateLabel: timelineDay(it.dateKey, today) + (soon ? ` · ${countdown(it.departUtc - nowMs)}` : ''),
      time: formatClock(first.depLocal, fmt),
      detail: `${itinFlights(it)} · arrives ${formatClock(last.arrLocal, fmt)}${offset}`,
      sub,
    };
  });
}

/** The connection hub used most by a list of itineraries ('YYZ'), or null. */
export function bestHub(its: readonly Itinerary[]): string | null {
  return mostFrequent(its.flatMap(it => it.hubs.slice(0, 1)));
}

// ── Header summary ──────────────────────────────────────────────────────────

export interface DestSummary {
  /** A nonstop flight exists this week (or, failing that, within the horizon). */
  direct: boolean;
  /** 'Nonstop · 13h40' or '1 stop · via YYZ' or ''. */
  stops: string;
  /** 'Daily', 'Mon Wed Fri', '' (this week's nonstop days). */
  operates: string;
  /** Nonstop days this week. */
  daysThisWeek: number;
  /** 'Boeing 777-300ER' (most frequent this week). */
  aircraft: string;
  /** '777-300ER'. */
  aircraftShort: string;
  /** 'Year-round' or 'Nov – Apr'. */
  season: string;
  /** Mobile meta: 'Nonstop · 6h35 · 6× this week · A330-300'. */
  meta: string;
}

/**
 * Header facts for hub → dest over the week starting `weekStart`. When the
 * week has no nonstop, `sample` (upcoming itineraries) supplies the duration,
 * aircraft and the connection hub.
 */
export function destSummary(hub: string, dest: string, weekStart: string, sample: readonly Itinerary[]): DestSummary {
  const week = weekKeys(weekStart).map(k => ({ k, flights: flightsOn(hub, dest, k) }));
  const flying = week.filter(d => d.flights.length);
  const weekFlights = flying.flatMap(d => d.flights);
  const directSample = sample.filter(it => !it.hubs.length).map(it => it.legs[0]);
  const flights = weekFlights.length ? weekFlights : directSample;
  const season = routeSeason(hub, dest) ?? 'Year-round';
  if (flights.length) {
    const minDur = Math.min(...flights.map(f => f.durationMin));
    const code = mostFrequent(flights.map(f => f.aircraft).filter((a): a is string => !!a));
    const operates = operatesLabel(flying.map(d => d.k));
    const stops = `Nonstop · ${hm(minDur)}`;
    const days = flying.length;
    return {
      direct: true,
      stops,
      operates,
      daysThisWeek: days,
      aircraft: aircraftName(code),
      aircraftShort: shortAircraft(code),
      season,
      meta: [stops, days ? `${days}× this week` : '', shortAircraft(code)].filter(Boolean).join(' · '),
    };
  }
  const conn = sample.find(it => it.hubs.length);
  if (conn) {
    const code = mostFrequent(conn.legs.map(l => l.aircraft).filter((a): a is string => !!a));
    const stops = `1 stop · via ${conn.hubs[0]}`;
    return {
      direct: false,
      stops,
      operates: '',
      daysThisWeek: 0,
      aircraft: aircraftName(code),
      aircraftShort: shortAircraft(code),
      season,
      meta: [stops, hm(conn.totalMin)].join(' · '),
    };
  }
  return {
    direct: false, stops: '', operates: '', daysThisWeek: 0, aircraft: '', aircraftShort: '', season, meta: '',
  };
}

// ── Page state ──────────────────────────────────────────────────────────────

/** 'Japan · Asia & Pacific'; just 'USA' when the region repeats the country. */
export function placeLabel(country: string, region: string): string {
  return country === region || !region ? country : `${country} · ${region}`;
}

export type DestState =
  | { kind: 'ok' }
  /**
   * The route network lists this route but the schedules have no flight for
   * it: flown, times not in our data. `detail` is 'Air Canada Express · Seasonal'.
   */
  | { kind: 'route-only'; detail: string; connections: boolean }
  /** The whole week is beyond the published window. */
  | { kind: 'outside'; week: string }
  /** No nonstop this week; `next` is the next nonstop date (or null). */
  | { kind: 'no-nonstop'; next: string | null; nextLabel: string | null; connections: boolean }
  /** No flight at all from this hub within the published window. */
  | { kind: 'not-served' };

/**
 * Which notice the page shows for hub → dest and the week starting
 * `weekStart`. `hasConnections` says whether any connection exists ahead.
 */
export function destState(
  hub: string,
  dest: string,
  weekStart: string,
  today: string,
  coverage: Coverage | null,
  hasConnections: boolean,
): DestState {
  // Checked first: the schedules will never have times for it, whatever the week.
  if (isRouteOnly(hub, dest)) {
    return { kind: 'route-only', detail: routeFactDetail(routeFact(hub, dest)), connections: hasConnections };
  }
  const days = weekKeys(weekStart);
  if (days.every(k => isOutside(k, coverage))) return { kind: 'outside', week: weekRangeLabel(weekStart) };
  if (days.some(k => flightsOn(hub, dest, k).length)) return { kind: 'ok' };
  const from = today > weekStart ? today : weekStart;
  const next = nextFlightDate(hub, dest, from) ?? nextFlightDate(hub, dest, today);
  if (!next && !hasConnections) return { kind: 'not-served' };
  return {
    kind: 'no-nonstop',
    next,
    nextLabel: next ? formatKey(next, { weekday: 'short', month: 'short', day: 'numeric' }) : null,
    connections: hasConnections,
  };
}

// ── Next departure (header) ─────────────────────────────────────────────────

export interface NextDeparture {
  it: Itinerary;
  /** 'Today · 12:45', 'Tomorrow · 12:45', 'Thu, Oct 8 · 12:45'. */
  when: string;
  /** 'AC5 · arrives Fri 15:25 local'. */
  detail: string;
}

export function nextDeparture(it: Itinerary | null | undefined, today: string, fmt: TimeFormat = '24h'): NextDeparture | null {
  if (!it) return null;
  const d = diffDays(today, it.dateKey);
  const day = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : formatKey(it.dateKey, { weekday: 'short', month: 'short', day: 'numeric' });
  const last = it.legs[it.legs.length - 1];
  const arrDay = WEEKDAY_SHORT[weekdayIndex(it.arrDateKey)];
  return {
    it,
    when: `${day} · ${formatClock(it.legs[0].depLocal, fmt)}`,
    detail: `${itinFlights(it)} · arrives ${arrDay} ${formatClock(last.arrLocal, fmt)} local`,
  };
}

// ── Month availability ──────────────────────────────────────────────────────

export interface AvailCell {
  dateKey: string;
  day: number;
  /** Number of nonstop departures. */
  direct: number;
  /** Connection only (no nonstop) that day. */
  connect: boolean;
  /** Past, or outside the published window. */
  off: boolean;
  /** Teal bar fill, 0–100 (n/3 of the bar per departure, as on the calendar page). */
  fill: number;
  /** 'Thu, Oct 8: 2 nonstop departures'. */
  label: string;
}

export interface AvailMonth {
  /** 'YYYY-MM'. */
  ym: string;
  /** 'October 2026'. */
  title: string;
  /** Monday-first: blank cells before the 1st. */
  lead: number;
  cells: AvailCell[];
  /** True when no day of the month is published. */
  unpublished: boolean;
}

/** One month of hub → dest availability (connections only when `withConnections`). */
export function availMonth(
  hub: string,
  dest: string,
  ym: string,
  today: string,
  withConnections: boolean,
  opts: ConnectOptions = NO_OPTS,
): AvailMonth {
  const keys = monthKeys(ym);
  // Connections are the expensive part: only look them up when shown.
  const days = withConnections
    ? monthAvailability(hub, dest, ym, opts)
    : keys.map(k => ({ dateKey: k, direct: flightsOn(hub, dest, k).length, connect: false, covered: isCovered(k, coverageHubFor(hub, dest)) }));
  const cells = days.map(a => {
    const off = a.dateKey < today || !a.covered;
    const connect = !a.direct && a.connect && !off;
    const day = formatKey(a.dateKey, { weekday: 'short', month: 'short', day: 'numeric' });
    const what = !a.covered ? 'not yet published'
      : a.direct ? `${a.direct} nonstop departure${a.direct > 1 ? 's' : ''}`
      : connect ? 'connection only'
      : 'no flights';
    return {
      dateKey: a.dateKey,
      day: Number(a.dateKey.slice(8)),
      direct: off ? 0 : a.direct,
      connect,
      off,
      fill: off ? 0 : Math.min(100, Math.round((a.direct / 3) * 100)),
      label: `${day}: ${what}`,
    };
  });
  return {
    ym,
    title: formatKey(`${ym}-01`, { month: 'long', year: 'numeric' }),
    lead: weekdayIndex(`${ym}-01`),
    cells,
    unpublished: days.every(d => !d.covered),
  };
}

/** Month bounds for the availability card: today's month to the coverage end month. */
export function monthRange(today: string, coverage: Coverage | null): { first: string; last: string } {
  const first = monthOf(today);
  const last = coverage?.to ? monthOf(coverage.to) : addMonths(first, 2);
  return { first, last: last < first ? first : last };
}

// ── Essentials ──────────────────────────────────────────────────────────────

/** Fallback abbreviations where Intl only gives 'GMT+9'. */
const TZ_ABBR: Readonly<Record<string, string>> = {
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Shanghai': 'CST',
  'Asia/Hong_Kong': 'HKT',
  'Asia/Singapore': 'SGT',
  'Asia/Bangkok': 'ICT',
  'Asia/Manila': 'PHT',
  'Asia/Dubai': 'GST',
  'America/Sao_Paulo': 'BRT',
  'America/Bogota': 'COT',
  'America/Lima': 'PET',
  'America/Santiago': 'CLT',
  'America/Guayaquil': 'ECT',
};

/** 'JST', 'WEST', 'CEST', 'EST': the zone's short name, trying the country's own English locale first. */
export function zoneAbbr(tz: string, iso2: string, nowMs: number): string {
  const read = (locale: string): string => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date(nowMs))
        .find(p => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  };
  const named = [`en-${iso2}`, 'en-GB', 'en-US'].map(read).find(v => v && !/^(GMT|UTC)/.test(v));
  return named ?? TZ_ABBR[tz] ?? read('en-US');
}
