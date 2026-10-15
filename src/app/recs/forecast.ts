/**
 * Pure helpers for the Open-Meteo forecast (https://api.open-meteo.com/v1/forecast).
 * A forecast is for specific dates, at most 16 days out. It is never mixed with
 * the typical-climate normals ("Typical, not a forecast"): the UI always
 * labels it "Forecast".
 */

import { MsgKey, t } from '../i18n/t';

/** How many days ahead the API serves (today counts as day 0). */
export const FORECAST_DAYS = 16;

export interface DayForecast {
  dateKey: string;
  hiC: number;
  loC: number;
  /** Chance of precipitation, 0..100; null when the model gave none. */
  precipPct: number | null;
  /** WMO weather code. */
  code: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nums(v: unknown): (number | null)[] | null {
  return Array.isArray(v) ? v.map(x => (typeof x === 'number' && Number.isFinite(x) ? x : null)) : null;
}

/** Decodes the API's daily block. Skips days without a date, a high, a low and a code. Never throws. */
export function parseForecast(raw: unknown): DayForecast[] {
  const daily = (raw as { daily?: Record<string, unknown> } | null)?.daily;
  if (!daily || !Array.isArray(daily['time'])) return [];
  const time = daily['time'] as unknown[];
  const hi = nums(daily['temperature_2m_max']);
  const lo = nums(daily['temperature_2m_min']);
  const code = nums(daily['weather_code'] ?? daily['weathercode']);
  const pct = nums(daily['precipitation_probability_max']);
  if (!hi || !lo || !code) return [];
  const out: DayForecast[] = [];
  time.forEach((t, i) => {
    if (typeof t !== 'string' || !DATE_RE.test(t) || hi[i] == null || lo[i] == null || code[i] == null) return;
    out.push({
      dateKey: t, hiC: Math.round(hi[i]!), loC: Math.round(lo[i]!),
      precipPct: pct?.[i] == null ? null : Math.round(Math.min(100, Math.max(0, pct[i]!))), code: code[i]!,
    });
  });
  return out;
}

/** True when `dateKey` is today or up to 15 days after it (the 16 days the API serves). */
export function withinForecast(dateKey: string, todayKey: string): boolean {
  if (!DATE_RE.test(dateKey) || !DATE_RE.test(todayKey)) return false;
  const d = (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000;
  return d >= 0 && d < FORECAST_DAYS;
}

/** WMO weather interpretation codes to a phrase (catalogue key base); `wet` is set for precipitation. */
function kind(code: number): { key: 'clear' | 'mostlyClear' | 'partlyCloudy' | 'overcast' | 'fog' | 'drizzle' | 'freezingRain' | 'rain' | 'snow' | 'showers' | 'thunderstorms' | 'mixed'; wet?: boolean } {
  if (code === 0) return { key: 'clear' };
  if (code === 1) return { key: 'mostlyClear' };
  if (code === 2) return { key: 'partlyCloudy' };
  if (code === 3) return { key: 'overcast' };
  if (code === 45 || code === 48) return { key: 'fog' };
  if (code >= 51 && code <= 57) return { key: 'drizzle', wet: true };
  if (code === 66 || code === 67) return { key: 'freezingRain', wet: true };
  if (code >= 61 && code <= 65) return { key: 'rain', wet: true };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key: 'snow', wet: true };
  if (code >= 80 && code <= 82) return { key: 'showers', wet: true };
  if (code >= 95 && code <= 99) return { key: 'thunderstorms', wet: true };
  return { key: 'mixed' };
}

/** 'rain likely' (chance 60%+), 'rain possible' (below), plain 'rain' with no chance given; 'clear', 'partly cloudy'. */
export function weatherText(code: number, precipPct: number | null = null): string {
  const k = kind(code);
  if (!k.wet || precipPct === null) return t(`recs.wx.${k.key}` as MsgKey);
  return t(`recs.wx.${k.key}.${precipPct < 60 ? 'possible' : 'likely'}` as MsgKey);
}

/** '24° / 17° · rain likely'. */
export function forecastText(d: DayForecast): string {
  return `${d.hiC}° / ${d.loC}° · ${weatherText(d.code, d.precipPct)}`;
}

/** The forecast for one date, or null. */
export function forecastOn(days: readonly DayForecast[] | undefined, dateKey: string): DayForecast | null {
  return days?.find(d => d.dateKey === dateKey) ?? null;
}
