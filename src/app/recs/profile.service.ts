import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { PROFILE_KEY, TravelProfile } from './model';
import { EMPTY_PROFILE, MAX_DISMISSED, profileSummary, sanitizeProfile, sanitizeUsualItems } from './profile';

/** Storage backing the travel profile (same pattern as PREFS_STORAGE). Null when blocked. */
export const PROFILE_STORAGE = new InjectionToken<Storage | null>('PROFILE_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null; // SecurityError when site data is blocked
    }
  },
});

/**
 * The travel profile (extras spec §5.1), persisted in localStorage['ac.profile.v1'].
 * Never in share links or backups. With storage blocked it lives for the session.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly storage = inject(PROFILE_STORAGE);
  private readonly state = signal<TravelProfile>(this.load());
  /** Clock for updatedAt; tests may replace it. */
  now: () => number = () => Date.now();

  readonly profile = this.state.asReadonly();
  readonly isEmpty = computed(() => this.state().updatedAt === null);

  /** Merge a patch, mark the profile as set up and save it. */
  update(patch: Partial<Omit<TravelProfile, 'v' | 'updatedAt'>>): void {
    this.set(sanitizeProfile({ ...this.state(), ...patch, updatedAt: new Date(this.now()).toISOString() }));
  }

  /** Back to the empty profile ("Not set up"). */
  reset(): void {
    this.set({ ...EMPTY_PROFILE, styles: [], days: [], dismissed: [], usualItems: [] });
  }

  /** Hide a recommendation ("Not for me"). Does not mark the profile as set up. */
  dismiss(recId: string): void {
    const p = this.state();
    if (!recId || p.dismissed.includes(recId)) return;
    this.set(sanitizeProfile({ ...p, dismissed: [...p.dismissed, recId].slice(-MAX_DISMISSED) }));
  }

  /** Undo a dismiss. */
  undismiss(recId: string): void {
    const p = this.state();
    if (!p.dismissed.includes(recId)) return;
    this.set({ ...p, dismissed: p.dismissed.filter(id => id !== recId) });
  }

  /** Add one usual item (false when blank, a duplicate or the list is full). Marks the profile as set up. */
  addUsualItem(text: string): boolean {
    const have = this.state().usualItems;
    const next = sanitizeUsualItems([...have, text]);
    if (next.length === have.length) return false;
    this.update({ usualItems: next });
    return true;
  }

  /** True when the text (normalised like a saved item) is already in the list. */
  hasUsualItem(text: string): boolean {
    const [t] = sanitizeUsualItems([text]);
    return !!t && this.state().usualItems.some(i => i.toLowerCase() === t.toLowerCase());
  }

  removeUsualItem(text: string): void {
    this.update({ usualItems: this.state().usualItems.filter(i => i !== text) });
  }

  /** 'City, Sun · long weekends · up to 7h · Thu–Mon', or 'Not set up'. */
  summary(): string {
    return profileSummary(this.state());
  }

  private set(p: TravelProfile): void {
    this.state.set(p);
    try {
      this.storage?.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      // Quota or blocked storage: keep the in-memory value.
    }
  }

  private load(): TravelProfile {
    try {
      const raw = this.storage?.getItem(PROFILE_KEY);
      return sanitizeProfile(raw ? JSON.parse(raw) : null);
    } catch {
      return sanitizeProfile(null);
    }
  }
}
