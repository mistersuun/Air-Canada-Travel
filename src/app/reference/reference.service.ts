import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  decodeAdvisories, decodeFx, decodeHolidays,
  type AdvisoryIndex, type FxTable, type HolidayIndex,
} from './reference';
import { decodeVisa, type VisaTable } from './visa';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';

export type ReferenceFile = 'advisories' | 'fx' | 'holidays' | 'visa';

/**
 * Fetches data/<name>.json (relative to the base href). Resolves null on a 4xx
 * or bad JSON (final: the feature stays hidden); rejects on a network error, a
 * 5xx or offline (tried again later). Specs replace it.
 */
export const REFERENCE_FETCH = new InjectionToken<(name: ReferenceFile) => Promise<unknown>>('REFERENCE_FETCH', {
  providedIn: 'root',
  factory: () => async (name) => {
    const res = await fetchWithTimeout(`data/${name}.json`);
    if (!res.ok) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (res.status >= 500 || offline) throw new Error(`${name}.json: HTTP ${res.status}`);
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

export type ReferenceStatus = 'idle' | 'loading' | 'ready' | 'missing';

/** One lazily loaded static file, with the ClimateService retry behaviour. */
class Loader<T> {
  readonly status = signal<ReferenceStatus>('idle');
  readonly data = signal<T | null>(null);
  private pending: Promise<void> | null = null;
  private waitingOnline = false;

  constructor(private readonly name: ReferenceFile, private readonly fetcher: () => Promise<unknown>,
              private readonly decode: (raw: unknown) => T | null) {}

  ensureLoaded(): Promise<void> {
    if (this.status() === 'ready' || this.status() === 'missing') return Promise.resolve();
    this.pending ??= (async () => {
      this.status.set('loading');
      let raw: unknown;
      try {
        raw = await this.fetcher();
      } catch {
        this.status.set('idle');
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
      let d: T | null = null;
      try {
        d = this.decode(raw);
      } catch {
        d = null;
      }
      this.data.set(d);
      this.status.set(d ? 'ready' : 'missing');
      this.pending = null;
    })();
    return this.pending;
  }
}

/**
 * Advisories, exchange rates, holidays and entry listings: each loaded once on first use
 * (never at startup). A missing or broken file gives 'missing' silently and
 * the app hides that line.
 */
@Injectable({ providedIn: 'root' })
export class ReferenceService {
  private readonly fetcher = inject(REFERENCE_FETCH);
  private readonly adv = new Loader<AdvisoryIndex>('advisories', () => this.fetcher('advisories'), decodeAdvisories);
  private readonly fxl = new Loader<FxTable>('fx', () => this.fetcher('fx'), decodeFx);
  private readonly hol = new Loader<HolidayIndex>('holidays', () => this.fetcher('holidays'), decodeHolidays);
  private readonly vis = new Loader<VisaTable>('visa', () => this.fetcher('visa'), decodeVisa);

  readonly advisories = this.adv.data.asReadonly();
  readonly fx = this.fxl.data.asReadonly();
  readonly holidays = this.hol.data.asReadonly();
  /** Entry listings by passport (see visa.ts). */
  readonly visa = this.vis.data.asReadonly();
  readonly status = {
    advisories: this.adv.status.asReadonly(),
    fx: this.fxl.status.asReadonly(),
    holidays: this.hol.status.asReadonly(),
    visa: this.vis.status.asReadonly(),
  };

  /** Loads advisories, rates and holidays (each at most once). Never rejects. */
  ensureLoaded(): Promise<void> {
    return Promise.all([this.adv.ensureLoaded(), this.fxl.ensureLoaded(), this.hol.ensureLoaded()]).then(() => undefined);
  }

  /** Loads the entry listings (at most once), only where they are shown. Never rejects. */
  ensureVisa(): Promise<void> {
    return this.vis.ensureLoaded();
  }
}
