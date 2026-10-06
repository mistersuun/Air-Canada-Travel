import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { decodeClimate } from './climate';
import type { ClimateIndex } from './model';

/** Where the app fetches the normals (relative to the base href). */
export const CLIMATE_URL = 'data/climate.json';

/**
 * Fetches climate.json. Resolves null on a 4xx or bad JSON (final);
 * rejects on a network error, a 5xx or offline (tried again later). Specs replace it.
 */
export const CLIMATE_FETCH = new InjectionToken<() => Promise<unknown>>('CLIMATE_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    const res = await fetch(CLIMATE_URL);
    if (!res.ok) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (res.status >= 500 || offline) throw new Error(`climate.json: HTTP ${res.status}`);
      return null;
    }
    try {
      return await res.json();
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
  private waitingOnline = false;

  readonly status = this.statusSig.asReadonly();
  readonly index = this.indexSig.asReadonly();

  /**
   * Loads the file once. A missing or broken file (4xx, bad JSON) is final
   * ('missing'). A network error, a 5xx or being offline goes back to 'idle':
   * the next ensureLoaded() call retries, as does the browser coming back
   * online. Never rejects.
   */
  ensureLoaded(): Promise<void> {
    if (this.statusSig() === 'ready' || this.statusSig() === 'missing') return Promise.resolve();
    this.pending ??= (async () => {
      this.statusSig.set('loading');
      let raw: unknown;
      try {
        raw = await this.fetcher();
      } catch {
        this.statusSig.set('idle');
        this.pending = null;
        if (!this.waitingOnline) {
          this.waitingOnline = true;
          globalThis.addEventListener?.('online', () => {
            this.waitingOnline = false;
            void this.ensureLoaded();
          }, { once: true });
        }
        return;
      }
      let idx: ClimateIndex | null = null;
      try {
        idx = decodeClimate(raw);
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
