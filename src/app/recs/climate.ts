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
