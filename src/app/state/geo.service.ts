import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

export const LAND_URL = 'data/land-110m.json';

/** Fetches the land TopoJSON; specs replace it. */
export const LAND_FETCH = new InjectionToken<() => Promise<unknown>>('LAND_FETCH', {
  providedIn: 'root',
  factory: () => async () => {
    const res = await fetch(LAND_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
});

export type LandCollection = FeatureCollection<Geometry>;

/** world-atlas land-110m (Natural Earth, ISC) → a GeoJSON FeatureCollection. */
export function topologyToLand(topo: unknown): LandCollection | null {
  const t = topo as Topology<{ land: GeometryCollection }> | null;
  if (!t || t.type !== 'Topology' || !t.objects?.land) return null;
  const f = feature(t, t.objects.land) as unknown as LandCollection | { type: 'Feature' };
  if (f.type === 'FeatureCollection') return f as LandCollection;
  return { type: 'FeatureCollection', features: [f as never] };
}

/**
 * Land outlines for ui/route-map. Fetched lazily, once, the first time a map
 * asks (the service worker prefetches /data/*.json, so maps work offline).
 * Only route-map imports this service, which keeps topojson out of the
 * initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class GeoService {
  private readonly fetcher = inject(LAND_FETCH);
  private readonly landSig = signal<LandCollection | null>(null);
  private pending: Promise<void> | null = null;

  /** Null until loaded (or when loading failed). */
  readonly land = this.landSig.asReadonly();

  /** Start loading (idempotent). Never rejects. */
  ensureLoaded(): Promise<void> {
    this.pending ??= this.fetcher()
      .then(topo => this.landSig.set(topologyToLand(topo)))
      .catch(() => {
        this.pending = null; // allow a retry on the next map
      });
    return this.pending ?? Promise.resolve();
  }
}
