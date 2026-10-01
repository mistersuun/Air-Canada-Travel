import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { GroundTimetables, decodeGround, groundTimetables, setGroundTimetables } from './timetable';

/** Where the app fetches the timetables (relative to the base href). */
export const GROUND_URL = 'data/ground.json';

/**
 * Fetches ground.json. Resolves null on an HTTP error or bad JSON (final);
 * rejects on a network error (offline: tried again later). Specs replace it.
 */
export const GROUND_FETCH = new InjectionToken<() => Promise<unknown>>('GROUND_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    const res = await fetch(GROUND_URL);
    if (!res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  },
});

export type GroundTimetableStatus = 'idle' | 'loading' | 'ready' | 'missing';

/**
 * Train and bus timetables for the ground corridors, loaded once by the
 * screens that show onward travel (Reach, a trip, Today). Until then, or when
 * the file is missing or broken, groundEstimate() keeps its Estimated rows.
 * The decoded file goes into the module signal in timetable.ts so the pure
 * ground functions see it.
 */
@Injectable({ providedIn: 'root' })
export class GroundTimetableService {
  private readonly fetcher = inject(GROUND_FETCH);
  private readonly statusSig = signal<GroundTimetableStatus>('idle');
  private pending: Promise<void> | null = null;

  readonly status = this.statusSig.asReadonly();
  /** The loaded timetables (null until ready). */
  readonly timetables: () => GroundTimetables | null = groundTimetables;

  /**
   * Loads the file once. A missing or broken file is final ('missing'); a
   * network error goes back to 'idle' so a later call tries again. Never rejects.
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
        globalThis.addEventListener?.('online', () => void this.ensureLoaded(), { once: true });
        return;
      }
      let t: GroundTimetables | null = null;
      try {
        t = decodeGround(raw);
      } catch {
        t = null;
      }
      const ok = !!t && t.corridors.size > 0;
      setGroundTimetables(ok ? t : null);
      this.statusSig.set(ok ? 'ready' : 'missing');
      this.pending = null;
    })();
    return this.pending;
  }
}
