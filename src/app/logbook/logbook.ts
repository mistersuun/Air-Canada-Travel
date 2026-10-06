/**
 * Logbook (F3): what you have actually flown, counted from boarded flights
 * only. Pure: everything here is computed from the flight log and the trips,
 * nothing is stored. Facts and counts, never odds.
 *
 * A boarded flight comes from either place it can be recorded: a flight-log
 * outcome (allBoarded / someBoarded) or a trip flight leg with status
 * 'boarded'. Both name the same flight instance by instanceKey
 * (flightNumber|origin|dateKey), so each flight is counted once.
 */
import { networkAirport } from '../data/route-network';
import { countryName } from '../places/place';
import { FlightLeg, FlightLog, FlightRef, Outcome, Trip, instanceKey, isFinalStatus } from '../trips/model';
import { aircraftName } from '../utils/aircraft';
import { findDestination, findHub } from '../utils/airports';
import { greatCircleKm } from '../utils/geo';

/** Equatorial circumference, km: the "× around the Earth" unit. */
export const EARTH_CIRCUMFERENCE_KM = 40075;

export interface AirportInfo {
  code: string;
  city: string;
  country: string;
  iso2: string;
  lat: number;
  lng: number;
  /** A destinations.ts region, 'Canada' for a hub, 'Other' for a regional airport. */
  region: string;
}

/** Hub, listed destination or route-network airport; null when we have no position for it. */
export function airportInfo(code: string): AirportInfo | null {
  const h = findHub(code);
  if (h) return { code, city: h.name, country: 'Canada', iso2: 'CA', lat: h.lat, lng: h.lng, region: 'Canada' };
  const d = findDestination(code);
  if (d) return { code, city: d.city, country: d.country, iso2: d.iso2, lat: d.lat, lng: d.lng, region: d.region };
  const n = networkAirport(code);
  if (n) {
    return {
      code, city: n.name, country: countryName(n.iso2) || n.iso2, iso2: n.iso2, lat: n.lat, lng: n.lng, region: 'Other',
    };
  }
  return null;
}

/** Times and equipment for a flight the log only names (outcomes carry none). */
export interface FlightDetail {
  aircraft: string | null;
  depLocal: string;
  arrLocal: string;
  arrDateKey: string;
}
export type DetailResolver = (f: { flightNumber: string; origin: string; dest: string; dateKey: string }) => FlightDetail | null;

export interface BoardedFlight {
  key: string;
  flightNumber: string;
  origin: string;
  dest: string;
  dateKey: string;
  depLocal: string | null;
  arrLocal: string | null;
  arrDateKey: string | null;
  aircraft: string | null;
  /** Great-circle km; null when an airport's position is unknown. */
  km: number | null;
}

function kmBetween(origin: string, dest: string): number | null {
  const a = airportInfo(origin);
  const b = airportInfo(dest);
  return a && b ? greatCircleKm(a, b) : null;
}

function fromRef(r: FlightRef): BoardedFlight {
  return {
    key: instanceKey(r), flightNumber: r.flightNumber, origin: r.origin, dest: r.dest, dateKey: r.dateKey,
    depLocal: r.depLocal || null, arrLocal: r.arrLocal || null, arrDateKey: r.arrDateKey || null,
    aircraft: r.aircraft, km: kmBetween(r.origin, r.dest),
  };
}

/** Boarded flights of one trip (every segment of a boarded flight leg). */
export function tripBoardedFlights(trip: Trip): BoardedFlight[] {
  const out: BoardedFlight[] = [];
  const seen = new Set<string>();
  for (const leg of trip.legs) {
    if (leg.kind !== 'flight' || leg.status !== 'boarded') continue;
    for (const r of (leg as FlightLeg).refs) {
      const k = instanceKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(fromRef(r));
    }
  }
  return out;
}

/**
 * Every boarded flight, once, oldest first. Trip legs win over outcomes for
 * the same instance (they carry times and equipment); `resolve` fills those
 * in for outcomes.
 */
export function boardedFlights(
  log: Pick<FlightLog, 'outcomes'> | null | undefined,
  trips: readonly Trip[] | null | undefined,
  resolve?: DetailResolver,
): BoardedFlight[] {
  const byKey = new Map<string, BoardedFlight>();
  for (const t of trips ?? []) for (const f of tripBoardedFlights(t)) if (!byKey.has(f.key)) byKey.set(f.key, f);
  for (const o of log?.outcomes ?? []) {
    if (o.kind !== 'allBoarded' && o.kind !== 'someBoarded') continue;
    const k = instanceKey(o);
    if (byKey.has(k)) continue;
    if (contradictedByLeg(o, trips)) continue;
    const d = resolve?.(o) ?? null;
    byKey.set(k, {
      key: k, flightNumber: o.flightNumber, origin: o.origin, dest: o.dest, dateKey: o.dateKey,
      depLocal: d?.depLocal ?? null, arrLocal: d?.arrLocal ?? null, arrDateKey: d?.arrDateKey ?? null,
      aircraft: d?.aircraft ?? null, km: kmBetween(o.origin, o.dest),
    });
  }
  return [...byKey.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.key.localeCompare(b.key));
}

/**
 * True when a trip leg says this outcome's flight was not boarded: the leg
 * (same trip, or any trip when the outcome has none) ended notBoarded /
 * didntTry / abandoned and the flight is the leg's last segment. A boarded
 * first segment of a one-stop leg is kept.
 */
function contradictedByLeg(o: Outcome, trips: readonly Trip[] | null | undefined): boolean {
  const k = instanceKey(o);
  for (const t of trips ?? []) {
    if (o.tripId && t.id !== o.tripId) continue;
    for (const l of t.legs) {
      if (l.kind !== 'flight' || l.status === 'boarded' || !isFinalStatus(l.status)) continue;
      const last = l.refs[l.refs.length - 1];
      if (last && instanceKey(last) === k) return true;
    }
  }
  return false;
}

export interface RouteCount { a: string; b: string; count: number }
export interface AircraftCount { code: string; name: string; count: number }
export interface LogbookStats {
  flights: number;
  /** Rounded great-circle km of flights with known airports. */
  km: number;
  /** km / 40,075, unrounded. */
  aroundEarth: number;
  countries: { iso2: string; name: string }[];
  cities: string[];
  longest: { origin: string; dest: string; km: number; flightNumber: string; dateKey: string } | null;
  /** The route flown most often, both directions together; null until one is flown twice. */
  mostFlownRoute: RouteCount | null;
  aircraft: AircraftCount[];
}

export function logbookStats(
  log: Pick<FlightLog, 'outcomes'> | null | undefined,
  trips: readonly Trip[] | null | undefined,
  resolve?: DetailResolver,
): LogbookStats {
  return statsOf(boardedFlights(log, trips, resolve));
}

/** The stats of an already-built list of boarded flights. */
export function statsOf(flights: readonly BoardedFlight[]): LogbookStats {
  let km = 0;
  let longest: LogbookStats['longest'] = null;
  const countries = new Map<string, string>();
  const cities = new Set<string>();
  const routes = new Map<string, RouteCount>();
  const aircraft = new Map<string, number>();

  for (const f of flights) {
    if (f.km !== null) {
      km += f.km;
      if (!longest || f.km > longest.km) {
        longest = { origin: f.origin, dest: f.dest, km: Math.round(f.km), flightNumber: f.flightNumber, dateKey: f.dateKey };
      }
    }
    for (const code of [f.origin, f.dest]) {
      const a = airportInfo(code);
      if (!a) continue;
      if (!countries.has(a.iso2)) countries.set(a.iso2, a.country);
      cities.add(a.city);
    }
    const [x, y] = f.origin < f.dest ? [f.origin, f.dest] : [f.dest, f.origin];
    const rk = `${x}-${y}`;
    const r = routes.get(rk) ?? { a: x, b: y, count: 0 };
    r.count++;
    routes.set(rk, r);
    if (f.aircraft) aircraft.set(f.aircraft, (aircraft.get(f.aircraft) ?? 0) + 1);
  }

  const best = [...routes.values()].sort((p, q) =>
    q.count - p.count || (kmBetween(q.a, q.b) ?? 0) - (kmBetween(p.a, p.b) ?? 0) || `${p.a}${p.b}`.localeCompare(`${q.a}${q.b}`))[0];

  return {
    flights: flights.length,
    km: Math.round(km),
    aroundEarth: km / EARTH_CIRCUMFERENCE_KM,
    countries: [...countries].map(([iso2, name]) => ({ iso2, name })).sort((p, q) => p.name.localeCompare(q.name)),
    cities: [...cities].sort((p, q) => p.localeCompare(q)),
    longest,
    mostFlownRoute: best && best.count >= 2 ? best : null,
    aircraft: [...aircraft]
      .map(([code, count]) => ({ code, name: aircraftName(code), count }))
      .sort((p, q) => q.count - p.count || p.name.localeCompare(q.name)),
  };
}

/** '0.3 × around the Earth'; '' below 0.05 (a short hop is not worth a fraction). */
export function aroundEarthLabel(n: number): string {
  if (!(n >= 0.05)) return '';
  const v = Math.round(n * 10) / 10;
  return `${v.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} × around the Earth`;
}

// ---- Trip recap ---------------------------------------------------------

/** True when one of the trip's flight legs on the way back is boarded. */
export function returnBoarded(trip: Trip): boolean {
  return trip.legs.some(l => l.kind === 'flight' && l.role === 'return' && l.status === 'boarded');
}

export interface TripRecap {
  flights: number;
  km: number;
  countries: number;
  /** Flight legs that were tried (boarded or not boarded). */
  tries: number;
  boarded: number;
}

/** Counts for the recap card; booking codes and passes never enter. */
export function tripRecap(trip: Trip, outcomes: readonly Outcome[] = []): TripRecap {
  // Same flights the logbook counts: the trip's boarded legs plus its own recorded outcomes.
  const own = outcomes.filter(o => o.tripId === trip.id);
  const s = statsOf(boardedFlights({ outcomes: own }, [trip]));
  const flightLegs = trip.legs.filter((l): l is FlightLeg => l.kind === 'flight');
  const boarded = flightLegs.filter(l => l.status === 'boarded').length;
  const notBoarded = flightLegs.filter(l => l.status === 'notBoarded').length;
  return { flights: s.flights, km: s.km, countries: s.countries.length, tries: boarded + notBoarded, boarded };
}

/** '4 flights · 11,240 km · 2 countries' (singulars handled). */
export function recapLine(r: Pick<TripRecap, 'flights' | 'km' | 'countries'>): string {
  const parts = [`${r.flights} ${r.flights === 1 ? 'flight' : 'flights'}`];
  if (r.km > 0) parts.push(`${r.km.toLocaleString('en-CA')} km`);
  if (r.countries > 0) parts.push(`${r.countries} ${r.countries === 1 ? 'country' : 'countries'}`);
  return parts.join(' · ');
}

/** 'Boarded 3 of 4 tries'. */
export function standbyRecordLine(r: Pick<TripRecap, 'tries' | 'boarded'>): string {
  return `Boarded ${r.boarded} of ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}`;
}
