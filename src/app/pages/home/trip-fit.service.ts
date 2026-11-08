import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import type { Destination } from '../../data/destinations';
import { ClimateService } from '../../recs/climate.service';
import { ProfileService } from '../../recs/profile.service';
import { ReferenceService } from '../../reference/reference.service';
import { AppStateService } from '../../state/app-state.service';
import { airportTz } from '../../utils/airports';
import { weatherActive, applyTripFit, TripFitData, TripFitResult } from './trip-fit-model';

const HOUR_MS = 3_600_000;

/**
 * Applies the "Trip fit" filters (entry listings, typical weather, time zone,
 * advisory) to a list of destinations, for Home and the Map. The reference
 * and climate files load only when a filter that needs them is on or the
 * sheet asks (`prepare`), never at startup. The routes engine stays
 * synchronous: this runs after it.
 */
@Injectable({ providedIn: 'root' })
export class TripFitService {
  private readonly state = inject(AppStateService);
  private readonly profile = inject(ProfileService);
  private readonly ref = inject(ReferenceService);
  private readonly climate = inject(ClimateService);

  readonly passports = computed(() => this.profile.profile().passports);
  /** Whole hours only, so the 30 s clock tick does not recompute the lists. */
  private readonly nowHour = computed(() => Math.floor(this.state.nowMs() / HOUR_MS) * HOUR_MS);

  readonly data = computed<TripFitData>(() => {
    const key = this.state.selectedDateKey() ?? this.state.weekStartKey();
    return {
      passports: this.passports(),
      visa: this.ref.visa(),
      climate: this.climate.index(),
      advisories: this.ref.advisories(),
      todayKey: this.state.todayKey(),
      weekMonth: Number(key.slice(5, 7)) || 1,
      hubTz: airportTz(this.state.hub()),
      nowMs: this.nowHour(),
    };
  });

  /** True when a trip-fit filter is on. */
  readonly active = computed(() => {
    const f = this.state.filters();
    return f.entry !== 'any' || weatherActive(f) || f.maxTzHours != null || f.hideAdvisory;
  });

  constructor() {
    effect(() => {
      const f = this.state.filters();
      const pp = this.passports().length > 0;
      untracked(() => {
        // The row tags need the listings too, but only once a passport is set.
        if (pp) void this.ref.ensureVisa();
        if (weatherActive(f)) void this.climate.ensureLoaded();
        if (f.hideAdvisory) void this.ref.ensureLoaded();
      });
    });
  }

  /** Load what the sheet's controls will need (called when it opens). */
  prepare(): void {
    if (this.passports().length) void this.ref.ensureVisa();
    void this.climate.ensureLoaded();
    void this.ref.ensureLoaded();
  }

  /** The items that pass the active filters; reads signals, so call it inside a computed. */
  apply<T>(items: readonly T[], destOf: (x: T) => Destination): TripFitResult<T> {
    const f = this.state.filters();
    if (!this.active()) return { items: items as T[], noWeather: 0 };
    return applyTripFit(items, destOf, f, this.data());
  }
}
