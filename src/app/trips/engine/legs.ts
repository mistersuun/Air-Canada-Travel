/**
 * Trip legs ↔ the schedule engine (spec §2.1). Pure; reads schedules only
 * through flightsOn / segmentFlights.
 */
import { segmentFlights, type Itinerary } from '../../utils/connections';
import { airportTz } from '../../utils/airports';
import { MINUTE_MS, diffDays, toUtcMs } from '../../utils/time';
import { flightsOn, type FlightInstance } from '../../utils/week';
import { FlightLeg, FlightRef, Trip, TripLeg, isFinalStatus } from '../model';

/** Flight number stored for an estimated (unnumbered) leg. */
export const ESTIMATED_FLIGHT = 'EST';

export function refFromInstance(f: FlightInstance): FlightRef {
  return {
    flightNumber: f.flightNumber ?? ESTIMATED_FLIGHT,
    origin: f.origin,
    dest: f.dest,
    dateKey: f.dateKey,
    depLocal: f.depLocal,
    arrLocal: f.arrLocal,
    arrDateKey: f.arrDateKey,
    aircraft: f.aircraft,
  };
}

export function refsFromItinerary(it: Itinerary): FlightRef[] {
  return it.legs.map(refFromInstance);
}

/** The current scheduled instance of a ref (its flight number or an alternate number), or null. */
export function resolveRef(ref: FlightRef): FlightInstance | null {
  if (ref.flightNumber === ESTIMATED_FLIGHT) {
    return segmentFlights(ref.origin, ref.dest, ref.dateKey).find(f => f.estimated && f.depLocal === ref.depLocal) ?? null;
  }
  const want = norm(ref.flightNumber);
  return flightsOn(ref.origin, ref.dest, ref.dateKey).find(f =>
    (f.flightNumber && norm(f.flightNumber) === want) || (f.altFlightNumbers ?? []).some(a => norm(a) === want),
  ) ?? null;
}

function norm(n: string): string {
  return n.replace(/\s+/g, '').toUpperCase();
}

/** An Itinerary from instances (same shape the connection engine builds). */
export function buildItinerary(legs: FlightInstance[]): Itinerary {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const layovers: number[] = [];
  for (let i = 1; i < legs.length; i++) layovers.push(Math.round((legs[i].depUtc - legs[i - 1].arrUtc) / MINUTE_MS));
  return {
    legs,
    layovers,
    totalMin: Math.round((last.arrUtc - first.depUtc) / MINUTE_MS),
    departUtc: first.depUtc,
    arriveUtc: last.arrUtc,
    estimated: legs.some(l => l.estimated),
    hubs: legs.slice(0, -1).map(l => l.dest),
    origin: first.origin,
    dest: last.dest,
    dateKey: first.dateKey,
    arrDateKey: last.arrDateKey,
    arrDayOffset: diffDays(first.dateKey, last.arrDateKey),
  };
}

/** The itinerary of a leg's refs in the current data; null if any segment is unresolved. */
export function itineraryFromRefs(refs: FlightRef[]): Itinerary | null {
  if (!refs.length) return null;
  const legs: FlightInstance[] = [];
  for (const r of refs) {
    const f = resolveRef(r);
    if (!f) return null;
    legs.push(f);
  }
  return buildItinerary(legs);
}

/** An instance rebuilt from the snapshot alone (offline display, diffs); never touches the schedules. */
export function instanceFromRef(ref: FlightRef): FlightInstance {
  const depUtc = refDepUtc(ref);
  const arrUtc = refArrUtc(ref);
  return {
    flightNumber: ref.flightNumber === ESTIMATED_FLIGHT ? null : ref.flightNumber,
    origin: ref.origin,
    dest: ref.dest,
    dateKey: ref.dateKey,
    depLocal: ref.depLocal,
    arrLocal: ref.arrLocal,
    arrDateKey: ref.arrDateKey,
    depUtc,
    arrUtc,
    arrDayOffset: diffDays(ref.dateKey, ref.arrDateKey),
    durationMin: Math.round((arrUtc - depUtc) / MINUTE_MS),
    aircraft: ref.aircraft,
    estimated: ref.flightNumber === ESTIMATED_FLIGHT,
  };
}

/** The saved itinerary of refs, from the snapshot (no schedule lookup). */
export function itineraryFromSnapshot(refs: FlightRef[]): Itinerary | null {
  return refs.length ? buildItinerary(refs.map(instanceFromRef)) : null;
}

export function refDepUtc(ref: FlightRef): number {
  return toUtcMs(ref.dateKey, ref.depLocal, airportTz(ref.origin));
}

export function refArrUtc(ref: FlightRef): number {
  return toUtcMs(ref.arrDateKey, ref.arrLocal, airportTz(ref.dest));
}

/** Time zone of a ground leg end: its own, else its airport's, else null. */
export function endTz(end: { tz?: string | null; code?: string }): string | null {
  if (end.tz) return end.tz;
  if (end.code) return airportTz(end.code);
  return null;
}

/** Minutes after a flight lands before an unsaved ground leg from that airport is placed. */
export const GROUND_AFTER_ARRIVAL_MIN = 45;
/** Minutes before a flight leaves that an unsaved ground leg to that airport should arrive. */
export const GROUND_BEFORE_DEPARTURE_MIN = 120;

/**
 * The leg's span as instants. Flights: first departure to last arrival.
 * Ground: the saved times, else the planned day at 12:00 plus the estimate.
 * With the trip's legs, an unsaved ground leg is anchored to the flights it
 * connects: no earlier than 45 min after a flight lands at its start airport
 * (dated on that flight's departure or arrival day), else arriving at least
 * 2 h before a flight leaves its end airport that day.
 */
export function legWindow(leg: TripLeg, legs?: readonly TripLeg[]): { depUtc: number; arrUtc: number } | null {
  if (leg.kind === 'flight') {
    if (!leg.refs.length) return null;
    return { depUtc: refDepUtc(leg.refs[0]), arrUtc: refArrUtc(leg.refs[leg.refs.length - 1]) };
  }
  const fromTz = endTz(leg.from) ?? 'UTC';
  const toTz = endTz(leg.to) ?? fromTz;
  if (leg.userTimes) {
    const t = leg.userTimes;
    return { depUtc: toUtcMs(t.depDateKey, t.depLocal, fromTz), arrUtc: toUtcMs(t.arrDateKey, t.arrLocal, toTz) };
  }
  const est = (leg.estMinutes ?? 0) * MINUTE_MS;
  let depUtc = toUtcMs(leg.dateKey, '12:00', fromTz);
  const flights = (legs ?? []).filter((l): l is FlightLeg => l.kind === 'flight' && l.refs.length > 0 && l.status !== 'abandoned');
  const feeding = leg.from.code
    ? flights
      .map(l => ({ first: l.refs[0], last: l.refs[l.refs.length - 1] }))
      .filter(({ first, last }) => last.dest === leg.from.code && (last.arrDateKey === leg.dateKey || first.dateKey === leg.dateKey))
      .map(({ last }) => refArrUtc(last))
    : [];
  if (feeding.length) {
    depUtc = Math.max(depUtc, Math.max(...feeding) + GROUND_AFTER_ARRIVAL_MIN * MINUTE_MS);
  } else if (leg.to.code) {
    const leaving = flights
      .map(l => l.refs[0])
      .filter(r => r.origin === leg.to.code && r.dateKey === leg.dateKey)
      .map(refDepUtc);
    if (leaving.length) depUtc = Math.min(depUtc, Math.min(...leaving) - GROUND_BEFORE_DEPARTURE_MIN * MINUTE_MS - est);
  }
  return { depUtc, arrUtc: depUtc + est };
}

/** Departure instant used to keep legs chronological (pass the trip's legs to anchor unsaved ground legs). */
export function legStartUtc(leg: TripLeg, legs?: readonly TripLeg[]): number {
  return legWindow(leg, legs)?.depUtc ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Legs in chronological order by departure (stable for ties). A ground leg
 * planned without times sorts after the flight that lands at its start
 * airport (see legWindow).
 */
export function sortLegs(legs: readonly TripLeg[]): TripLeg[] {
  return legs
    .map((leg, i) => ({ leg, i, t: legStartUtc(leg, legs) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(x => x.leg);
}

/** The first leg that is not done yet (Planned, Listed or Checked in), or null. */
export function nextOpenLeg(trip: Trip, _nowMs: number): TripLeg | null {
  return trip.legs.find(l => !isFinalStatus(l.status)) ?? null;
}

/** True when two ref lists describe the same flights (number, route, date). */
export function sameRefs(a: readonly FlightRef[], b: readonly FlightRef[]): boolean {
  return a.length === b.length && a.every((r, i) =>
    norm(r.flightNumber) === norm(b[i].flightNumber) && r.origin === b[i].origin && r.dest === b[i].dest && r.dateKey === b[i].dateKey);
}
