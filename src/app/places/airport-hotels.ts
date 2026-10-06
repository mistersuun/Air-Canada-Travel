import { Injectable, InjectionToken, inject, signal } from '@angular/core';

/**
 * Hotels near the airports, from public/data/airport-hotels.json (built by
 * scripts/build-airport-hotels.py from OpenStreetMap, ODbL). Names, places and
 * distances only: no prices, no availability, no ratings. Missing or broken
 * file: no list, the screens keep their search links.
 */
export interface AirportHotel {
  name: string;
  lat: number;
  lng: number;
  /** Straight-line metres from the airport reference point. */
  distM: number;
}

export interface AirportHotelsFile {
  builtAt: string | null;
  license: string;
  licenseUrl: string;
  attribution: string;
  airports: ReadonlyMap<string, readonly AirportHotel[]>;
}

export const AIRPORT_HOTELS_URL = 'data/airport-hotels.json';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const ODBL_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

/** Decodes the file; null when the shape is wrong (never throws). */
export function decodeAirportHotels(raw: unknown): AirportHotelsFile | null {
  try {
    const f = raw as { v?: number; builtAt?: unknown; license?: unknown; licenseUrl?: unknown; attribution?: unknown; airports?: unknown };
    if (!f || f.v !== 1 || !f.airports || typeof f.airports !== 'object') return null;
    const airports = new Map<string, AirportHotel[]>();
    for (const [code, list] of Object.entries(f.airports as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const hotels: AirportHotel[] = [];
      for (const r of list) {
        if (!Array.isArray(r) || typeof r[0] !== 'string' || !r[0].trim()) continue;
        const [name, lat, lng, distM] = r as [string, unknown, unknown, unknown];
        if (![lat, lng, distM].every(n => typeof n === 'number' && Number.isFinite(n))) continue;
        hotels.push({ name: name.trim(), lat: lat as number, lng: lng as number, distM: distM as number });
      }
      hotels.sort((a, b) => a.distM - b.distM);
      if (hotels.length) airports.set(code, hotels);
    }
    return {
      builtAt: typeof f.builtAt === 'string' ? f.builtAt : null,
      license: typeof f.license === 'string' ? f.license : 'ODbL-1.0',
      licenseUrl: typeof f.licenseUrl === 'string' ? f.licenseUrl : ODBL_URL,
      attribution: typeof f.attribution === 'string' ? f.attribution : OSM_ATTRIBUTION,
      airports,
    };
  } catch {
    return null;
  }
}

/** '1.2 km', '850 m'. */
export function distanceLabel(m: number): string {
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(Math.round(m / 100) / 10).toFixed(1)} km`;
}

/** Google Maps link to one hotel by coordinates (plain link). */
export function hotelMapUrl(h: AirportHotel): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${h.name} ${h.lat},${h.lng}`)}`;
}

/** Fetches the file. Resolves null on a 4xx or bad JSON; rejects on a network error or 5xx. Specs replace it. */
export const AIRPORT_HOTELS_FETCH = new InjectionToken<() => Promise<unknown>>('AIRPORT_HOTELS_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    const res = await fetch(AIRPORT_HOTELS_URL);
    if (!res.ok) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (res.status >= 500 || offline) throw new Error(`airport-hotels.json: HTTP ${res.status}`);
      return null;
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  },
});

@Injectable({ providedIn: 'root' })
export class AirportHotelsService {
  private readonly fetcher = inject(AIRPORT_HOTELS_FETCH);
  private readonly fileSig = signal<AirportHotelsFile | null>(null);
  private pending: Promise<void> | null = null;
  private done = false;

  /** The loaded file (null until ready, or when missing). */
  readonly file = this.fileSig.asReadonly();

  hotelsNear(code: string): readonly AirportHotel[] {
    return this.fileSig()?.airports.get(code) ?? [];
  }

  /** Loads the file once. Never rejects; a network error allows a later retry. */
  ensureLoaded(): Promise<void> {
    if (this.done) return Promise.resolve();
    this.pending ??= (async () => {
      try {
        this.fileSig.set(decodeAirportHotels(await this.fetcher()));
        this.done = true;
      } catch {
        // offline: try again on the next call
      }
      this.pending = null;
    })();
    return this.pending;
  }
}
