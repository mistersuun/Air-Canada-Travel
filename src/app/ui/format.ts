/**
 * Display formatting shared by every page. Pure functions only.
 *
 * Copied from the retired flight modal (modal-model.ts) and week strip, plus
 * the compact formats of the Clear Sky design ('6h35', '18:15 → 07:05⁺¹').
 * Words and dates follow the UI language (docs/i18n.md): French gives
 * '6 h 35', 'mer. 7 oct.', 'Tous les jours'.
 */
import type { Coverage } from '../data/schedule-index';
import { HUBS } from '../data/destinations';
import type { Itinerary } from '../utils/connections';
import type { TimeFormat } from '../state/prefs.service';
import {
  addDays, diffDays, formatClock, formatKey, overriddenZoneLabel, tzOffsetMin, utcToLocal, weekdayIndex, weekdayShort,
} from '../utils/time';
import { formatWeekLabel, weekRangeInYear } from '../utils/week';
import { t } from '../i18n/t';

// ── From the flight modal ────────────────────────────────────────────────────

/** Stable identity for an itinerary (tracking, expansion state, DOM ids). */
export function itinKey(it: Itinerary): string {
  return it.legs.map(l => `${l.flightNumber ?? 'EST'}${l.origin}${l.dest}${l.depUtc}`).join('_');
}

/** 'Wed, Oct 7'. */
export function shortDay(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** 'Wednesday, October 7' / 'mercredi 7 octobre'. */
export function longDay(key: string): string {
  return formatKey(key, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** True when the date is outside the hub's published window (null bounds = open). */
export function isOutside(key: string, coverage: Coverage | null | undefined): boolean {
  if (!coverage) return false;
  return (!!coverage.from && key < coverage.from) || (!!coverage.to && key > coverage.to);
}

/**
 * Flight number for display, as the design sets it: 'AC812' (no space). Data
 * with a space ('AC 812') is normalised; null (an estimated leg) gives ''.
 */
export function prettyFlight(n: string | null | undefined): string {
  return n ? n.replace(/^([A-Z0-9]{2})\s+(\d)/, '$1$2') : '';
}

/** '3d 22h', '22h', '45m' ('3 j 22 h', '45 min'): time on the ground at the destination. */
export function formatStay(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d) return h ? t('format.dur.dh', { d, h }) : t('format.dur.d', { d });
  if (h) return t('format.dur.h', { h });
  return t('format.dur.m', { m: min % 60 });
}

/** 'Daily', 'Mon Wed Fri' or '' from the date keys that have a flight. */
export function operatesLabel(keys: readonly string[]): string {
  const idx = [...new Set(keys.map(weekdayIndex))].sort((a, b) => a - b);
  if (idx.length === 7) return t('format.daily');
  return idx.map(weekdayShort).join(' ');
}

// ── From the week strip ──────────────────────────────────────────────────────

/** Schedules scraped more than this many days ago are flagged. */
export const STALE_AFTER_DAYS = 45;

/**
 * Schedules whose last published date is fewer than this many days away are
 * flagged. Age since the scrape is no signal (it only moves when the data
 * does); running out of published dates is.
 */
export const STALE_COVERAGE_DAYS = 21;

/**
 * 'Sep 28 – Oct 4' / '28 sept. – 4 oct.' within a year, 'Oct 1 – 7' /
 * '1–7 oct.' within a month; 'Dec 28, 2026 – Jan 3, 2027' across years.
 */
export function weekRangeLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  if (weekStart.slice(0, 4) !== end.slice(0, 4)) return formatWeekLabel(weekStart);
  return weekRangeInYear(weekStart);
}

// ── Clear Sky compact formats ────────────────────────────────────────────────

/** '6h35', '6h05', '45m', '13h' (French '6 h 35', '45 min', '13 h'). */
export function hm(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return t('format.hm.m', { m });
  if (!m) return t('format.hm.h', { h });
  return t('format.hm.hm', { h, mm: String(m).padStart(2, '0') });
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** '⁺¹', '⁻¹', '⁺²' or '' for an arrival day offset. */
export function supOffset(n: number | null | undefined): string {
  if (!n) return '';
  const digits = String(Math.abs(n)).split('').map(d => SUP[d]).join('');
  return `${n > 0 ? '⁺' : '⁻'}${digits}`;
}

/** Anything with local departure / arrival times (a FlightInstance, or a leg). */
export interface TimedSpan {
  depLocal: string;
  arrLocal: string;
  arrDayOffset: number;
}

/** '18:15 → 07:05⁺¹' (or '6:15 PM → 7:05 AM⁺¹'). */
export function timeRange(f: TimedSpan, fmt: TimeFormat = '24h'): string {
  return `${formatClock(f.depLocal, fmt)} → ${formatClock(f.arrLocal, fmt)}${supOffset(f.arrDayOffset)}`;
}

/** 'Good morning' (5–11), 'Good afternoon' (12–17), 'Good evening' otherwise, in `tz`. */
export function greeting(nowMs: number, tz: string): string {
  const h = Number(utcToLocal(nowMs, tz).hhmm.slice(0, 2));
  if (h >= 5 && h < 12) return t('format.greeting.morning');
  if (h >= 12 && h < 18) return t('format.greeting.afternoon');
  return t('format.greeting.evening');
}

/** 'Today', 'Tomorrow', 'Thu' (within the next week), else 'Thu, Oct 8'. */
export function relativeDay(key: string, today: string): string {
  const d = diffDays(today, key);
  if (d === 0) return t('format.today');
  if (d === 1) return t('format.tomorrow');
  if (d > 1 && d < 7) return weekdayShort(weekdayIndex(key));
  return shortDay(key);
}

/** '2d 3h', '2h 10m', '25m' ('2 j 3 h', '2 h 10 min', '25 min'). */
function spanLabel(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return h ? t('format.dur.dh', { d, h }) : t('format.dur.d', { d });
  if (h) return m ? t('format.dur.hm', { h, m }) : t('format.dur.h', { h });
  return t('format.dur.m', { m });
}

/** 'in 2h 10m', 'in 25m', 'in 2d 3h', or 'now' when the time has come. */
export function countdown(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min <= 0) return t('format.now');
  return t('format.in', { dur: spanLabel(min) });
}

/**
 * Badge text for an upcoming departure: 'Today · 08:40' / 'Tomorrow · 08:40'
 * / 'In 2 days · Sat'. `clock` is the formatted local departure time; without
 * it, today shows the countdown ('Today · in 2h 10m') and tomorrow the weekday.
 */
export function relativeCountdown(depUtc: number, now: number, key: string, today: string, clock?: string): string {
  const d = diffDays(today, key);
  if (d <= 0) return t('format.todayAt', { x: clock ?? countdown(depUtc - now) });
  if (d === 1) return t('format.tomorrowAt', { x: clock ?? weekdayShort(weekdayIndex(key)) });
  return t('format.inDays', { n: d, weekday: weekdayShort(weekdayIndex(key)) });
}

/** '+13h', '−3h', '+5h30', '0h': the destination's clock relative to the hub's, at `now`. */
export function tzDiffLabel(destTz: string, hubTz: string, now: number): string {
  const diff = tzOffsetMin(destTz, now) - tzOffsetMin(hubTz, now);
  if (!diff) return t('format.tz.zero');
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const sign = diff > 0 ? '+' : '−';
  return m ? t('format.tz.hm', { sign, h, mm: String(m).padStart(2, '0') }) : t('format.tz.h', { sign, h });
}

/** Short zone name ('JST', 'GMT+1') for display; '' when Intl cannot tell. */
export function tzAbbr(tz: string, now: number): string {
  const overridden = overriddenZoneLabel(tz, now);
  if (overridden) return overridden;
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(now))
      .find(p => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

/** 'Daily' for 7 days a week, else '6× wk'. */
export function daysLabel(n: number): string {
  return n >= 7 ? t('format.daily') : t('format.perWeek', { n });
}

/** Hub names with their proper accents (HUBS names are ASCII for search), per language. */
const HUB_DISPLAY = { YUL: 'data.hub.YUL', YQB: 'data.hub.YQB', YTZ: 'data.hub.YTZ' } as const;

/** 'Montréal' for YUL, 'Québec City' / 'Québec' for YQB; the HUBS name otherwise. */
export function hubDisplayName(code: string): string {
  const key = HUB_DISPLAY[code as keyof typeof HUB_DISPLAY];
  return key ? t(key) : HUBS.find(h => h.code === code)?.name ?? code;
}
