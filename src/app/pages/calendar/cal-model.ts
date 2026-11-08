/**
 * Calendar page model: month grids, availability per day, the depart/return
 * selection rules and the labels. Pure functions over the schedule engine.
 */
import { t } from '../../i18n/t';
import type { Coverage } from '../../data/schedule-index';
import { getDestinationCodes } from '../../data/schedule-index';
import { routeOnlyNoteOn } from '../../data/route-network';
import type { Destination } from '../../data/destinations';
import { isOutside, longDay, shortDay } from '../../ui/format';
import { findDestination } from '../../utils/airports';
import {
  NO_OPTS, bestItinerary, directItineraries, findItineraries, type ConnectOptions,
} from '../../utils/connections';
import { matchesQuery } from '../../utils/routes';
import {
  addDays, addMonths, diffDays, formatKey, isDateKey, monthKeys, monthOf, weekStartKey, weekdayIndex, weekdayShort,
} from '../../utils/time';
import { flightsOn, nextFlightDate } from '../../utils/week';

/** The most months the picker renders (a year of schedules plus slack). */
export const MAX_MONTHS = 15;

/** Which field the next tap fills. */
export type CalField = 'dep' | 'ret';

export interface CalDay {
  key: string;
  /** Day of the month. */
  day: number;
  /** Nonstop departures that day (0 when past or unpublished). */
  direct: number;
  /** No nonstop, but a one-stop connection exists (only when connections are shown). */
  connect: boolean;
  /** Before today. */
  past: boolean;
  /** Outside the published window. */
  outside: boolean;
  /** Flights on this day in the direction shown, once a departure is picked and this is the return field. */
  ways?: Ways;
}

/** Flights on one day in one direction: nonstops, and one-stop itineraries when connections are shown. */
export interface Ways { direct: number; connecting: number; total: number }

/** The nights shortcuts offered once a departure is picked. */
export const NIGHT_SHORTCUTS: readonly number[] = [2, 3, 4, 7];

/** Nonstop (and, when `withConnections`, connecting) itineraries from → to on `key`; zeros for a past or unpublished day. */
export function waysOn(
  from: string,
  to: string,
  key: string,
  today: string,
  coverage: Coverage | null,
  withConnections: boolean,
  connect: ConnectOptions = NO_OPTS,
): Ways {
  if (key < today || isOutside(key, coverage)) return { direct: 0, connecting: 0, total: 0 };
  const direct = directItineraries(from, to, key).length;
  const connecting = withConnections ? findItineraries(from, to, key, connect).filter(it => it.legs.length > 1).length : 0;
  return { direct, connecting, total: direct + connecting };
}

/** The days of month `ym` with their ways home (code → hub) for days after `dep`; earlier days carry none. */
export function withWays(
  days: readonly CalDay[],
  dep: string,
  code: string,
  hub: string,
  today: string,
  coverage: Coverage | null,
  withConnections: boolean,
  connect: ConnectOptions = NO_OPTS,
): CalDay[] {
  return days.map(d => (d.key > dep ? { ...d, ways: waysOn(code, hub, d.key, today, coverage, withConnections, connect) } : d));
}

export interface NightShortcut { nights: number; key: string; ways: Ways }

/**
 * '2 / 3 / 4 / 7 nights' return shortcuts for a picked departure: the return day
 * (dep + n) and its ways home, only for days that can be picked.
 */
export function nightShortcuts(
  dep: string,
  code: string,
  hub: string,
  today: string,
  coverage: Coverage | null,
  withConnections: boolean,
  connect: ConnectOptions = NO_OPTS,
): NightShortcut[] {
  return NIGHT_SHORTCUTS
    .map(nights => ({ nights, key: addDays(dep, nights) }))
    .filter(n => pickable(n.key, today, coverage))
    .map(n => ({ ...n, ways: waysOn(code, hub, n.key, today, coverage, withConnections, connect) }));
}

/** '3 ways home', '1 way home', '0 ways home'; with connections on and some needing one: '2 nonstop · 1 with a connection'. */
export function waysLabel(w: Ways): string {
  if (w.connecting) return t('calendar.ways.split', { direct: w.direct, connecting: w.connecting });
  return t('calendar.ways', { n: w.total });
}

/** Nonstop departures per weekday (Monday first) in month `ym`, counting only days still open to pick. */
export function weekdayCounts(
  from: string,
  to: string,
  ym: string,
  today: string,
  coverage: Coverage | null,
): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const key of monthKeys(ym)) {
    if (key < today || isOutside(key, coverage)) continue;
    out[weekdayIndex(key)] += flightsOn(from, to, key).length;
  }
  return out;
}

/** 'Nonstops by weekday in October: Mon 1 · Tue 0 · …', or null when the month has none. */
export function weekdayLine(counts: readonly number[], ym: string): string | null {
  if (!counts.some(n => n > 0)) return null;
  const month = formatKey(`${ym}-01`, { month: 'long' });
  const list = counts.map((n, i) => `${weekdayShort(i)} ${n}`).join(' · ');
  return t('calendar.weekdays', { month, list });
}

/** Availability for every day of month `ym`, from → to. */
export function monthDays(
  from: string,
  to: string,
  ym: string,
  today: string,
  coverage: Coverage | null,
  withConnections: boolean,
  connect: ConnectOptions = NO_OPTS,
): CalDay[] {
  return monthKeys(ym).map(key => {
    const past = key < today;
    const outside = isOutside(key, coverage);
    const live = !past && !outside;
    const direct = live ? flightsOn(from, to, key).length : 0;
    return {
      key,
      day: Number(key.slice(8)),
      direct,
      connect: live && !direct && withConnections && bestItinerary(from, to, key, connect) !== null,
      past,
      outside,
    };
  });
}

/** Empty cells before the 1st (Monday-first, like the engine). */
export function monthLead(ym: string): number {
  return weekdayIndex(`${ym}-01`);
}

/** Calendar rows of 7 cells (null = padding) for month `ym`. */
export function monthWeeks<T extends { key: string }>(ym: string, days: readonly T[]): (T | null)[][] {
  const cells: (T | null)[] = [...Array(monthLead(ym)).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const rows: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** Months from today's to the end of the published window (at least one, at most MAX_MONTHS). */
export function monthRange(today: string, coverage: Coverage | null): string[] {
  const first = monthOf(today);
  const last = coverage?.to && coverage.to >= today ? monthOf(coverage.to) : first;
  const out: string[] = [];
  for (let m = first; m <= last && out.length < MAX_MONTHS; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** 'October 2026'. */
export function monthTitle(ym: string): string {
  return formatKey(`${ym}-01`, { month: 'long', year: 'numeric' });
}

/** Availability bar fill, in percent: three or more departures fill it. */
export function barWidth(n: number): number {
  return Math.min(100, (n / 3) * 100);
}

/** A date key that can be picked: valid, not past, inside the window. */
export function pickable(key: string | null | undefined, today: string, coverage: Coverage | null): key is string {
  return isDateKey(key) && key >= today && !isOutside(key, coverage);
}

export interface CalSelection {
  dep: string | null;
  ret: string | null;
  active: CalField;
}

/**
 * The selection after tapping `key`: the first tap (or any tap on the DEPART
 * field) sets the departure; the next tap after it sets the return; a tap on
 * or before the departure restarts with that day as the departure.
 */
export function nextSelection(sel: CalSelection, key: string): CalSelection {
  if (sel.active === 'dep' || !sel.dep) {
    return { dep: key, ret: sel.ret && sel.ret > key ? sel.ret : null, active: 'ret' };
  }
  if (key <= sel.dep) return { dep: key, ret: null, active: 'ret' };
  return { dep: sel.dep, ret: key, active: 'ret' };
}

/** 'Oct 8 – 15', 'Oct 28 – Nov 4'. */
export function rangeLabel(dep: string, ret: string): string {
  const md = { month: 'short', day: 'numeric' } as const;
  const parts = {
    start: formatKey(dep, md),
    end: formatKey(ret, md),
    startDay: formatKey(dep, { day: 'numeric' }),
    endDay: formatKey(ret, { day: 'numeric' }),
  };
  return t(monthOf(dep) === monthOf(ret) ? 'format.range.sameMonth' : 'format.range.twoMonths', parts);
}

/** '7 nights', '1 night'. */
export function nightsLabel(dep: string, ret: string): string {
  const n = diffDays(dep, ret);
  return t('flight.nights', { n });
}

/** The footer button: 'Select Oct 8 – 15 · 7 nights', 'Select Thu, Oct 8 · one way', or a prompt. */
export function selectLabel(dep: string | null, ret: string | null): string {
  if (!dep) return t('calendar.select.none');
  if (!ret) return t('calendar.select.oneWay', { date: shortDay(dep) });
  return t('calendar.select.range', { range: rangeLabel(dep, ret), nights: nightsLabel(dep, ret) });
}

/** Screen-reader label for a day cell. */
export function dayAria(d: CalDay, field: CalField): string {
  const date = longDay(d.key);
  let what: string;
  if (d.past) what = t('calendar.aria.past');
  else if (d.outside) what = t('dest.avail.unpublished');
  else if (field === 'ret' && d.ways) what = d.ways.connecting
    ? t('calendar.aria.waysSplit', { direct: d.ways.direct, connecting: d.ways.connecting })
    : t('calendar.aria.ways', { n: d.ways.total });
  else if (d.direct) what = t(field === 'ret' ? 'calendar.aria.ret' : 'calendar.aria.dep', { n: d.direct });
  else if (d.connect) what = t('dest.avail.connOnly');
  else what = t('calendar.aria.none');
  return `${date}, ${what}`;
}

/**
 * Grid keyboard: arrows move by day / week, PageUp/PageDown by month (same
 * day, clamped to the month's length), Home/End to the week's ends. Null for
 * any other key.
 */
export function moveKey(key: string, k: string): string | null {
  switch (k) {
    case 'ArrowLeft': return addDays(key, -1);
    case 'ArrowRight': return addDays(key, 1);
    case 'ArrowUp': return addDays(key, -7);
    case 'ArrowDown': return addDays(key, 7);
    case 'Home': return weekStartKey(key);
    case 'End': return addDays(weekStartKey(key), 6);
    case 'PageUp':
    case 'PageDown': {
      const ym = addMonths(monthOf(key), k === 'PageUp' ? -1 : 1);
      const len = monthKeys(ym).length;
      return `${ym}-${String(Math.min(Number(key.slice(8)), len)).padStart(2, '0')}`;
    }
    default: return null;
  }
}

/** `key` clamped to [min, max]. */
export function clampKey(key: string, min: string, max: string): string {
  return key < min ? min : key > max ? max : key;
}

// ── Chooser ─────────────────────────────────────────────────────────────────

export interface ChooserRow {
  code: string;
  city: string;
  meta: string;
}

/**
 * 'Portugal · next Thu, Oct 8', 'USA · flies this route · times not in our data'
 * (route network only), or 'Portugal · no nonstop published'.
 */
export function chooserMeta(hub: string, d: Destination, today: string): string {
  const next = nextFlightDate(hub, d.code, today);
  if (next) return t('calendar.meta.next', { country: d.country, date: shortDay(next) });
  const routeNote = routeOnlyNoteOn(hub, d.code, today);
  if (routeNote) return `${d.country} · ${routeNote}`;
  return t('calendar.meta.none', { country: d.country });
}

/** Favourites first, then every destination with a published nonstop from the hub, filtered by `query`. */
export function chooserRows(
  hub: string,
  favourites: readonly string[],
  today: string,
  query: string,
): { saved: ChooserRow[]; all: ChooserRow[] } {
  const fav = new Set(favourites);
  const toRow = (d: Destination): ChooserRow => ({ code: d.code, city: d.city, meta: chooserMeta(hub, d, today) });
  const q = query.trim();
  const keep = (d: Destination | null): d is Destination => !!d && d.code !== hub && (!q || matchesQuery(d, q));
  const byCity = (a: Destination, b: Destination) => a.city.localeCompare(b.city);
  const saved = favourites.map(c => findDestination(c)).filter(keep).sort(byCity).map(toRow);
  const all = getDestinationCodes(hub)
    .filter(c => !fav.has(c))
    .map(c => findDestination(c))
    .filter(keep)
    .sort(byCity)
    .map(toRow);
  return { saved, all };
}
