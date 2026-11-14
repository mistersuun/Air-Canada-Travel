/**
 * Calendar page model: month grids, day counts, the leave/home selection
 * rules and the labels of the round-trip picker (dates-spec §3.1). Counts
 * come from planner/round-trip.ts, so a cell, a List row, the footer peek and
 * /plan always agree. Pure functions over the schedule engine.
 */
import { t } from '../../i18n/t';
import type { Coverage } from '../../data/schedule-index';
import { getDestinationCodes } from '../../data/schedule-index';
import { routeOnlyNoteOn } from '../../data/route-network';
import type { Destination } from '../../data/destinations';
import type { TimeFormat } from '../../state/prefs.service';
import {
  dayCountAria, homeCounts, nightsBetween, outboundsOn, outCounts, pickable,
  type CountCtx, type DayCount,
} from '../../planner/round-trip';
import { dayLabel, isOutside, shortDay, shortRange } from '../../ui/format';
import { findDestination } from '../../utils/airports';
import { matchesQuery } from '../../utils/routes';
import {
  addDays, addMonths, diffDays, formatKey, monthKeys, monthOf, weekStartKey, weekdayIndex, weekdayShort,
} from '../../utils/time';
import { flightsOn, nextFlightDate } from '../../utils/week';

export { pickable };

/** The most months the picker renders (a year of schedules plus slack). */
export const MAX_MONTHS = 15;

/** How far the picker looks ahead for a next flying day. */
export const SCAN_DAYS = 120;

/** Which field the next tap fills. */
export type CalField = 'dep' | 'ret';

/** Which way a grid counts: flights out (hub → destination) or ways home. */
export type CalVariant = 'out' | 'home';

/** What ways-home counts are relative to: the departure day and the earliest a way home may leave. */
export interface HomeBasis {
  dep: string;
  afterUtc: number | null;
}

export interface CalDay {
  key: string;
  /** Day of the month. */
  day: number;
  /** Flights out, or ways home when the grid counts the return (round-trip.ts). */
  count: DayCount;
  /** Before today. */
  past: boolean;
  /** Outside the published window. */
  outside: boolean;
}

/** The shape under a count: solid (has a nonstop), dotted (connections only), none, hatch (not yet published). */
export type DayMarker = 'solid' | 'dotted' | 'none' | 'hatch' | null;

/**
 * The days of month `ym` with their counts: flights out hub → code, or, with
 * `home`, ways home code → hub after the departure lands (days before the
 * departure are 'before-dep').
 */
export function monthDays(
  hub: string,
  code: string,
  ym: string,
  ctx: CountCtx,
  fmt: TimeFormat,
  home: HomeBasis | null = null,
): CalDay[] {
  const keys = monthKeys(ym);
  const counts = home
    ? homeCounts(code, hub, keys, home.dep, ctx, home.afterUtc, fmt)
    : outCounts(hub, code, keys, ctx, fmt);
  return keys.map((key, i) => ({
    key,
    day: Number(key.slice(8)),
    count: counts[i],
    past: key < ctx.today,
    outside: isOutside(key, ctx.coverage),
  }));
}

/** The marker of a day count. */
export function dayMarker(c: DayCount): DayMarker {
  switch (c.state) {
    case 'ok': return c.direct ? 'solid' : 'dotted';
    case 'none': return 'none';
    case 'unpublished': return 'hatch';
    default: return null;
  }
}

/** Line 2 of a cell: the count, '–' for none or not yet published, '·' while loading, nothing for past / before-dep days. */
export function cellCount(c: DayCount): string {
  switch (c.state) {
    case 'ok': return String(c.total);
    case 'none':
    case 'unpublished': return '–';
    case 'loading': return '·';
    default: return '';
  }
}

/** Weekdays (Monday = 0) with a nonstop from → to in month `ym`, counting only days still open to pick. */
export function nonstopWeekdays(from: string, to: string, ym: string, today: string, coverage: Coverage | null): number[] {
  const seen = new Set<number>();
  for (const key of monthKeys(ym)) {
    if (key < today || isOutside(key, coverage)) continue;
    if (flightsOn(from, to, key).length) seen.add(weekdayIndex(key));
  }
  return [...seen].sort((a, b) => a - b);
}

/** 'Nonstops: Tue, Thu, Fri, Sun', or null for a month without nonstops. */
export function nonstopsLine(days: readonly number[]): string | null {
  if (!days.length) return null;
  return t('planner.picker.monthNonstops', { days: days.map(weekdayShort).join(', ') });
}

/**
 * Departure times of a count: '18:05' (one, or several leaving at the same
 * time), '18:05, 22:10' (two), '06:10–22:40' (three or more).
 */
export function timesText(c: DayCount): string {
  if (!c.first) return '';
  if (c.first === c.last) return c.first;
  if (c.total >= 3) return `${c.first}–${c.last}`;
  if (c.total === 2) return `${c.first}, ${c.last}`;
  return c.first;
}

/** '2 nonstop', '4 flights', 'connections only'. */
export function outWhat(c: DayCount): string {
  if (c.total >= 3) return t('planner.flights', { n: c.total });
  if (!c.direct) return t('planner.count.connOnly');
  if (c.direct === c.total) return t('planner.count.nonstop', { n: c.direct });
  return t('planner.flights', { n: c.total });
}

/** '8 nights', or 'Day trip' for a same-day return. */
export function nightsWord(n: number): string {
  return n === 0 ? t('planner.dayTrip') : t('planner.nights', { n });
}

/**
 * A List view row: 'Fri, Nov 20 · 2 nonstop · 18:05, 22:10' (flights out) or
 * '8 nights · Sat, Nov 28 · 3 home · 07:10–13:00' (ways home).
 */
export function listRowText(c: DayCount, variant: CalVariant, today: string): string {
  const date = dayLabel(c.key, today);
  if (variant === 'out') return [date, outWhat(c), timesText(c)].filter(Boolean).join(' · ');
  const nights = c.nights !== undefined ? nightsWord(c.nights) : '';
  return [nights, date, t('planner.count.home', { n: c.total }), timesText(c)].filter(Boolean).join(' · ');
}

/** Footer peek once the departure is set: 'Leave Fri, Nov 20 · 2 flights · 18:05, 22:10'. */
export function peekDep(c: DayCount, today: string): string {
  const summary = [t('planner.flights', { n: c.total }), timesText(c)].filter(Boolean).join(' · ');
  return t('planner.picker.peekDep', { date: dayLabel(c.key, today), summary });
}

/** Footer peek once both are set: 'Home Sat, Nov 28 · 8 nights · 3 ways home · 07:10–13:00'. */
export function peekRet(c: DayCount, dep: string, today: string): string {
  const summary = [t('planner.count.waysHome', { n: c.total }), timesText(c)].filter(Boolean).join(' · ');
  return t('planner.picker.peekRet', { date: dayLabel(c.key, today), nights: nightsWord(nightsBetween(dep, c.key)), summary });
}

/** 'Mar 28, 2027' / '28 mars 2027': the end of the published window. */
export function windowEnd(coverage: Coverage | null): string {
  return coverage?.to ? formatKey(coverage.to, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** A footer message, with an optional day to jump to (the Go button). */
export interface Peek {
  text: string;
  go?: string;
}

/**
 * Why a tapped day can't be picked: 'No flights home on Mon, Nov 23 · next:
 * Tue, Nov 24' (with that day as the Go target), or 'Not yet published ·
 * schedules end Mar 28, 2027'.
 */
export function blockedPeek(
  key: string,
  variant: CalVariant,
  next: string | null,
  today: string,
  coverage: Coverage | null,
): Peek {
  if (isOutside(key, coverage)) return { text: t('planner.picker.unpublishedPeek', { date: windowEnd(coverage) }) };
  const base = t(variant === 'home' ? 'planner.picker.noHome' : 'planner.picker.noOut', { date: dayLabel(key, today) });
  if (!next) return { text: base };
  return { text: `${base} · ${t('planner.next', { date: dayLabel(next, today) })}`, go: next };
}

/** The first day after `start` (up to `last`, at most `max` days on) where `count` is non-zero, else null. */
export function nextDayWith(start: string, count: (key: string) => number, last: string | null, max = SCAN_DAYS): string | null {
  for (let i = 1; i <= max; i++) {
    const k = addDays(start, i);
    if (last && k > last) return null;
    if (count(k) > 0) return k;
  }
  return null;
}

/**
 * The first day with a flight out (hub → code), following the connection
 * setting: the next nonstop, or an earlier connection when they are shown.
 */
export function firstFlightDay(hub: string, code: string, ctx: CountCtx): string | null {
  const from = ctx.coverage?.from && ctx.coverage.from > ctx.today ? ctx.coverage.from : ctx.today;
  const nonstop = nextFlightDate(hub, code, from);
  if (!ctx.showConnections) return nonstop;
  if (outboundsOn(hub, code, from, ctx).length) return from;
  const until = nonstop ? diffDays(from, nonstop) - 1 : SCAN_DAYS;
  const conn = until > 0
    ? nextDayWith(from, k => outboundsOn(hub, code, k, ctx).length, ctx.coverage?.to ?? null, Math.min(until, SCAN_DAYS))
    : null;
  return conn ?? nonstop;
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

export interface CalSelection {
  dep: string | null;
  ret: string | null;
  active: CalField;
}

/**
 * The selection after tapping `key`: the first tap (or any tap on the LEAVE
 * field) sets the departure; the next tap after it sets the return; a tap
 * before the departure restarts with that day as the departure. A tap on the
 * departure itself makes a day trip when `dayTrip` (a way home that day),
 * else restarts.
 */
export function nextSelection(sel: CalSelection, key: string, dayTrip = false): CalSelection {
  if (sel.active === 'dep' || !sel.dep) {
    return { dep: key, ret: sel.ret && sel.ret > key ? sel.ret : null, active: 'ret' };
  }
  if (key === sel.dep && dayTrip) return { dep: key, ret: key, active: 'ret' };
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

/** '7 nights', '1 night', 'Day trip'. */
export function nightsLabel(dep: string, ret: string): string {
  return nightsWord(diffDays(dep, ret));
}

/**
 * The footer button: 'See flights · Nov 20 – 28 · 8 nights', 'See flights ·
 * one way · Fri, Nov 20', or the prompt 'Tap the day you leave'.
 */
export function seeLabel(dep: string | null, ret: string | null, today: string): string {
  if (!dep) return t('planner.picker.btnNone');
  if (!ret) return t('planner.picker.btnOneWay', { date: dayLabel(dep, today) });
  const range = ret === dep ? dayLabel(dep, today) : shortRange(dep, ret, today);
  return t('planner.picker.btnRange', { range, nights: nightsLabel(dep, ret) });
}

/** Screen-reader label for a day cell: 'Saturday, November 28, 2026, 3 ways home, 8 nights'. */
export function dayAria(d: CalDay, variant: CalVariant): string {
  return dayCountAria(d.count, variant);
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
  recent: readonly string[] = [],
): { recent: ChooserRow[]; saved: ChooserRow[]; all: ChooserRow[] } {
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
  // Recently viewed (newest first, not starred, served from this hub): one tap instead of typing.
  const served = new Set(getDestinationCodes(hub));
  const rec = recent
    .filter(c => !fav.has(c) && served.has(c))
    .map(c => findDestination(c))
    .filter(keep)
    .slice(0, RECENT_MAX)
    .map(toRow);
  return { recent: rec, saved, all };
}

/** Recently viewed destinations listed at the top of the chooser. */
export const RECENT_MAX = 5;
