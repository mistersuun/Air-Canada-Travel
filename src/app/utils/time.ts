/**
 * Date and time helpers for the schedule engine.
 *
 * Conventions:
 * - A "date key" is a calendar date string 'YYYY-MM-DD'. All internal date
 *   math uses date keys (never Date comparisons), so DST changes and
 *   inclusive ranges behave.
 * - A "local time" is 'HH:MM' (24h) at some airport; turning it into an
 *   instant needs that airport's IANA zone: toUtcMs(dateKey, hhmm, tz).
 * - Instants are epoch milliseconds (UTC).
 *
 * No date library: zone offsets come from Intl.DateTimeFormat and are memoised.
 */

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 1440;

/** Monday-first weekday names, index 0 = Monday. */
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** True when `key` is a well-formed, real calendar date 'YYYY-MM-DD'. */
export function isDateKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const m = KEY_RE.exec(key);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 'YYYY-MM-DD' of `d` in the device's local calendar. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local-midnight Date for a date key (for display and legacy APIs). */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Accepts a date key or a Date (read in local calendar) and returns a date key. */
export function toKey(d: string | Date): string {
  return typeof d === 'string' ? d : dateKey(d);
}

// Date keys are few (a few hundred distinct days), so both directions are memoised.
const dayOfKey = new Map<string, number>();
const keyOfDay = new Map<number, string>();

function keyToUtcDay(key: string): number {
  let day = dayOfKey.get(key);
  if (day === undefined) {
    const y = +key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10);
    day = Date.UTC(y, m - 1, d) / 86_400_000;
    if (dayOfKey.size > 10_000) dayOfKey.clear();
    dayOfKey.set(key, day);
  }
  return day;
}

function utcDayToKey(day: number): string {
  let key = keyOfDay.get(day);
  if (key === undefined) {
    const t = new Date(day * 86_400_000);
    key = `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
    if (keyOfDay.size > 10_000) keyOfDay.clear();
    keyOfDay.set(day, key);
  }
  return key;
}

/** Calendar arithmetic on date keys (DST-proof). */
export function addDays(key: string, n: number): string {
  return utcDayToKey(keyToUtcDay(key) + n);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: string, b: string): number {
  return keyToUtcDay(b) - keyToUtcDay(a);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  const js = new Date(keyToUtcDay(key) * 86_400_000).getUTCDay(); // 0 = Sunday
  return js === 0 ? 6 : js - 1;
}

/** Monday of the week containing `key`. */
export function weekStartKey(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

/** The 7 date keys Mon..Sun starting at `weekStart`. */
export function weekKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** 'YYYY-MM' of a date key. */
export function monthOf(key: string): string {
  return key.slice(0, 7);
}

/** All date keys of a month 'YYYY-MM'. */
export function monthKeys(yearMonth: string): string[] {
  const [y, m] = yearMonth.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${yearMonth}-${pad2(i + 1)}`);
}

/** Shift a 'YYYY-MM' month by n months. */
export function addMonths(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`;
}

/** Minutes since midnight for 'HH:MM'; NaN when malformed. */
export function hhmmToMin(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) return NaN;
  return +m[1] * 60 + +m[2];
}

/** 'HH:MM' for minutes since midnight (wraps into 0..1439). */
export function minToHhmm(min: number): string {
  const v = ((Math.round(min) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
}

// ── Time zones ──────────────────────────────────────────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, Map<number, number>>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallClock { y: number; mo: number; d: number; h: number; mi: number; s: number }

function wallClock(utcMs: number, tz: string): WallClock {
  const parts = dtf(tz).formatToParts(new Date(utcMs));
  const get = (type: string) => {
    for (const p of parts) if (p.type === type) return +p.value;
    return 0;
  };
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

function rawOffsetAt(tz: string, at: number): number {
  let perTz = offsetCache.get(tz);
  if (!perTz) offsetCache.set(tz, (perTz = new Map()));
  let off = perTz.get(at);
  if (off === undefined) {
    const w = wallClock(at, tz);
    off = Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - at) / MINUTE_MS);
    if (perTz.size > 20_000) perTz.clear();
    perTz.set(at, off);
  }
  return off;
}

/**
 * Offset of `tz` from UTC in minutes at instant `utcMs` (e.g. −240 for EDT).
 * Memoised: when the offsets at both ends of the UTC day agree the whole day
 * shares it (one Intl call per zone per day); on transition days it is
 * resolved per quarter-hour, the granularity at which real offsets change.
 */
export function tzOffsetMin(tz: string, utcMs: number): number {
  const dayStart = Math.floor(utcMs / 86_400_000) * 86_400_000;
  const a = rawOffsetAt(tz, dayStart);
  if (a === rawOffsetAt(tz, dayStart + 86_400_000)) return a;
  return rawOffsetAt(tz, Math.floor(utcMs / 900_000) * 900_000);
}

/**
 * Instant (epoch ms) of wall-clock `hhmm` on `dateKey` in zone `tz`.
 * DST gaps resolve forward (02:30 on spring-forward day → 03:30), ambiguous
 * fall-back times resolve to the first occurrence.
 */
export function toUtcMs(dateKey: string, hhmm: string, tz: string): number {
  const naive = keyToUtcDay(dateKey) * 86_400_000 + hhmmToMin(hhmm) * MINUTE_MS;
  const off1 = tzOffsetMin(tz, naive);
  let t = naive - off1 * MINUTE_MS;
  const off2 = tzOffsetMin(tz, t);
  if (off2 !== off1) {
    const t2 = naive - off2 * MINUTE_MS;
    // t2 is self-consistent unless the wall time falls in a DST gap, in which
    // case take the later instant (the wall clock "springs forward").
    t = tzOffsetMin(tz, t2) === off2 ? t2 : Math.max(t, t2);
  }
  return t;
}

/** Local calendar date and 'HH:MM' of an instant in `tz`. */
export function utcToLocal(utcMs: number, tz: string): { dateKey: string; hhmm: string } {
  const shifted = new Date(utcMs + tzOffsetMin(tz, utcMs) * MINUTE_MS);
  return {
    dateKey: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    hhmm: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
  };
}

/** Today's date key, in the device calendar or in `tz` when given. */
export function todayKey(tz?: string, now: number = Date.now()): string {
  return tz ? utcToLocal(now, tz).dateKey : dateKey(new Date(now));
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** '7h 05m', '45m', '12h'. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${pad2(m)}m`;
}

/** '+1', '−1' or '' for an arrival day offset. */
export function formatDayOffset(offset: number): string {
  if (!offset) return '';
  return offset > 0 ? `+${offset}` : `−${-offset}`;
}

/** 'HH:MM' → '9:05 PM' when `format` is '12h', unchanged for '24h'. */
export function formatClock(hhmm: string, format: '12h' | '24h' = '24h'): string {
  if (format === '24h') return hhmm;
  const min = hhmmToMin(hhmm);
  if (Number.isNaN(min)) return hhmm;
  const h = Math.floor(min / 60);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(min % 60)} ${suffix}`;
}

/** Formats a date key with Intl (calendar date, no zone shift). */
export function formatKey(key: string, opts: Intl.DateTimeFormatOptions, locale = 'en-US'): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' });
}
