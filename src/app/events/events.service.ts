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

/**
 * Events per destination and window. Only the airport code and dates go to the server, and only
 * when a view asks (never in bulk). Silent: a 404, 503, 429, offline or malformed answer leaves
 * the entry null and views show nothing. After a refusal nothing is asked again for 15 minutes.
 */
@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly fetcher = inject(EVENTS_FETCH);
  private readonly state = inject(AppStateService);
  private readonly results = signal<Record<string, EventsResult | null>>({});
  private readonly inflight = new Set<string>();
  private backoffUntil = 0;

  /** undefined: not asked yet; null: asked, nothing to show. */
  result(code: string, w: EventsWindow): EventsResult | null | undefined {
    return this.results()[windowKey(code, w)];
  }

  async load(code: string, w: EventsWindow): Promise<void> {
    const key = windowKey(code, w);
    const now = this.state.nowMs();
    if (key in this.results() || this.inflight.has(key)) return;
    if (this.backoffUntil > now || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    this.inflight.add(key);
    try {
      const { status, body } = await this.fetcher(eventsUrl(code, w));
      if (status === 403 || status === 429 || status === 503) this.backoffUntil = now + 15 * 60_000;
      this.results.update(m => ({ ...m, [key]: status === 200 ? parseEvents(body) : null }));
    } catch {
      this.results.update(m => ({ ...m, [key]: null }));
    } finally {
      this.inflight.delete(key);
    }
  }
}
