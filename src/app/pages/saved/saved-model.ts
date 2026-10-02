/**
 * Saved page model: pure functions over the schedule engine, so the page
 * template stays thin and every rule has a spec.
 *
 * Upcoming: each favourite's next nonstop departure from now, within the
 * published window, sorted by departure. Favourites with no nonstop in the
 * window come after, with "Via YYZ" (a connection exists this week) or
 * "No flights published".
 * Watching: every favourite with this week's dots.
 */
import type { Coverage } from '../../data/schedule-index';
import { getSchedulesForRoute } from '../../data/schedule-index';
import { routeOnlyNoteOn } from '../../data/route-network';
import type { StarredItem } from '../../state/app-state.service';
import type { TimeFormat } from '../../state/prefs.service';
import type { DotDay } from '../../ui/dot-row.component';
import { daysLabel, hm, isOutside, prettyFlight, relativeCountdown, relativeDay, timeRange } from '../../ui/format';
import { findDestination } from '../../utils/airports';
import { NO_OPTS, bestItinerary, type ConnectOptions } from '../../utils/connections';
import { routeSeason } from '../../utils/season';
import { addDays, formatClock, formatKey, weekKeys, weekStartKey } from '../../utils/time';
import { countFlyingDays, flightsOn, nextFlightDate, type FlightInstance } from '../../utils/week';

/** A favourite with a nonstop departure coming up. */
export interface UpcomingItem {
  code: string;
  city: string;
  country: string;
  flight: FlightInstance;
  /** 'Today · 08:40', 'Tomorrow · 08:40', 'In 2 days · Sat'. */
  badge: string;
  /** Days with a nonstop in the departure's week (1–7). */
  weekDays: number;
  /** True when the departure falls in the current week. */
  thisWeek: boolean;
  /** 'Oct 22' when the route stops before the published window ends, else null. */
  endsOn: string | null;
  /** 'Year-round' or the route's months ('Nov – Apr'). */
  season: string;
}

/** A favourite with no nonstop departure in the published window. */
export interface NoNonstopItem {
  code: string;
  city: string;
  country: string;
  /** First connecting hub found this week ('YYZ'), or null when nothing flies. */
  via: string | null;
  /** Set when the route network lists the route (not ended) but the schedules have no times for it. */
  routeOnly?: true;
  /** With routeOnly: the route-network note for today ('flies this route · times not in our data', 'route starts Jun 16, 2027'). */
  routeNote?: string;
}

/** routeOnly + routeNote for a favourite the route network lists (as of today), else nothing. */
function routeNoteField(hub: string, code: string, today: string): { routeOnly?: true; routeNote?: string } {
  const note = routeOnlyNoteOn(hub, code, today);
  return note ? { routeOnly: true, routeNote: note } : {};
}

/**
 * The next nonstop hub → code departing after `now` (today's flights that
 * already left are skipped), bounded by the published window.
 */
export function nextDeparture(hub: string, code: string, today: string, now: number): FlightInstance | null {
  let key = nextFlightDate(hub, code, today);
  for (let i = 0; key && i < 4; i++) {
    const f = flightsOn(hub, code, key).find(x => x.depUtc > now);
    if (f) return f;
    key = nextFlightDate(hub, code, key, false);
  }
  return null;
}

/** 'Oct 22' when the last published nonstop record ends before the window does, else null. */
export function routeEndsOn(hub: string, code: string, today: string, coverageTo: string | null): string | null {
  let last: string | null = null;
  for (const r of getSchedulesForRoute(hub, code)) if (!last || r.toDate > last) last = r.toDate;
  if (!last || !coverageTo || last >= coverageTo || last < today) return null;
  return formatKey(last, { month: 'short', day: 'numeric' });
}

/** Upcoming departures for the favourites (sorted by departure) and the favourites without one. */
export function upcoming(
  hub: string,
  favourites: readonly string[],
  today: string,
  now: number,
  coverage: Coverage,
  fmt: TimeFormat = '24h',
  connect: ConnectOptions = NO_OPTS,
): { items: UpcomingItem[]; rest: NoNonstopItem[] } {
  const items: UpcomingItem[] = [];
  const rest: NoNonstopItem[] = [];
  const thisWeek = weekStartKey(today);
  for (const code of favourites) {
    const d = findDestination(code);
    if (!d) continue;
    const f = nextDeparture(hub, code, today, now);
    if (!f) {
      rest.push({
        code, city: d.city, country: d.country, via: viaHub(hub, code, today, connect),
        ...routeNoteField(hub, code, today),
      });
      continue;
    }
    const week = weekStartKey(f.dateKey);
    items.push({
      code,
      city: d.city,
      country: d.country,
      flight: f,
      badge: relativeCountdown(f.depUtc, now, f.dateKey, today, formatClock(f.depLocal, fmt)),
      weekDays: countFlyingDays(hub, code, week, addDays(week, 6)),
      thisWeek: week === thisWeek,
      endsOn: routeEndsOn(hub, code, today, coverage.to),
      season: routeSeason(hub, code) ?? 'Year-round',
    });
  }
  items.sort((a, b) => a.flight.depUtc - b.flight.depUtc || a.city.localeCompare(b.city));
  rest.sort((a, b) => a.city.localeCompare(b.city));
  return { items, rest };
}

/** The first connecting hub on any of the next 7 days, or null. */
export function viaHub(hub: string, code: string, today: string, connect: ConnectOptions = NO_OPTS): string | null {
  for (let i = 0; i < 7; i++) {
    const it = bestItinerary(hub, code, addDays(today, i), connect);
    if (it?.hubs.length) return it.hubs[0];
  }
  return null;
}

/** 'Mexico · AC1882 · 4h30' (first card). */
export function heroMeta(u: UpcomingItem): string {
  return [u.country, prettyFlight(u.flight.flightNumber), hm(u.flight.durationMin)].filter(Boolean).join(' · ');
}

/** 'AC912 · 3× this week · ends Oct 22' (second card). */
export function cardMeta(u: UpcomingItem): string {
  const freq = u.weekDays >= 7 ? 'Daily' : u.thisWeek ? `${u.weekDays}× this week` : `${u.weekDays}× that week`;
  return [prettyFlight(u.flight.flightNumber), freq, u.endsOn ? `ends ${u.endsOn}` : '']
    .filter(Boolean).join(' · ');
}

/** 'Daily' / '3× wk' for the first card's footer. */
export function footerDays(u: UpcomingItem): string {
  return daysLabel(u.weekDays);
}

/** Row meta: '21:45 → 09:20⁺¹ · 6h35' today, else 'Tomorrow · 22:20 · 14h10' / 'Sun, Oct 25 · 22:20 · 14h10'. */
export function rowMeta(u: UpcomingItem, today: string, fmt: TimeFormat = '24h'): string {
  const f = u.flight;
  if (f.dateKey <= today) return `${timeRange(f, fmt)} · ${hm(f.durationMin)}`;
  return `${relativeDay(f.dateKey, today)} · ${formatClock(f.depLocal, fmt)} · ${hm(f.durationMin)}`;
}

/** This week's dots for a starred item: teal nonstop days, amber connection days, rings outside the window. */
export function starredDots(item: Pick<StarredItem, 'dayKeys' | 'direct'>, week: string, coverage: Coverage | null): DotDay[] {
  const on = new Set(item.dayKeys);
  return weekKeys(week).map(k => {
    if (isOutside(k, coverage)) return 'outside';
    if (on.has(k)) return item.direct ? 'on' : 'connect';
    return 'off';
  });
}

/** Dots from direct flights only (rows without a route entry this week). */
export function directDots(hub: string, code: string, week: string, coverage: Coverage | null): DotDay[] {
  return weekKeys(week).map(k => {
    if (isOutside(k, coverage)) return 'outside';
    return flightsOn(hub, code, k).length ? 'on' : 'off';
  });
}

/** Watching meta: 'Tue Thu Sat', 'Daily', 'Connections only' (the amber dots say which days), 'No flights this week'. */
export function watchingMeta(item: Pick<StarredItem, 'dayKeys' | 'days' | 'direct'>): string {
  if (!item.dayKeys.length) return 'No flights this week';
  const days = item.dayKeys.length === 7 ? 'Daily' : item.days;
  return item.direct ? days : 'Connections only';
}

