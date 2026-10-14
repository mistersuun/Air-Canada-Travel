import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';

/**
 * Airport essentials (public/data/airport-info.json, hand-curated and small):
 * the terminal Air Canada uses, whether there is a Maple Leaf Lounge, and the
 * typical ways and minutes from the airport to the city centre. A field is
 * absent when it was not certain. Typical minutes, not a timetable.
 */

export type CityMode = 'train' | 'bus' | 'metro' | 'taxi';
export interface CityOption { mode: CityMode; min: number; note: string }
export interface AirportInfo {
  /** Air Canada terminals ('1', 'B'); empty when unknown or single-terminal. */
  terminals: readonly string[];
  singleTerminal: boolean;
  /** true / false only where certain; null otherwise. */
  mapleLeafLounge: boolean | null;
  toCity: readonly CityOption[];
  source: string;
  reviewed: string;
}
export type AirportInfoIndex = ReadonlyMap<string, AirportInfo>;

const MODES: readonly string[] = ['train', 'bus', 'metro', 'taxi'];
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

export function decodeAirportInfo(raw: unknown): AirportInfoIndex | null {
  const airports = rec(rec(raw)?.['airports']);
  if (!airports) return null;
  const out = new Map<string, AirportInfo>();
  for (const [code, v] of Object.entries(airports)) {
    const a = rec(v);
    if (!a || !/^[A-Z]{3}$/.test(code)) continue;
    const toCity: CityOption[] = [];
    if (Array.isArray(a['toCity'])) {
      for (const o of a['toCity']) {
        const r = rec(o);
        if (r && MODES.includes(r['mode'] as string) && Number.isFinite(r['min']) && (r['min'] as number) > 0 && typeof r['note'] === 'string') {
          toCity.push({ mode: r['mode'] as CityMode, min: Math.round(r['min'] as number), note: r['note'] });
        }
      }
    }
    const terminals = Array.isArray(a['terminals']) ? a['terminals'].filter((t): t is string => typeof t === 'string' && !!t) : [];
    out.set(code, {
      terminals,
      singleTerminal: a['singleTerminal'] === true,
      mapleLeafLounge: typeof a['mapleLeafLounge'] === 'boolean' ? a['mapleLeafLounge'] : null,
      toCity,
      source: typeof a['source'] === 'string' ? a['source'] : '',
      reviewed: typeof a['reviewed'] === 'string' ? a['reviewed'] : '',
    });
  }
  return out.size ? out : null;
}

// ── The loaded file ─────────────────────────────────────────────────────────

const loaded = signal<AirportInfoIndex | null>(null);

/** The info for an airport once airport-info.json has loaded (a signal read), else null. */
export function airportInfo(code: string | null | undefined): AirportInfo | null {
  return (code && loaded()?.get(code.toUpperCase())) || null;
}

/** Set by AirportInfoService (and specs). */
export function setAirportInfo(i: AirportInfoIndex | null): void {
  loaded.set(i);
}

/** Minutes of the quickest known way from the airport to the city centre, or null. */
export function fastestToCityMin(code: string | null | undefined): number | null {
  const opts = airportInfo(code)?.toCity;
  return opts?.length ? Math.min(...opts.map(o => o.min)) : null;
}

/** 'Terminal 1', 'Terminals 1 and 3', 'Domestic and International terminals', 'Single terminal', or '' when unknown. */
export function terminalLabel(i: AirportInfo): string {
  if (i.terminals.length) {
    const names = i.terminals.join(' and ');
    // Short names are numbers or letters ('1', 'B'); longer ones are words ('Domestic').
    if (i.terminals.every(t => t.length <= 2)) return `${i.terminals.length > 1 ? 'Terminals' : 'Terminal'} ${names}`;
    return `${names} ${i.terminals.length > 1 ? 'terminals' : 'terminal'}`;
  }
  return i.singleTerminal ? 'Single terminal' : '';
}

const MODE_WORD: Record<CityMode, string> = { train: 'Train', bus: 'Bus', metro: 'Metro', taxi: 'Taxi' };

/** 'Train about 25 min · UP Express to Union Station'. */
export function cityOptionLabel(o: CityOption): string {
  return `${MODE_WORD[o.mode]} about ${o.min} min · ${o.note}`;
}

// ── Loading ─────────────────────────────────────────────────────────────────

export const AIRPORT_INFO_FETCH = new InjectionToken<() => Promise<unknown>>('AIRPORT_INFO_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    const res = await fetchWithTimeout('data/airport-info.json');
    if (!res.ok) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (res.status >= 500 || offline) throw new Error(`airport-info.json: HTTP ${res.status}`);
      return null;
    }
    try {
      return await res.json();
    } catch (err) {
      if (isAbortError(err)) throw err;
      return null;
    }
  },
});

/** Loads airport-info.json once, on first use (never at startup). A missing file hides the Airport block. */
@Injectable({ providedIn: 'root' })
export class AirportInfoService {
  private readonly fetcher = inject(AIRPORT_INFO_FETCH);
  private pending: Promise<void> | null = null;
  private done = false;

  ensureLoaded(): Promise<void> {
    if (this.done) return Promise.resolve();
    this.pending ??= (async () => {
      let raw: unknown;
      try {
        raw = await this.fetcher();
      } catch {
        this.pending = null;
        globalThis.addEventListener?.('online', () => void this.ensureLoaded(), { once: true });
        return;
      }
      try {
        setAirportInfo(decodeAirportInfo(raw));
      } catch {
        setAirportInfo(null);
      }
      this.done = true;
    })();
    return this.pending;
  }
}
