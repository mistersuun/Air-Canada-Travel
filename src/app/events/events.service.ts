import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { AppStateService } from '../state/app-state.service';
import { type EventsResult, type EventsWindow, eventsUrl, parseEvents, windowKey } from './events';

/** How the endpoint is called; specs replace it. Resolves to the HTTP status and parsed JSON (null when not JSON). */
export const EVENTS_FETCH = new InjectionToken<(url: string) => Promise<{ status: number; body: unknown }>>('EVENTS_FETCH', {
  providedIn: 'root',
  factory: () => async (url: string) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not JSON: treated as unavailable */ }
    return { status: res.status, body };
  },
});

/** After a per-IP 429 that key is not asked again for this long; other keys are unaffected. */
export const RATE_LIMIT_BACKOFF_MS = 2 * 60_000;
/** After 503 (not configured, daily budget) or 403 nothing is asked for this long: those hold for every request. */
export const GLOBAL_BACKOFF_MS = 15 * 60_000;

/**
 * Events per destination and week. Only the airport code and dates go to the server, and only
 * when a view asks (never in bulk). Silent: a 404, 503, 429, offline or malformed answer leaves
 * the entry null and views show nothing; a 429 is retried for that key only, after two minutes.
 */
@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly fetcher = inject(EVENTS_FETCH);
  private readonly state = inject(AppStateService);
  private readonly results = signal<Record<string, EventsResult | null>>({});
  private readonly inflight = new Set<string>();
  /** Failed keys that may be asked again, and when. */
  private readonly retryAt = new Map<string, number>();
  private globalUntil = 0;

  /** undefined: not asked yet or being asked; null: asked, nothing to show. */
  result(code: string, w: EventsWindow): EventsResult | null | undefined {
    return this.results()[windowKey(code, w)];
  }

  async load(code: string, w: EventsWindow): Promise<void> {
    const key = windowKey(code, w);
    const now = this.state.nowMs();
    if (this.inflight.has(key)) return;
    if (key in this.results() && (this.results()[key] !== null || (this.retryAt.get(key) ?? Infinity) > now)) return;
    // Not asking (a refusal holds for everyone, or offline): the entry reads "nothing to show" so views do not wait forever.
    if (this.globalUntil > now || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      this.retryAt.set(key, Math.max(this.globalUntil, now));
      this.results.update(m => ({ ...m, [key]: null }));
      return;
    }
    this.inflight.add(key);
    try {
      const { status, body } = await this.fetcher(eventsUrl(code, w));
      if (status === 429) this.retryAt.set(key, now + RATE_LIMIT_BACKOFF_MS);
      else this.retryAt.delete(key);
      if (status === 403 || status === 503) {
        this.globalUntil = now + GLOBAL_BACKOFF_MS;
        this.retryAt.set(key, this.globalUntil);
      }
      this.results.update(m => ({ ...m, [key]: status === 200 ? parseEvents(body) : null }));
    } catch {
      this.results.update(m => ({ ...m, [key]: null }));
    } finally {
      this.inflight.delete(key);
    }
  }
}
