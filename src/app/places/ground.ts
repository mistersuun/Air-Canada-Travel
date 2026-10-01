/**
 * Ground estimates from a gateway airport to the place the traveller wants
 * to reach. Never a timetable: corridor rows (corridors.ts) or a distance
 * heuristic, always labelled Estimated, or Unknown when we cannot tell
 * (across the sea, between countries without a land link). Pure.
 */
import type { GroundMode, LegEnd, Place } from '../trips/model';
import { hubDisplayName } from '../ui/format';
import { findDestination, findHub } from '../utils/airports';
import { greatCircleKm } from '../utils/geo';
import { MINUTE_MS, toUtcMs, addDays, utcToLocal } from '../utils/time';
import { CORRIDORS, Corridor } from './corridors';

export interface GroundEstimate {
  mode: GroundMode | 'unknown';
  label: string;            // 'Train about 2h40', 'Bus about 6h45', 'Train about 5h30, or a short flight', 'Onward travel unknown'
  rideMin: number | null;   // the ride itself
  exitMin: number;          // airport exit + getting to the station; MAD→Atocha 90
  exitLabel: string;        // 'Passport, exit, get to Atocha'
  totalMin: number | null;  // exitMin + rideMin
  frequency: string | null; // 'trains roughly hourly'
  lastDepLocal: string | null; // usual last departure (corridor only)
  shortFlightToo: boolean;
  source: 'corridor' | 'heuristic' | 'none';
  provenance: 'estimated' | 'unknown';
}

/** Road distance ≈ 1.3 × great-circle. */
export const ROAD_FACTOR = 1.3;
export const CAR_MAX_KM = 60;
export const CAR_KMH = 50;
export const BUS_KMH = 70;
export const SHORT_FLIGHT_KM = 700;
export const HEURISTIC_EXIT_MIN = 60;
/** A leg end this close to a corridor city is that city. */
export const CORRIDOR_MATCH_KM = 25;
/** Arriving at the goal after this (gateway-local) counts as overnight. */
export const LATE_ARRIVAL = '23:30';
/** Before this hour, local times count as "late last night", not early today. */
const NIGHT_END_MIN = 5 * 60;
/** Next-morning departure assumed when the last train is missed. */
const NEXT_MORNING = '08:00';

const SCHENGEN_MAINLAND = [
  'AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IT', 'LI', 'LT', 'LU', 'LV',
  'NL', 'NO', 'PL', 'PT', 'SE', 'SI', 'SK', 'BG', 'RO', 'AD', 'MC', 'SM', 'VA',
];

/** Groups of countries joined by land (or the Channel Tunnel); any two in one group are land-connected. */
const LAND_GROUPS: readonly (readonly string[])[] = [
  SCHENGEN_MAINLAND,
  ['GB', 'FR', 'BE'],
  ['US', 'CA', 'MX'],
  ['MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA'],
  ['CO', 'EC', 'PE', 'BO', 'CL', 'AR', 'BR', 'UY', 'PY', 'VE'],
  ['CN', 'HK', 'MO'],
  ['SG', 'MY', 'TH'],
];

/** True when two countries are joined by land (same country included). */
export function landConnected(a: string, b: string): boolean {
  if (a === b) return true;
  return LAND_GROUPS.some(g => g.includes(a) && g.includes(b));
}

/**
 * Gateways on islands of a mainland country, with the island's rough radius:
 * a place beyond it (or a place on the island reached from elsewhere) needs a
 * ferry or a flight, so onward travel is unknown.
 */
export const ISLAND_GATEWAYS: Readonly<Record<string, number>> = {
  PMI: 80, TFS: 60, PDL: 50, CTA: 200, HNL: 50, OGG: 50, KOA: 120, CZM: 20, NAS: 30, GGT: 60,
};

function islandOf(p: { lat: number; lng: number }): string | null {
  for (const [code, km] of Object.entries(ISLAND_GATEWAYS)) {
    const a = findDestination(code);
    if (a && greatCircleKm(p, a) <= km) return code;
  }
  return null;
}

/** The airport code of a leg end, or the AC airport of a Place that AC serves itself. */
function codeOf(end: LegEnd | Place): string | undefined {
  return 'code' in end ? end.code : 'acCode' in end ? end.acCode : undefined;
}

function countryOf(end: LegEnd | Place): string | null {
  if ('iso2' in end && end.iso2) return end.iso2;
  const code = codeOf(end);
  if (code) return findDestination(code)?.iso2 ?? (findHub(code) ? 'CA' : null);
  return null;
}

function geonameIdOf(end: LegEnd | Place): number | null {
  const m = 'id' in end ? /^gn-(\d+)$/.exec(end.id) : null;
  return m ? Number(m[1]) : null;
}

function isAirport(end: LegEnd | Place): boolean {
  const code = 'code' in end ? end.code : undefined;
  return !!code && !!(findDestination(code) || findHub(code));
}

function cityMatches(end: LegEnd | Place, c: Corridor): boolean {
  const id = geonameIdOf(end);
  if (id !== null) return id === c.geonameId;
  return greatCircleKm(end, c) <= CORRIDOR_MATCH_KM;
}

/** The corridor between an airport end and a city end, either direction. */
export function findCorridor(from: LegEnd, to: Place | LegEnd): { row: Corridor; reverse: boolean } | null {
  for (const row of CORRIDORS) {
    if (from.code === row.code && codeOf(to) !== row.code && cityMatches(to, row)) return { row, reverse: false };
    if (codeOf(to) === row.code && from.code !== row.code && cityMatches(from, row)) return { row, reverse: true };
  }
  return null;
}

/** '2h40', '9h', '45 min'. */
export function aboutDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function unknownGround(): GroundEstimate {
  return {
    mode: 'unknown', label: 'Onward travel unknown', rideMin: null, exitMin: 0, exitLabel: '', totalMin: null,
    frequency: null, lastDepLocal: null, shortFlightToo: false, source: 'none', provenance: 'unknown',
  };
}

/**
 * How to get from `from` (usually the gateway airport) to `to` (the goal).
 * Corridor first, then the sea/country check, then the distance heuristic:
 * under 60 km by road a taxi or transit at 50 km/h, up to 700 km a bus or
 * train at 70 km/h, beyond that the same plus "or a short flight". Leaving
 * an airport adds 60 min (passport, exit).
 */
export function groundEstimate(from: LegEnd, to: Place | LegEnd): GroundEstimate {
  const hit = findCorridor(from, to);
  if (hit) {
    const { row, reverse } = hit;
    const exitMin = reverse ? 0 : row.exitMin;
    const word = row.modeLabel ?? cap(row.mode);
    return {
      mode: row.mode,
      label: `${word} about ${aboutDuration(row.rideMin)}${row.shortFlightToo ? ', or a short flight' : ''}`,
      rideMin: row.rideMin,
      exitMin,
      exitLabel: reverse ? '' : row.exitLabel,
      totalMin: exitMin + row.rideMin,
      frequency: row.frequency,
      lastDepLocal: reverse ? null : row.lastDepLocal,
      shortFlightToo: !!row.shortFlightToo,
      source: 'corridor',
      provenance: 'estimated',
    };
  }

  const a = countryOf(from);
  const b = countryOf(to);
  if (a && b && !landConnected(a, b)) return unknownGround();
  if (islandOf(from) !== islandOf(to)) return unknownGround();

  const roadKm = greatCircleKm(from, to) * ROAD_FACTOR;
  const exitMin = isAirport(from) ? HEURISTIC_EXIT_MIN : 0;
  if (roadKm < CAR_MAX_KM) {
    const ride = round5((roadKm / CAR_KMH) * 60);
    return {
      mode: 'car', label: `Taxi or transit about ${aboutDuration(ride)}`, rideMin: ride, exitMin,
      exitLabel: exitMin ? 'Passport and exit' : '', totalMin: exitMin + ride, frequency: null, lastDepLocal: null,
      shortFlightToo: false, source: 'heuristic', provenance: 'estimated',
    };
  }
  const ride = round5((roadKm / BUS_KMH) * 60);
  const far = roadKm / ROAD_FACTOR > SHORT_FLIGHT_KM;
  return {
    mode: 'bus',
    label: `Bus or train about ${aboutDuration(ride)}${far ? ', or a short flight' : ''}`,
    rideMin: ride, exitMin,
    exitLabel: exitMin ? 'Passport, exit, get to the station' : '',
    totalMin: exitMin + ride, frequency: null, lastDepLocal: null,
    shortFlightToo: far, source: 'heuristic', provenance: 'estimated',
  };
}

/** Minutes after local midnight, with 00:00–04:59 counted as the previous night (24:00–28:59). */
function nightMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const v = h * 60 + m;
  return v < NIGHT_END_MIN ? v + 1440 : v;
}

/**
 * When the traveller reaches the goal after landing at `landUtc`:
 * landing + exit + ride. If they are out of the airport after the usual last
 * departure (`lastDepMissed`), or the ride would end after 23:30 or start in
 * the small hours (`overnightLikely`), the ride is assumed to leave at 08:00
 * the next morning. utc is null when the estimate is unknown.
 */
export function arrivalAtGoal(
  landUtc: number,
  g: GroundEstimate,
  gatewayTz: string,
): { utc: number | null; overnightLikely: boolean; lastDepMissed: boolean } {
  if (g.rideMin === null || g.totalMin === null) return { utc: null, overnightLikely: false, lastDepMissed: false };
  const readyUtc = landUtc + g.exitMin * MINUTE_MS;
  const ready = utcToLocal(readyUtc, gatewayTz);
  const readyMin = nightMin(ready.hhmm);
  const lastDepMissed = !!g.lastDepLocal && readyMin > nightMin(g.lastDepLocal);
  const endUtc = readyUtc + g.rideMin * MINUTE_MS;
  const end = utcToLocal(endUtc, gatewayTz);
  const smallHours = readyMin >= 1440;
  const endsLate = end.dateKey !== ready.dateKey || nightMin(end.hhmm) > nightMin(LATE_ARRIVAL);
  const overnightLikely = lastDepMissed || smallHours || endsLate;
  if (!overnightLikely) return { utc: endUtc, overnightLikely, lastDepMissed };
  // The night before 05:00 belongs to the previous evening: leave that same calendar morning.
  const morningKey = smallHours ? ready.dateKey : addDays(ready.dateKey, 1);
  const leaveUtc = toUtcMs(morningKey, NEXT_MORNING, gatewayTz);
  return { utc: leaveUtc + g.rideMin * MINUTE_MS, overnightLikely, lastDepMissed };
}

function rome2rioName(end: LegEnd): string {
  const name = end.code && isAirport(end) ? `${end.name} ${end.code} Airport` : end.name;
  return encodeURIComponent(name.trim().replace(/\s+/g, '-'));
}

/** Where to look up real trains and buses (external sites; need internet). */
export function onwardLinks(from: LegEnd, to: LegEnd): { google: string; rome2rio: string; omio: string; skyscanner: string } {
  const ll = (p: LegEnd) => `${round4(p.lat)},${round4(p.lng)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=transit`,
    rome2rio: `https://www.rome2rio.com/map/${rome2rioName(from)}/${rome2rioName(to)}`,
    omio: 'https://www.omio.com/',
    skyscanner: 'https://www.skyscanner.ca/',
  };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A gateway airport as a leg end ('Madrid', MAD). */
export function airportEnd(code: string): LegEnd | null {
  const d = findDestination(code);
  if (d) return { name: d.city, lat: d.lat, lng: d.lng, code: d.code, tz: d.tz };
  const h = findHub(code);
  if (h) return { name: hubDisplayName(h.code), lat: h.lat, lng: h.lng, code: h.code, tz: h.tz };
  return null;
}

/** A place as a leg end. */
export function placeEnd(p: Place): LegEnd {
  const end: LegEnd = { name: p.name, lat: p.lat, lng: p.lng, tz: p.tz };
  if (p.acCode) end.code = p.acCode;
  return end;
}
