import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { Place } from '../trips/model';
import { CITIES_URL, CityHit, CityIndex, cityHit, decodeCities, searchCities } from './city-index';
import { parsePlaceId, placeFromDestination, placeFromHit } from './place';

/** Fetches cities.json; specs replace it. */
export const CITIES_FETCH = new InjectionToken<() => Promise<unknown>>('CITIES_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    const res = await fetch(CITIES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
});

export type CityIndexStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Lazy GeoNames city index for "Places" search. Nothing is fetched until the
 * first ensureLoaded() (a search of 3+ characters or a /reach/gn-… page);
 * the service worker caches the file lazily, so it works offline once used.
 * When the file is missing or broken, status is 'error' and search returns
 * [] (the app falls back to AC destinations only).
 */
@Injectable({ providedIn: 'root' })
export class CityIndexService {
  private readonly fetcher = inject(CITIES_FETCH);
  private readonly statusSig = signal<CityIndexStatus>('idle');
  private index: CityIndex | null = null;
  private pending: Promise<boolean> | null = null;

  readonly status = this.statusSig.asReadonly();

  /** Loads the index once; resolves true when ready. Never rejects; a failure can be retried. */
  ensureLoaded(): Promise<boolean> {
    if (this.index) return Promise.resolve(true);
    this.pending ??= (async () => {
      this.statusSig.set('loading');
      try {
        const idx = decodeCities(await this.fetcher());
        if (!idx) throw new Error('bad cities.json');
        this.index = idx;
        this.statusSig.set('ready');
        return true;
      } catch {
        this.statusSig.set('error');
        return false;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** Matching cities (empty until loaded), best first. */
  search(q: string, limit = 6): CityHit[] {
    return searchCities(this.index, q, limit).map(cityHit);
  }

  /** 'gn-…' once loaded (with acCode when AC serves the city), or 'ac-…' anytime; null when unknown. */
  byId(placeId: string): Place | null {
    const p = parsePlaceId(placeId);
    if (!p) return null;
    if (p.kind === 'ac') {
      const place = placeFromDestination(p.code);
      return place.iso2 ? place : null;
    }
    const rec = this.index?.byId.get(p.geonameId);
    return rec ? placeFromHit(cityHit(rec)) : null;
  }
}
