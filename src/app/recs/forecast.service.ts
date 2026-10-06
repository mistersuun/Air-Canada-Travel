import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { NOW } from '../state/app-state.service';
import { findDestination, findHub } from '../utils/airports';
import { FORECAST_DAYS, parseForecast, type DayForecast } from './forecast';

export const FORECAST_ORIGIN = 'https://api.open-meteo.com';
const CACHE_MS = 3 * 60 * 60 * 1000;
/** After a failure, wait this long before asking again (the browser coming back online retries at once). */
const RETRY_MS = 60 * 1000;
const STORE_PREFIX = 'ac.forecast.v1.';

/** The request for a destination: only its coordinates leave the device, never the traveller's. */
export function forecastUrl(lat: number, lng: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2), longitude: lng.toFixed(2),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode',
    timezone: 'auto', forecast_days: String(FORECAST_DAYS),
  });
  return `${FORECAST_ORIGIN}/v1/forecast?${q}`;
}

/**
 * Fetches the forecast JSON for a URL. Resolves null on a 4xx or bad JSON (final);
 * rejects on a network error, a 5xx or offline (tried again later). Specs replace it.
 */
export const FORECAST_FETCH = new InjectionToken<(url: string) => Promise<unknown>>('FORECAST_FETCH', {
  providedIn: 'root',
  factory: () => async (url: string) => {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) {
      if (res.status >= 500) throw new Error(`forecast: HTTP ${res.status}`);
      return null;
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  },
});

/** Per-tab cache; specs replace it. Null when storage is unavailable. */
export const FORECAST_STORAGE = new InjectionToken<Pick<Storage, 'getItem' | 'setItem'> | null>('FORECAST_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try { return globalThis.sessionStorage ?? null; } catch { return null; }
  },
});

interface Entry { at: number; days: DayForecast[] }

/** Re-validates cached days (a stored value is data, not trusted). */
function validDays(days: unknown[]): DayForecast[] {
  return days.filter((d): d is DayForecast => {
    const x = d as DayForecast;
    return !!x && typeof x.dateKey === 'string' && typeof x.hiC === 'number' && typeof x.loC === 'number' && typeof x.code === 'number';
  });
}

/**
 * Weather forecasts per destination code, requested only when a page shows
 * one (never at startup). Memory plus sessionStorage cache for 3 hours. Offline,
 * a failed or empty response simply leaves nothing to show: no errors, no
 * retry storm. Only the destination's coordinates are sent.
 */
@Injectable({ providedIn: 'root' })
export class ForecastService {
  private readonly fetcher = inject(FORECAST_FETCH);
  private readonly storage = inject(FORECAST_STORAGE);
  private readonly now = inject(NOW);
  private readonly store = signal<Record<string, readonly DayForecast[]>>({});
  private readonly memory = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failedAt = new Map<string, number>();
  private readonly wanted = new Set<string>();
  private waitingOnline = false;

  /** Forecast days by destination code (missing until loaded). */
  readonly days = this.store.asReadonly();

  /** Loads (or refreshes after 3 h) the forecast for a destination or hub. Never rejects; no-op for unknown codes. */
  ensure(code: string): Promise<void> {
    const at = this.now();
    const fresh = this.cached(code, at);
    if (fresh) {
      if (this.store()[code] !== fresh.days) this.store.update(s => ({ ...s, [code]: fresh.days }));
      return Promise.resolve();
    }
    const place = findDestination(code) ?? findHub(code);
    if (!place) return Promise.resolve();
    this.wanted.add(code);
    const failed = this.failedAt.get(code);
    if (failed !== undefined && at - failed < RETRY_MS) return Promise.resolve();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.retryWhenOnline();
      return Promise.resolve();
    }
    let p = this.pending.get(code);
    if (!p) {
      p = this.load(code, place.lat, place.lng).finally(() => this.pending.delete(code));
      this.pending.set(code, p);
    }
    return p;
  }

  private cached(code: string, at: number): Entry | null {
    const m = this.memory.get(code);
    if (m && at - m.at < CACHE_MS) return m;
    try {
      const raw = this.storage?.getItem(STORE_PREFIX + code);
      if (raw) {
        const e = JSON.parse(raw) as Entry;
        if (typeof e.at === 'number' && at - e.at < CACHE_MS && at >= e.at && Array.isArray(e.days)) {
          const days = validDays(e.days);
          if (days.length) {
            const entry = { at: e.at, days };
            this.memory.set(code, entry);
            return entry;
          }
        }
      }
    } catch { /* unreadable cache: ask again */ }
    return null;
  }

  private async load(code: string, lat: number, lng: number): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.fetcher(forecastUrl(lat, lng));
    } catch {
      this.failedAt.set(code, this.now());
      this.retryWhenOnline();
      return;
    }
    const days = parseForecast(raw);
    if (!days.length) {
      this.failedAt.set(code, this.now());
      return;
    }
    this.failedAt.delete(code);
    const entry = { at: this.now(), days };
    this.memory.set(code, entry);
    try { this.storage?.setItem(STORE_PREFIX + code, JSON.stringify(entry)); } catch { /* full or blocked */ }
    this.store.update(s => ({ ...s, [code]: days }));
  }

  private retryWhenOnline(): void {
    if (this.waitingOnline || typeof globalThis.addEventListener !== 'function') return;
    this.waitingOnline = true;
    globalThis.addEventListener('online', () => {
      this.waitingOnline = false;
      this.failedAt.clear();
      for (const c of this.wanted) void this.ensure(c);
    }, { once: true });
  }
}
