import { Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { diffSnapshots, isSnapshot, snapshotFor, type DestSnapshot } from '../pages/saved/saved-changes';
import { airportTz } from '../utils/airports';
import { todayKey } from '../utils/time';
import { AppStateService } from './app-state.service';

export const SAVED_SNAPSHOT_KEY = 'ac.saved-snap.v1';

/** Storage for the per-destination schedule snapshots (this device only). Null when blocked. */
export const SAVED_SNAPSHOT_STORAGE = new InjectionToken<Storage | null>('SAVED_SNAPSHOT_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * What the schedules said about each starred destination the last time the
 * viewer saw it (a star counts as seeing it; opening Saved updates it). Own
 * localStorage key, never in backups or share links. Every access is guarded.
 */
@Injectable({ providedIn: 'root' })
export class SavedSnapshotService {
  private readonly storage = inject(SAVED_SNAPSHOT_STORAGE);
  private readonly state = inject(AppStateService);
  private readonly store = signal<Record<string, DestSnapshot>>(this.load());
  readonly seen = this.store.asReadonly();

  private readonly today = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));
  private loaded(): boolean {
    this.state.scheduleRev();
    return this.state.dataLoad() !== 'failed' && !!this.state.coverage().from;
  }

  /** Starred destinations whose schedules changed since last seen: the app badge count. */
  readonly unseenCount = computed(() => {
    if (!this.loaded()) return 0;
    const today = this.today();
    const hub = this.state.hub();
    let n = 0;
    for (const code of this.state.favourites()) {
      if (diffSnapshots(this.store()[code], snapshotFor(code, today), today, hub).length) n++;
    }
    return n;
  });

  constructor() {
    // A new star starts from what the schedules say now, so only later changes show.
    effect(() => {
      if (!this.loaded()) return;
      const today = this.today();
      const favs = this.state.favourites();
      untracked(() => {
        const have = this.store();
        for (const code of favs) if (!have[code]) this.commit(code, snapshotFor(code, today));
        // An un-starred destination forgets its snapshot, so starring it again baselines fresh.
        const stale = Object.keys(have).filter(code => !favs.includes(code));
        if (stale.length) this.prune(stale);
      });
    });
  }

  commit(code: string, snap: DestSnapshot): void {
    const next = { ...this.store(), [code]: snap };
    this.store.set(next);
    try {
      this.storage?.setItem(SAVED_SNAPSHOT_KEY, JSON.stringify(next));
    } catch {
      // quota or blocked: keep the in-memory copy
    }
  }

  private prune(codes: string[]): void {
    const next = { ...this.store() };
    for (const c of codes) delete next[c];
    this.store.set(next);
    try {
      this.storage?.setItem(SAVED_SNAPSHOT_KEY, JSON.stringify(next));
    } catch {
      // keep the in-memory copy
    }
  }

  private load(): Record<string, DestSnapshot> {
    try {
      const raw = JSON.parse(this.storage?.getItem(SAVED_SNAPSHOT_KEY) ?? '{}') as Record<string, unknown>;
      const out: Record<string, DestSnapshot> = {};
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) if (/^[A-Z]{3}$/.test(k) && isSnapshot(v)) out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
}
