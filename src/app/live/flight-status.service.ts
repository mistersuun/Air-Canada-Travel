import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { AppStateService } from '../state/app-state.service';
import { STATUS_ENDPOINT, maxAgeMs, depIso, parseStatus, statusKey, type FlightStatus } from './flight-status';

/** How the endpoint is called; specs replace it. Resolves to the HTTP status and parsed JSON (null when not JSON). */
export const STATUS_FETCH = new InjectionToken<(url: string) => Promise<{ status: number; body: unknown }>>('STATUS_FETCH', {
  providedIn: 'root',
  factory: () => async (url: string) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not JSON: treated as unavailable */ }
    return { status: res.status, body };
  },
});

const STORE_KEY = 'ac.flightstatus.v1';

export interface StatusEntry {
  /** Last good result, if any. */
  data: FlightStatus | null;
  /** The latest refresh failed (offline, not configured, rate limited, not found). */
  failed: boolean;
}

/**
 * Live status per flight and date. Only the ident and date go to the server.
 * Failures are quiet: the entry just says `failed`, and views show
 * "Live status unavailable" only when a result was shown before.
 */
@Injectable({ providedIn: 'root' })
export class FlightStatusService {
  private readonly fetcher = inject(STATUS_FETCH);
  private readonly state = inject(AppStateService);
  private readonly entries = signal<Record<string, StatusEntry>>(this.load());
  private readonly inflight = new Set<string>();
  /** After a 503/429/404 do not ask again for this long (per key). */
  private readonly backoff = new Map<string, number>();

  private readonly lastOk = new Map<string, number>();

  entry(ident: string, origin: string, depUtc: number): StatusEntry | null {
    return this.entries()[statusKey(ident, origin, depUtc)] ?? null;
  }

  /** `minAgeMs`: skip when the last success is more recent than this (visibility refreshes). */
  async refresh(ident: string, origin: string, depUtc: number, minAgeMs = 0): Promise<void> {
    const key = statusKey(ident, origin, depUtc);
    const now = this.state.nowMs();
    if (this.inflight.has(key) || (this.backoff.get(key) ?? 0) > now) return;
    if (minAgeMs && now - (this.lastOk.get(key) ?? -Infinity) < minAgeMs) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.mark(key); return; }
    this.inflight.add(key);
    try {
      const url = `${STATUS_ENDPOINT}?ident=${encodeURIComponent(ident)}&origin=${encodeURIComponent(origin)}&dep=${encodeURIComponent(depIso(depUtc))}`;
      const { status, body } = await this.fetcher(url);
      const parsed = status === 200 ? parseStatus(body) : null;
      if (parsed) {
        this.backoff.delete(key);
        this.lastOk.set(key, now);
        this.set(key, { data: parsed, failed: false });
      } else {
        if (status === 400 || status === 403 || status === 503 || status === 502 || status === 404 || status === 429) this.backoff.set(key, now + 15 * 60_000);
        this.mark(key);
      }
    } catch {
      this.mark(key);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** The entry's data unless it is older than maxAgeMs() for this departure. */
  fresh(e: StatusEntry | null, nowMs: number, depUtc: number): FlightStatus | null {
    return e?.data && nowMs - Date.parse(e.data.fetchedAt) <= maxAgeMs(depUtc, nowMs) ? e.data : null;
  }

  private mark(key: string): void {
    this.set(key, { data: this.entries()[key]?.data ?? null, failed: true });
  }

  private set(key: string, e: StatusEntry): void {
    this.entries.update(m => ({ ...m, [key]: e }));
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(this.entries())); } catch { /* storage unavailable: memory only */ }
  }

  private load(): Record<string, StatusEntry> {
    try {
      const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Record<string, { data?: unknown }>;
      const out: Record<string, StatusEntry> = {};
      for (const [k, v] of Object.entries(raw)) out[k] = { data: parseStatus(v?.data), failed: false };
      return out;
    } catch {
      return {};
    }
  }
}
