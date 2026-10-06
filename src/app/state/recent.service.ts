import { Injectable, InjectionToken, inject, signal } from '@angular/core';

export const RECENT_KEY = 'ac.recent.v1';
export const RECENT_MAX = 6;

/** Storage for recently viewed destinations (per viewer, on this device). Null when blocked. */
export const RECENT_STORAGE = new InjectionToken<Storage | null>('RECENT_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null; // SecurityError when site data is blocked
    }
  },
});

/** Newest-first, de-duplicated, at most RECENT_MAX codes. */
export function pushRecent(list: readonly string[], code: string): string[] {
  const c = code.toUpperCase();
  return [c, ...list.filter(x => x !== c)].slice(0, RECENT_MAX);
}

/**
 * The last few destinations the viewer opened, for the "Recent" row of the
 * empty search state. Own localStorage key (not prefs); every access is
 * guarded so blocked storage just keeps the list for the session.
 */
@Injectable({ providedIn: 'root' })
export class RecentService {
  private readonly storage = inject(RECENT_STORAGE);
  private readonly state = signal<string[]>(this.load());
  readonly codes = this.state.asReadonly();

  add(code: string): void {
    if (!code || this.state()[0] === code.toUpperCase()) return;
    const next = pushRecent(this.state(), code);
    this.state.set(next);
    try {
      this.storage?.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // quota or blocked: keep the in-memory list
    }
  }

  private load(): string[] {
    try {
      const raw = JSON.parse(this.storage?.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === 'string' && /^[A-Z]{3}$/.test(x)).slice(0, RECENT_MAX)
        : [];
    } catch {
      return [];
    }
  }
}
