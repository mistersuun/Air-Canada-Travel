import { Injectable, Signal, afterNextRender, computed, inject, signal, untracked } from '@angular/core';
import { scheduleVersion } from '../data/schedule-index';
import { AppStateService } from '../state/app-state.service';
import { TripsService } from '../trips/trips.service';
import type { Trip } from '../trips/model';
import { ClimateService } from './climate.service';
import { RecInput, recommend } from './engine';
import type { RecGroup } from './model';
import { ProfileService } from './profile.service';

/** AC codes a set of trips already covers (goal and every flight's airports). */
export function tripCodes(trips: readonly Trip[]): string[] {
  const codes = new Set<string>();
  for (const t of trips) {
    if (t.goal.acCode) codes.add(t.goal.acCode);
    for (const leg of t.legs) {
      if (leg.kind !== 'flight') continue;
      for (const r of leg.refs) {
        codes.add(r.origin);
        codes.add(r.dest);
      }
    }
  }
  return [...codes].sort();
}

/**
 * Recommendations for Explore ("For you") and the Trips tab ("Ideas for
 * later"), recomputed when the hub, stars, connection prefs, time format,
 * profile, outcome log, active trips, today, the schedules or the climate
 * normals change. All on device; nothing is sent anywhere.
 *
 * The first compute can take ~100 ms on a cold schedule cache (every
 * destination, two long weekends), so both lists stay empty until after the
 * first render (or the first ensureClimate() call from For you / Ideas).
 * Later computes reuse the engine caches and are a few ms.
 */
@Injectable({ providedIn: 'root' })
export class RecsService {
  private readonly state = inject(AppStateService);
  private readonly trips = inject(TripsService);
  private readonly profiles = inject(ProfileService);
  private readonly climate = inject(ClimateService);
  private readonly started = signal(false);

  constructor() {
    afterNextRender(() => this.started.set(true));
  }

  /** Coarse clock: the base recomputes at most every 15 minutes as flights depart. */
  private readonly nowBucket = computed(() => Math.floor(this.state.nowMs() / 900_000));

  private readonly base = computed<Omit<RecInput, 'context'> & { version: number }>(() => ({
    profile: this.profiles.profile(),
    hub: this.state.hub(),
    todayKey: this.state.todayKey(),
    nowMs: (this.nowBucket(), untracked(() => this.state.nowMs())),
    favourites: this.state.favourites(),
    outcomes: this.trips.outcomes(),
    activeGoalCodes: tripCodes(this.trips.activeTrips()),
    climate: this.climate.index(),
    showConnections: this.state.showConnections(),
    connect: this.state.connect(),
    fmt: this.state.timeFormat(),
    version: scheduleVersion(),
  }));

  readonly forExplore: Signal<RecGroup[]> = computed(() =>
    this.started() ? recommend({ ...this.base(), context: 'explore' }) : []);
  readonly forTrips: Signal<RecGroup[]> = computed(() =>
    this.started() ? recommend({ ...this.base(), context: 'trips' }) : []);

  /** Starts the lazy climate load and the lists (call from the first render of For you / Ideas). */
  ensureClimate(): Promise<void> {
    this.started.set(true);
    return this.climate.ensureLoaded();
  }
}
