import { DESTINATIONS, Destination, HUBS, Hub } from '../data/destinations';
import { getOriginCodes } from '../data/schedule-index';

/**
 * Airports that appear in the schedules but are neither a hub nor a listed
 * destination. Needed for time zones and names; the data-integrity spec fails
 * when a schedule code is in none of HUBS, DESTINATIONS or this table.
 * (Toronto Billy Bishop, YTZ, used to live here; it is a hub now.)
 */
export const EXTRA_AIRPORTS: Record<string, { name: string; tz: string; country: string }> = {};

const DEST_BY_CODE = new Map<string, Destination>(DESTINATIONS.map(d => [d.code, d]));
const HUB_BY_CODE = new Map<string, Hub>(HUBS.map(h => [h.code, h]));

export function findDestination(code: string | null | undefined): Destination | null {
  return (code && DEST_BY_CODE.get(code)) || null;
}

export function findHub(code: string | null | undefined): Hub | null {
  return (code && HUB_BY_CODE.get(code)) || null;
}

export function isHub(code: string): boolean {
  return HUB_BY_CODE.has(code);
}

/** IANA zone for any known airport; 'UTC' when unknown (keeps math defined). */
export function airportTz(code: string): string {
  return HUB_BY_CODE.get(code)?.tz ?? DEST_BY_CODE.get(code)?.tz ?? EXTRA_AIRPORTS[code]?.tz ?? 'UTC';
}

/** True when the airport has a real (non-fallback) time zone. */
export function hasKnownTz(code: string): boolean {
  return HUB_BY_CODE.has(code) || DEST_BY_CODE.has(code) || code in EXTRA_AIRPORTS;
}

/** Display name: hub name, destination city, extra-airport name, else the code. */
export function airportName(code: string): string {
  return HUB_BY_CODE.get(code)?.name ?? DEST_BY_CODE.get(code)?.city ?? EXTRA_AIRPORTS[code]?.name ?? code;
}

export interface OriginInfo {
  code: string;
  name: string;
  /** True when this origin is one of the selectable home hubs. */
  isHub: boolean;
}

/**
 * Airports with published flights to `destCode`, derived from the schedule
 * index (replaces the static fromCities list). Hubs first in HUBS order, then
 * other origins alphabetically. Codes are mapped to names
 * (critique 18).
 */
export function getOrigins(destCode: string): OriginInfo[] {
  const codes = getOriginCodes(destCode);
  const hubOrder = new Map(HUBS.map((h, i) => [h.code, i]));
  return [...codes]
    .map(code => ({ code, name: airportName(code), isHub: hubOrder.has(code) }))
    .sort((a, b) => {
      if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
      if (a.isHub) return hubOrder.get(a.code)! - hubOrder.get(b.code)!;
      return a.name.localeCompare(b.name);
    });
}
