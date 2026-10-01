/**
 * Canadian and US public holidays, generated from rules (spec §2.7): fixed
 * dates, nth weekday, last Monday before May 25, and Easter (computus).
 * Works for any year; the app needs 2026 to 2028.
 *
 * The note is neutral: it never changes a number and is never a score.
 */
import { addDays, diffDays, formatKey, weekdayIndex } from '../../utils/time';

export interface Holiday { dateKey: string; name: string; region: 'CA' | 'US' | `CA-${string}` }

function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The n-th weekday (0 = Mon … 6 = Sun) of a month; n = -1 is the last one. */
export function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = key(y, m, 1);
    const shift = (weekday - weekdayIndex(first) + 7) % 7;
    return addDays(first, shift + (n - 1) * 7);
  }
  const nextMonth = m === 12 ? key(y + 1, 1, 1) : key(y, m + 1, 1);
  const last = addDays(nextMonth, -1);
  const back = (weekdayIndex(last) - weekday + 7) % 7;
  return addDays(last, -back);
}

/** Easter Sunday (anonymous Gregorian computus). */
export function easterSunday(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}

/** The Monday on or before May 24 (Victoria Day, Journée nationale des patriotes). */
function victoriaDay(y: number): string {
  const may24 = key(y, 5, 24);
  return addDays(may24, -weekdayIndex(may24));
}

const MON = 0, THU = 3;
const yearCache = new Map<number, Holiday[]>();

/** Every holiday of a year, sorted by date (then CA before US). */
export function holidaysIn(year: number): Holiday[] {
  let list = yearCache.get(year);
  if (list) return list;
  const y = year;
  const easter = easterSunday(y);
  list = [
    // Canada (national / federal)
    { dateKey: key(y, 1, 1), name: "New Year's Day", region: 'CA' },
    { dateKey: addDays(easter, -2), name: 'Good Friday', region: 'CA' },
    { dateKey: addDays(easter, 1), name: 'Easter Monday', region: 'CA' },
    { dateKey: victoriaDay(y), name: 'Victoria Day', region: 'CA' },
    { dateKey: key(y, 7, 1), name: 'Canada Day', region: 'CA' },
    { dateKey: nthWeekday(y, 8, MON, 1), name: 'Civic Holiday', region: 'CA' },
    { dateKey: nthWeekday(y, 9, MON, 1), name: 'Labour Day', region: 'CA' },
    { dateKey: key(y, 9, 30), name: 'National Day for Truth and Reconciliation', region: 'CA' },
    { dateKey: nthWeekday(y, 10, MON, 2), name: 'Thanksgiving', region: 'CA' },
    { dateKey: key(y, 11, 11), name: 'Remembrance Day', region: 'CA' },
    { dateKey: key(y, 12, 25), name: 'Christmas Day', region: 'CA' },
    { dateKey: key(y, 12, 26), name: 'Boxing Day', region: 'CA' },
    // Provinces
    { dateKey: nthWeekday(y, 2, MON, 3), name: 'Family Day', region: 'CA-ON,BC,AB,SK,NB' },
    { dateKey: nthWeekday(y, 2, MON, 3), name: 'Louis Riel Day', region: 'CA-MB' },
    { dateKey: nthWeekday(y, 2, MON, 3), name: 'Heritage Day', region: 'CA-NS' },
    { dateKey: victoriaDay(y), name: 'Journée nationale des patriotes', region: 'CA-QC' },
    { dateKey: key(y, 6, 24), name: 'Fête nationale', region: 'CA-QC' },
    // United States (federal)
    { dateKey: key(y, 1, 1), name: "New Year's Day", region: 'US' },
    { dateKey: nthWeekday(y, 1, MON, 3), name: 'Martin Luther King Jr. Day', region: 'US' },
    { dateKey: nthWeekday(y, 2, MON, 3), name: "Presidents' Day", region: 'US' },
    { dateKey: nthWeekday(y, 5, MON, -1), name: 'Memorial Day', region: 'US' },
    { dateKey: key(y, 6, 19), name: 'Juneteenth', region: 'US' },
    { dateKey: key(y, 7, 4), name: 'Independence Day', region: 'US' },
    { dateKey: nthWeekday(y, 9, MON, 1), name: 'Labor Day', region: 'US' },
    { dateKey: nthWeekday(y, 10, MON, 2), name: 'Columbus Day', region: 'US' },
    { dateKey: key(y, 11, 11), name: 'Veterans Day', region: 'US' },
    { dateKey: nthWeekday(y, 11, THU, 4), name: 'Thanksgiving', region: 'US' },
    { dateKey: key(y, 12, 25), name: 'Christmas Day', region: 'US' },
  ];
  const rank = (h: Holiday) => (h.region === 'CA' ? 0 : h.region === 'US' ? 2 : 1);
  list.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || rank(a) - rank(b));
  yearCache.set(year, list);
  return list;
}

/** Holidays within ±windowDays of dateKey, sorted by date. */
export function holidaysNear(dateKey: string, windowDays: number): Holiday[] {
  const y = Number(dateKey.slice(0, 4));
  return [y - 1, y, y + 1]
    .flatMap(holidaysIn)
    .filter(h => Math.abs(diffDays(dateKey, h.dateKey)) <= windowDays);
}

/** 'Canadian Thanksgiving', 'US Thanksgiving', 'Family Day (ON, BC, AB, SK, NB)', 'Canada Day'. */
export function holidayDisplayName(h: Holiday): string {
  if (h.region === 'CA') return h.name === 'Thanksgiving' || h.name === "New Year's Day" || h.name === 'Christmas Day'
    ? `Canadian ${h.name}` : h.name;
  if (h.region === 'US') return `US ${h.name}`;
  return `${h.name} (${provinces(h)})`;
}

function provinces(h: Holiday): string {
  return h.region.slice(3).split(',').join(', ');
}

/**
 * One neutral line for the nearest holiday within 3 days, Canadian first:
 * 'Canadian Thanksgiving weekend (Mon Oct 12). Often busy, check loads.'
 */
export function holidayNote(dateKey: string): string | null {
  const near = holidaysNear(dateKey, 3);
  if (!near.length) return null;
  const rank = (h: Holiday) => (h.region === 'CA' ? 0 : h.region === 'US' ? 2 : 1);
  const h = [...near].sort((a, b) =>
    rank(a) - rank(b) || Math.abs(diffDays(dateKey, a.dateKey)) - Math.abs(diffDays(dateKey, b.dateKey)))[0];
  const day = formatKey(h.dateKey, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const weekend = weekdayIndex(h.dateKey) === MON || weekdayIndex(h.dateKey) === THU ? ' weekend' : '';
  const name = h.region.startsWith('CA-') ? `${h.name}${weekend} in ${provinces(h)}` : `${holidayDisplayName(h)}${weekend}`;
  return `${name} (${day}). Often busy, check loads.`;
}
