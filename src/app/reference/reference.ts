/**
 * Reference facts built at build time (scripts/build-advisories.py, build-fx.py,
 * build-holidays.py) and read from static JSON: the Government of Canada travel
 * advice level, ECB exchange rates, and destination public holidays. Pure:
 * decoding, formatting and the Trip Prep items. Facts and their source and
 * date only, no interpretation.
 */
import { addDays, diffDays, formatKey } from '../utils/time';

export interface Advisory { level: 0 | 1 | 2 | 3; text: string; updated: string | null; url: string; regional: boolean }
export interface Holiday { date: string; name: string; localName: string; global: boolean }
export interface FxTable { date: string; source: string; rates: ReadonlyMap<string, number> }

export type AdvisoryIndex = ReadonlyMap<string, Advisory>;
export type HolidayIndex = ReadonlyMap<string, readonly Holiday[]>;

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

export function decodeAdvisories(raw: unknown): AdvisoryIndex | null {
  const countries = rec(rec(raw)?.['countries']);
  if (!countries) return null;
  const out = new Map<string, Advisory>();
  for (const [iso, v] of Object.entries(countries)) {
    const c = rec(v);
    if (!c || ![0, 1, 2, 3].includes(c['level'] as number)) continue;
    if (typeof c['text'] !== 'string' || !c['text'] || typeof c['url'] !== 'string' || !/^https:\/\/travel\.gc\.ca\//.test(c['url'])) continue;
    out.set(iso.toUpperCase(), {
      level: c['level'] as Advisory['level'],
      text: c['text'],
      updated: typeof c['updated'] === 'string' && KEY.test(c['updated']) ? c['updated'] : null,
      url: c['url'],
      regional: c['regional'] === true,
    });
  }
  return out.size ? out : null;
}

export function decodeFx(raw: unknown): FxTable | null {
  const r = rec(raw);
  const rates = rec(r?.['rates']);
  if (!r || !rates || r['base'] !== 'CAD' || typeof r['date'] !== 'string' || !KEY.test(r['date'])) return null;
  const out = new Map<string, number>();
  for (const [code, v] of Object.entries(rates)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out.set(code, v);
  }
  return out.size ? { date: r['date'], source: typeof r['source'] === 'string' ? r['source'] : 'ECB', rates: out } : null;
}

export function decodeHolidays(raw: unknown): HolidayIndex | null {
  const countries = rec(rec(raw)?.['countries']);
  if (!countries) return null;
  const out = new Map<string, Holiday[]>();
  for (const [iso, v] of Object.entries(countries)) {
    if (!Array.isArray(v)) continue;
    const rows: Holiday[] = [];
    for (const x of v) {
      const h = rec(x);
      if (!h || typeof h['date'] !== 'string' || !KEY.test(h['date']) || typeof h['name'] !== 'string' || !h['name']) continue;
      rows.push({
        date: h['date'], name: h['name'],
        localName: typeof h['localName'] === 'string' && h['localName'] ? h['localName'] : h['name'],
        global: h['global'] !== false,
      });
    }
    if (rows.length) out.set(iso.toUpperCase(), rows.sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out.size ? out : null;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** 'Oct 3', or 'Oct 3, 2025' when not in the reference year. */
export function shortDate(key: string, refKey: string): string {
  const sameYear = key.slice(0, 4) === refKey.slice(0, 4);
  return formatKey(key, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * '1 CAD = 0.66 EUR · ECB, Oct 3'. Rates under 0.1 read the other way round
 * ('1 XXX = 12.50 CAD') because '1 CAD = 0.08 XXX' hides the precision.
 * Null for CAD itself or a currency without a rate.
 */
export function fxLine(code: string | null, fx: FxTable | null): { text: string; source: string } | null {
  const rate = code && fx ? fx.rates.get(code) : undefined;
  if (!code || !fx || !rate || code === 'CAD') return null;
  const digits = (n: number) => n >= 100 ? 0 : n >= 10 ? 1 : 2;
  const pair = rate < 0.1
    ? `1 ${code} = ${(1 / rate).toFixed(digits(1 / rate))} CAD`
    : `1 CAD = ${rate.toFixed(digits(rate))} ${code}`;
  return { text: pair, source: `ECB, ${shortDate(fx.date, fx.date)}` };
}

/** Whether a level is shown quietly: normal precautions and no regional advisory. */
export function advisoryQuiet(a: Advisory): boolean {
  return a.level === 0 && !a.regional;
}

/** Stable key for a holiday (same-date holidays differ by name). */
export function holidayKey(h: Holiday): string {
  return `${h.date}-${h.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** 'updated Sep 30' or ''. */
export function advisoryUpdated(a: Advisory, todayKey: string): string {
  return a.updated ? `updated ${shortDate(a.updated, todayKey)}` : '';
}

/** Holidays on or after `fromKey` within `days`, soonest first, at most `max`. */
export function upcomingHolidays(index: HolidayIndex | null, iso2: string | null | undefined, fromKey: string, days = 60, max = 2): Holiday[] {
  const rows = (iso2 && index?.get(iso2.toUpperCase())) || [];
  const last = addDays(fromKey, days);
  return rows.filter(h => h.date >= fromKey && h.date <= last).slice(0, max);
}

/** Holidays between two dates, inclusive. */
export function holidaysBetween(index: HolidayIndex | null, iso2: string | null | undefined, fromKey: string, toKey: string): Holiday[] {
  const rows = (iso2 && index?.get(iso2.toUpperCase())) || [];
  return rows.filter(h => h.date >= fromKey && h.date <= toKey);
}

/** 'National Day' or 'National Day (Fiesta Nacional)'. */
export function holidayName(h: Holiday): string {
  return h.localName && h.localName !== h.name ? `${h.name} (${h.localName})` : h.name;
}

/** 'Public holiday', or 'Public holiday in some regions' when it is not nationwide. */
export function holidayNote(h: Holiday): string {
  return h.global ? 'Public holiday' : 'Public holiday in some regions';
}

/** Days from today to the holiday (for the aria text). */
export function daysUntil(h: Holiday, fromKey: string): number {
  return diffDays(fromKey, h.date);
}
