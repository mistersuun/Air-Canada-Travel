import { DESTINATIONS, Destination, HUBS, Hub } from '../data/destinations';
import { getOriginCodes } from '../data/schedule-index';
import { isValidTimeZone } from './time';

/**
 * Airports that appear in the schedules but are neither a hub nor a listed
 * destination. Needed for time zones and names; the data-integrity spec fails
 * when a schedule code is in none of HUBS, DESTINATIONS or this table.
 * (Toronto Billy Bishop, YTZ, used to live here; it is a hub now.)
 */
export const EXTRA_AIRPORTS: Record<string, { name: string; tz: string; country: string }> = {};

const DEST_BY_CODE = new Map<string, Destination>(DESTINATIONS.map(d => [d.code, d]));
const HUB_BY_CODE = new Map<string, Hub>(HUBS.map(h => [h.code, h]));

/** Codes added by registerExtraAirports (replaced on the next call). */
let registered = new Set<string>();

/**
 * Adds airports from a data file (the route network's regional airports such
 * as YDF Deer Lake) so airportName/airportTz know them. Replaces the previous
 * registration; never overrides a hub, a destination or a hand-written entry.
 */
export function registerExtraAirports(
  airports: Readonly<Record<string, { name: string; tz: string; country: string }>>,
): void {
  for (const code of registered) delete EXTRA_AIRPORTS[code];
  registered = new Set();
  for (const [code, a] of Object.entries(airports)) {
    if (HUB_BY_CODE.has(code) || DEST_BY_CODE.has(code) || code in EXTRA_AIRPORTS) continue;
    if (!a?.name || !a.tz || !isValidTimeZone(a.tz)) continue;
    EXTRA_AIRPORTS[code] = { name: a.name, tz: a.tz, country: a.country };
    registered.add(code);
  }
}

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
