import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { decodeClimate } from './climate';
import type { ClimateIndex } from './model';

/** Where the app fetches the normals (relative to the base href). */
export const CLIMATE_URL = 'data/climate.json';

/** Fetches climate.json; resolves null on a 404 or network error (no console output). Specs replace it. */
export const CLIMATE_FETCH = new InjectionToken<() => Promise<unknown>>('CLIMATE_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    try {
      const res = await fetch(CLIMATE_URL);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  },
});

export type ClimateStatus = 'idle' | 'loading' | 'ready' | 'missing';

/**
 * Typical monthly weather, loaded once on the first render of For you or the
 * Trips ideas (never at startup). A missing or broken file gives 'missing'
 * silently and the app hides weather.
 */
@Injectable({ providedIn: 'root' })
export class ClimateService {
  private readonly fetcher = inject(CLIMATE_FETCH);
  private readonly statusSig = signal<ClimateStatus>('idle');
  private readonly indexSig = signal<ClimateIndex | null>(null);
  private pending: Promise<void> | null = null;

  readonly status = this.statusSig.asReadonly();
  readonly index = this.indexSig.asReadonly();

  /** Loads the file once. Never rejects. */
  ensureLoaded(): Promise<void> {
    if (this.statusSig() === 'ready' || this.statusSig() === 'missing') return Promise.resolve();
    this.pending ??= (async () => {
      this.statusSig.set('loading');
      let idx: ClimateIndex | null = null;
      try {
        idx = decodeClimate(await this.fetcher());
      } catch {
        idx = null;
      }
      this.indexSig.set(idx && idx.byCode.size ? idx : null);
      this.statusSig.set(idx && idx.byCode.size ? 'ready' : 'missing');
      this.pending = null;
    })();
    return this.pending;
  }
}
