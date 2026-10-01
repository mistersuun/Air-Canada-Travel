import { Signal, computed, effect, inject, untracked } from '@angular/core';
import { CityIndexService } from '../../places/city-index.service';
import { parsePlaceId } from '../../places/place';
import type { Place } from '../../trips/model';

export type PlaceState =
  | { kind: 'loading' }
  | { kind: 'error' }          // cities.json could not be loaded (offline before first use, or missing)
  | { kind: 'unknown' }        // malformed or not in the index
  | { kind: 'ready'; place: Place };

/**
 * Resolves a /reach/:place id ('gn-2510911' or 'ac-LIS') to a Place,
 * loading the city index when needed. Call in an injection context.
 */
export function reachPlace(id: Signal<string>): { state: Signal<PlaceState>; retry: () => void } {
  const cities = inject(CityIndexService);
  effect(() => {
    const p = parsePlaceId(id());
    if (p?.kind === 'gn') untracked(() => void cities.ensureLoaded());
  });
  const state = computed<PlaceState>(() => {
    const p = parsePlaceId(id());
    if (!p) return { kind: 'unknown' };
    if (p.kind === 'gn') {
      const status = cities.status();
      if (status === 'error') return { kind: 'error' };
      if (status !== 'ready') return { kind: 'loading' };
    }
    const place = cities.byId(id());
    return place ? { kind: 'ready', place } : { kind: 'unknown' };
  });
  return { state, retry: () => void cities.ensureLoaded() };
}
