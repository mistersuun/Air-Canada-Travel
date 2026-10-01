/**
 * Calendar page model: month grids, availability per day, the depart/return
 * selection rules and the labels. Pure functions over the schedule engine.
 */
import type { Coverage } from '../../data/schedule-index';
import { getDestinationCodes } from '../../data/schedule-index';
import { ROUTE_ONLY_NOTE, isRouteOnly } from '../../data/route-network';
import type { Destination } from '../../data/destinations';
import { isOutside, shortDay } from '../../ui/format';
import { findDestination } from '../../utils/airports';
import { NO_OPTS, bestItinerary, type ConnectOptions } from '../../utils/connections';
import { matchesQuery } from '../../utils/routes';
import {
  WEEKDAY_LONG, addDays, addMonths, diffDays, formatKey, isDateKey, monthKeys, monthOf, weekStartKey, weekdayIndex,
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
  const a = formatKey(dep, { month: 'short', day: 'numeric' });
  const b = monthOf(dep) === monthOf(ret)
    ? formatKey(ret, { day: 'numeric' })
    : formatKey(ret, { month: 'short', day: 'numeric' });
  return `${a} – ${b}`;
}

/** '7 nights', '1 night'. */
export function nightsLabel(dep: string, ret: string): string {
  const n = diffDays(dep, ret);
  return `${n} night${n === 1 ? '' : 's'}`;
}

/** The footer button: 'Select Oct 8 – 15 · 7 nights', 'Select Thu, Oct 8 · one way', or a prompt. */
export function selectLabel(dep: string | null, ret: string | null): string {
  if (!dep) return 'Select a departure date';
  if (!ret) return `Select ${shortDay(dep)} · one way`;
  return `Select ${rangeLabel(dep, ret)} · ${nightsLabel(dep, ret)}`;
}

/** Screen-reader label for a day cell. */
export function dayAria(d: CalDay, field: CalField): string {
  const date = `${WEEKDAY_LONG[weekdayIndex(d.key)]}, ${formatKey(d.key, { month: 'long', day: 'numeric' })}`;
  let what: string;
  if (d.past) what = 'past';
  else if (d.outside) what = 'not yet published';
  else if (d.direct) what = `${d.direct} ${field === 'ret' ? 'return ' : ''}departure${d.direct === 1 ? '' : 's'}`;
  else if (d.connect) what = 'connection only';
  else what = 'no nonstop';
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
  if (next) return `${d.country} · next ${shortDay(next)}`;
  if (isRouteOnly(hub, d.code)) return `${d.country} · ${ROUTE_ONLY_NOTE}`;
  return `${d.country} · no nonstop published`;
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
