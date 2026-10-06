/**
 * Typical weather (monthly normals) from public/data/climate.json, built by
 * scripts/build-climate.py from Open-Meteo's ERA5 archive (CC BY 4.0).
 * Always shown as "Typical", never as a forecast. Pure functions only.
 */
import type { ClimateFile, ClimateIndex, ClimateMonth } from './model';

const VARS = ['tmax', 'tmin', 'precip', 'wet'] as const;

function twelveNumbers(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 12 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

/** A ClimateIndex from parsed climate.json, or null when the file is not one. Bad locations are skipped. */
export function decodeClimate(file: unknown): ClimateIndex | null {
  if (!file || typeof file !== 'object') return null;
  const f = file as Partial<ClimateFile>;
  if (f.v !== 1 || !f.codes || typeof f.codes !== 'object') return null;
  const byCode = new Map<string, ClimateMonth[]>();
  for (const [code, raw] of Object.entries(f.codes)) {
    if (!/^[A-Z]{3}$/.test(code) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!VARS.every(k => twelveNumbers(r[k]))) continue;
    const [tmax, tmin, precip, wet] = VARS.map(k => r[k] as number[]);
    byCode.set(code, tmax.map((_, i) => ({
      month: i + 1,
      tmaxC: Math.round(tmax[i]),
      tminC: Math.round(tmin[i]),
      precipMm: Math.round(precip[i]),
      wetDays: Math.round(wet[i]),
    })));
  }
  return {
    attribution: typeof f.attribution === 'string' ? f.attribution : '',
    period: typeof f.period === 'string' ? f.period : '',
    byCode,
  };
}

/** Normals for a destination and month (1..12), or null when unknown. */
export function climateFor(index: ClimateIndex | null | undefined, code: string | null | undefined, month: number): ClimateMonth | null {
  if (!index || !code || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return index.byCode.get(code.toUpperCase())?.[month - 1] ?? null;
}

/** 'Oct 30° / 23°' (high / low). */
export function formatTypical(c: ClimateMonth, monthShort: string): string {
  return `${monthShort} ${c.tmaxC}° / ${c.tminC}°`;
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** 'Oct 30° / 23°' for a ClimateMonth, using its own month. */
export function typicalText(c: ClimateMonth): string {
  return formatTypical(c, MONTH_SHORT[c.month - 1]);
}

export const COLD_BELOW_C = 5;
export const WET_DAYS_RAIN = 10;
export const HOT_FROM_C = 30;

/** Month numbers (1..12) from `fromKey` to `toKey` (date keys), at most 12, in order, without repeats. */
export function monthsBetween(fromKey: string, toKey: string): number[] {
  const m = (k: string) => Number(k.slice(5, 7));
  const out: number[] = [];
  const a = m(fromKey);
  const span = Math.min(11, Math.max(0, (Number(toKey.slice(0, 4)) - Number(fromKey.slice(0, 4))) * 12 + m(toKey) - a));
  for (let i = 0; i <= span; i++) out.push(((a - 1 + i) % 12) + 1);
  return out;
}

/**
 * One line of typical weather for the months of a trip, with a packing nudge
 * from simple thresholds (cold under 5°, 10+ wet days, hot from 30°), or null
 * when the code has no normals. Averages over the months, so it stays a
 * typical, never a forecast.
 */
export function typicalForMonths(
  index: ClimateIndex | null | undefined,
  code: string | null | undefined,
  months: readonly number[],
): { text: string; advice: string[] } | null {
  const rows = months.map(m => climateFor(index, code, m)).filter((c): c is ClimateMonth => !!c);
  if (!rows.length) return null;
  const range = (f: (c: ClimateMonth) => number): [number, number] => {
    const v = rows.map(f);
    return [Math.min(...v), Math.max(...v)];
  };
  const [hiMin, hiMax] = range(c => c.tmaxC);
  const [loMin, loMax] = range(c => c.tminC);
  const [wetMin, wetMax] = range(c => c.wetDays);
  const deg = (a: number, b: number) => (a === b ? `${a}°` : `${a}\u2013${b}°`);
  const advice: string[] = [];
  if (wetMax >= WET_DAYS_RAIN) advice.push('a rain layer');
  if (loMin < COLD_BELOW_C) advice.push('warm layers');
  if (hiMax >= HOT_FROM_C) advice.push('for the heat');
  return { text: `Typical ${deg(hiMin, hiMax)} / ${deg(loMin, loMax)}, ${wetDaysText(wetMin, wetMax)}`, advice };
}

/** 'no wet days', '1 wet day', '9 wet days', '9\u201314 wet days'. */
export function wetDaysText(min: number, max: number = min): string {
  if (max === 0) return 'no wet days';
  if (min === max) return `${min} wet ${min === 1 ? 'day' : 'days'}`;
  return `${min}\u2013${max} wet days`;
}
