/**
 * Reach: which AC gateways get a traveller from their hub to a place AC does
 * not fly to (Seville → Madrid, Lisbon, Barcelona, Porto), with the flights
 * that day and the estimated ground trip. Pure; reads schedules only through
 * the engine (flightsOn, directItineraries, findItineraries, isCovered).
 */
import { DESTINATIONS, HUBS } from '../data/destinations';
import { isCovered } from '../data/schedule-index';
import type { Place } from '../trips/model';
import { airportTz } from '../utils/airports';
import { ConnectOptions, Itinerary, compareItineraries, directItineraries, findItineraries } from '../utils/connections';
import { greatCircleKm } from '../utils/geo';
import { addDays } from '../utils/time';
import { FlightInstance, flightsOn, nextFlightDate } from '../utils/week';
import { GroundEstimate, airportEnd, arrivalAtGoal, groundEstimate } from './ground';

export type ReachSort = 'onward' | 'flights';

export interface ReachQuery {
  place: Place; hub: string; dateKey: string;
  includeOtherHubs: boolean; sort: ReachSort; connect: ConnectOptions;
  radiusKm?: number;        // default 900 (BCN–Seville is ~830 km)
  maxGateways?: number;     // default 6
}

export interface Gateway {
  code: string; city: string; distanceKm: number;
  itineraries: Itinerary[];        // hub → code that date: nonstops first; plus one-stop via other Canadian hubs when includeOtherHubs
  directCount: number;
  standbyLegs: number;             // legs in the best itinerary (1 nonstop, 2 via a hub); 0 when none
  nextDateKey: string | null;      // when none that date: next date with a flight within 14 days
  covered: boolean;                // date inside hub coverage
  ground: GroundEstimate;
  arriveGoalUtc: number | null;    // best itinerary arrival + ground
  overnightLikely: boolean;
  lastDepMissed: boolean;
}

export const DEFAULT_REACH_RADIUS_KM = 900;
export const DEFAULT_MAX_GATEWAYS = 6;
/** How far ahead "next Fri Oct 9" looks. */
export const NEXT_FLIGHT_WINDOW_DAYS = 14;

/** AC destinations and hubs within `radiusKm` of the place, nearest first (the place's own airport excluded). */
export function gatewaysNear(place: Place, radiusKm = DEFAULT_REACH_RADIUS_KM): { code: string; km: number }[] {
  const out: { code: string; km: number }[] = [];
  const seen = new Set<string>();
  for (const a of [...DESTINATIONS, ...HUBS]) {
    if (seen.has(a.code) || a.code === place.acCode) continue;
    seen.add(a.code);
    const km = greatCircleKm(place, a);
    if (km <= radiusKm) out.push({ code: a.code, km: Math.round(km) });
  }
  return out.sort((a, b) => a.km - b.km || a.code.localeCompare(b.code));
}

function itinerariesTo(hub: string, code: string, dateKey: string, q: ReachQuery): { its: Itinerary[]; direct: number } {
  const direct = directItineraries(hub, code, dateKey);
  const via = q.includeOtherHubs ? [...findItineraries(hub, code, dateKey, q.connect)].sort(compareItineraries) : [];
  return { its: [...direct, ...via], direct: direct.length };
}

function nextDateWithFlight(hub: string, code: string, dateKey: string, q: ReachQuery): string | null {
  const last = addDays(dateKey, NEXT_FLIGHT_WINDOW_DAYS);
  const direct = nextFlightDate(hub, code, dateKey, false);
  let best = direct && direct <= last ? direct : null;
  if (q.includeOtherHubs) {
    for (let k = addDays(dateKey, 1); k <= last && (best === null || k < best); k = addDays(k, 1)) {
      if (findItineraries(hub, code, k, q.connect).length) {
        best = k;
        break;
      }
    }
  }
  return best;
}

/**
 * The gateways for a reach search, split into those with a known onward
 * estimate and those where onward travel is unknown (across the sea, e.g.
 * Casablanca → Seville).
 *
 * Order: gateways with a flight that date first, by arrival at the goal
 * ('onward') or by number of itineraries, then arrival ('flights'); then the
 * ones without a flight that date, nearest first (the UI says "No flight
 * found Thu Oct 8", with the next date within 14 days when there is one).
 * The trip's own hub is never a gateway.
 */
export function reachGateways(q: ReachQuery): { gateways: Gateway[]; unknownOnward: Gateway[] } {
  const max = q.maxGateways ?? DEFAULT_MAX_GATEWAYS;
  const goal = q.place;
  const known: Gateway[] = [];
  const unknown: Gateway[] = [];
  for (const { code, km } of gatewaysNear(goal, q.radiusKm ?? DEFAULT_REACH_RADIUS_KM)) {
    if (code === q.hub) continue;
    const end = airportEnd(code);
    if (!end) continue;
    const covered = isCovered(q.dateKey, q.hub);
    const { its, direct } = itinerariesTo(q.hub, code, q.dateKey, q);
    const nextDateKey = its.length ? null : nextDateWithFlight(q.hub, code, q.dateKey, q);
    const best = its[0] ?? null;
    // The timetable day is the day the best flight lands (local at the gateway).
    const ground = groundEstimate(end, goal, { dateKey: best?.arrDateKey ?? q.dateKey });
    const arrival = best ? arrivalAtGoal(best.arriveUtc, ground, airportTz(code)) : null;
    const g: Gateway = {
      code,
      city: end.name,
      distanceKm: km,
      itineraries: its,
      directCount: direct,
      standbyLegs: best ? best.legs.length : 0,
      nextDateKey,
      covered,
      ground,
      arriveGoalUtc: arrival?.utc ?? null,
      overnightLikely: arrival?.overnightLikely ?? false,
      lastDepMissed: arrival?.lastDepMissed ?? false,
    };
    (ground.mode === 'unknown' ? unknown : known).push(g);
  }
  return { gateways: sortGateways(known, q.sort).slice(0, max), unknownOnward: sortGateways(unknown, q.sort).slice(0, max) };
}

const INF = Number.POSITIVE_INFINITY;

function byArrival(a: Gateway, b: Gateway): number {
  return (a.arriveGoalUtc ?? INF) - (b.arriveGoalUtc ?? INF)
    || (a.ground.totalMin ?? INF) - (b.ground.totalMin ?? INF)
    || a.distanceKm - b.distanceKm;
}

export function sortGateways(list: Gateway[], sort: ReachSort): Gateway[] {
  const flying = list.filter(g => g.itineraries.length);
  const idle = list.filter(g => !g.itineraries.length);
  flying.sort(sort === 'flights' ? (a, b) => b.itineraries.length - a.itineraries.length || byArrival(a, b) : byArrival);
  idle.sort((a, b) => a.distanceKm - b.distanceKm || a.code.localeCompare(b.code));
  return [...flying, ...idle];
}

/**
 * "Other airports home": the direct flights from each airport to any of the
 * home hubs on each date ('Madrid MAD · Mon: AC835 to YUL, AC825 to YYZ').
 */
export function homeOptionsByAirport(
  codes: string[],
  homeHubs: string[],
  dateKeys: string[],
): { code: string; days: { dateKey: string; flights: FlightInstance[] }[] }[] {
  return codes.map(code => ({
    code,
    days: dateKeys.map(dateKey => ({
      dateKey,
      flights: homeHubs
        .filter(h => h !== code)
        .flatMap(h => flightsOn(code, h, dateKey))
        .sort((a, b) => a.depUtc - b.depUtc),
    })),
  }));
}
