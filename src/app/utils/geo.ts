/**
 * Great-circle distance helpers (the only geography the engine needs; map
 * projection lives in ui/route-map with d3-geo).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Mean Earth radius in km (IUGG). */
export const EARTH_RADIUS_KM = 6371;

const RAD = Math.PI / 180;

/** Haversine distance in km between two points. */
export function greatCircleKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** '10,354 km' (rounded, en-CA grouping). */
export function formatKm(n: number): string {
  return `${Math.round(n).toLocaleString('en-CA')} km`;
}

/** The closest of `places` to `from` by great-circle distance, or null when there are none. Pure: nothing is stored. */
export function nearestTo<T extends LatLng>(from: LatLng, places: readonly T[]): { place: T; km: number } | null {
  let best: { place: T; km: number } | null = null;
  for (const p of places) {
    const km = greatCircleKm(from, p);
    if (!best || km < best.km) best = { place: p, km };
  }
  return best;
}
