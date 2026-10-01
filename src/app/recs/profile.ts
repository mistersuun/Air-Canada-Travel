/**
 * Travel profile: pure sanitising and summary helpers (extras spec §5.1).
 * The profile only steers suggestions; it never changes a number we show.
 */
import { WEEKDAY_SHORT } from '../utils/time';
import { TravelProfile, TripLength, TripStyle } from './model';

export const TRIP_STYLES: readonly TripStyle[] = ['Sun', 'City', 'Adventure'];
export const TRIP_LENGTHS: readonly TripLength[] = ['day', 'weekend', 'week'];
export const MAX_DISMISSED = 200;

export const EMPTY_PROFILE: Readonly<TravelProfile> = Object.freeze({
  v: 1,
  styles: [],
  length: null,
  maxFlightHours: null,
  party: 1,
  days: [],
  onwardBudget: 'any',
  dismissed: [],
  updatedAt: null,
}) as Readonly<TravelProfile>;

function clampInt(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/** Coerce anything into a valid TravelProfile. Never throws. */
export function sanitizeProfile(raw: unknown): TravelProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const styles = Array.isArray(r['styles'])
    ? [...new Set((r['styles'] as unknown[]).filter((s): s is TripStyle => TRIP_STYLES.includes(s as TripStyle)))]
    : [];
  const days = Array.isArray(r['days'])
    ? [...new Set((r['days'] as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7))]
      .sort((a, b) => a - b)
    : [];
  const dismissed = Array.isArray(r['dismissed'])
    ? [...new Set((r['dismissed'] as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 200))]
      .slice(-MAX_DISMISSED)
    : [];
  return {
    v: 1,
    styles,
    length: TRIP_LENGTHS.includes(r['length'] as TripLength) ? (r['length'] as TripLength) : null,
    maxFlightHours: r['maxFlightHours'] === null ? null : clampInt(r['maxFlightHours'], 1, 12),
    party: clampInt(r['party'], 1, 9) ?? 1,
    days,
    onwardBudget: r['onwardBudget'] === 'low' ? 'low' : 'any',
    dismissed,
    updatedAt: typeof r['updatedAt'] === 'string' && !Number.isNaN(Date.parse(r['updatedAt'])) ? r['updatedAt'] : null,
  };
}

/** 'Sun', 'City and Sun', 'City, Sun and Adventure'. */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Styles in display order (City, Sun, Adventure: the mock's "like City and Sun"). */
export function stylesDisplay(styles: readonly TripStyle[]): TripStyle[] {
  const order: TripStyle[] = ['City', 'Sun', 'Adventure'];
  return order.filter(s => styles.includes(s));
}

/**
 * The days as a range when they are consecutive around the week ('Thu–Mon'
 * for [1,4,5,6,7]); else a list ('Mon, Wed, Fri'); null for any day.
 */
export function daysRange(days: readonly number[], sep = '–'): string | null {
  if (!days.length || days.length === 7) return null;
  const set = new Set(days);
  // Find a start day whose previous day is not in the set; a single run means consecutive.
  const starts = [1, 2, 3, 4, 5, 6, 7].filter(d => set.has(d) && !set.has(d === 1 ? 7 : d - 1));
  if (starts.length === 1) {
    const start = starts[0];
    const end = ((start - 1 + days.length - 1) % 7) + 1;
    return days.length === 1 ? WEEKDAY_SHORT[start - 1] : `${WEEKDAY_SHORT[start - 1]}${sep}${WEEKDAY_SHORT[end - 1]}`;
  }
  return [...days].sort((a, b) => a - b).map(d => WEEKDAY_SHORT[d - 1]).join(', ');
}

const LENGTH_SUMMARY: Record<TripLength, string> = { day: 'day trips', weekend: 'long weekends', week: 'a week or more' };

/** 'City, Sun · long weekends · up to 7h · Thu–Mon', or 'Not set up'. */
export function profileSummary(p: TravelProfile): string {
  if (p.updatedAt === null) return 'Not set up';
  const parts: string[] = [];
  if (p.styles.length) parts.push(stylesDisplay(p.styles).join(', '));
  if (p.length) parts.push(LENGTH_SUMMARY[p.length]);
  if (p.maxFlightHours !== null) parts.push(`up to ${p.maxFlightHours}h`);
  const d = daysRange(p.days);
  if (d) parts.push(d);
  return parts.length ? parts.join(' · ') : 'Any trip';
}
