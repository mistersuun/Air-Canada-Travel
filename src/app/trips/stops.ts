/**
 * Stops of a trip (see the design note on Stop in model.ts). Pure helpers so
 * every consumer of Trip.goal can say which stop it means:
 *   firstStop  = trip.goal            (names, cards, prep, outbound timeline)
 *   lastStop   = where you head home from (Return tab, home-by gateways)
 *   currentStop = where you are on a given day (Today's "Day N in ...")
 */
import { airportEnd } from '../places/ground';
import { greatCircleKm } from '../utils/geo';
import type { Place, Stop, Trip, TripLeg } from './model';

/** Most stops after the goal a trip can hold (storage.ts keeps no more). */
export const MAX_STOPS = 12;

/** The goal as a stop (id 'goal'), followed by the later stops, in order. */
export function tripStops(trip: Trip): Stop[] {
  const later = trip.stops ?? [];
  return [{ id: 'goal', place: trip.goal, arriveDate: trip.outboundDate, ...(later[0] ? { leaveDate: later[0].arriveDate } : {}) }, ...later];
}

/** Where you will be when you head home: the last stop, else the goal. */
export function lastStopPlace(trip: Trip): Place {
  const later = trip.stops;
  return later?.length ? later[later.length - 1].place : trip.goal;
}

/** True when the trip has more than one stop. */
export function isMultiStop(trip: Trip): boolean {
  return !!trip.stops?.length;
}

/** The stop you are in on `dateKey` (the latest one you have arrived at; the goal before any later stop). */
export function currentStop(trip: Trip, dateKey: string): Stop {
  const all = tripStops(trip);
  let cur = all[0];
  for (const s of all) if (s.arriveDate <= dateKey) cur = s;
  return cur;
}

/** 'Seville, Lisbon and Porto'; just the goal name for a single stop. */
export function stopNames(trip: Trip): string {
  const names = tripStops(trip).map(s => s.place.name);
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Adds a stop keeping the list ordered by arrival date. */
export function withStop(trip: Trip, stop: Stop): Trip {
  const stops = [...(trip.stops ?? []), stop].sort((a, b) => a.arriveDate.localeCompare(b.arriveDate));
  return { ...trip, stops };
}

/** Removes a later stop (the goal cannot be removed). */
export function withoutStop(trip: Trip, stopId: string): Trip {
  const stops = (trip.stops ?? []).filter(s => s.id !== stopId);
  const { stops: _drop, ...rest } = trip;
  return stops.length ? { ...rest, stops } : rest;
}

/**
 * The place a leg is heading to, for recovery: an onward flight goes to the
 * stop nearest its final airport; every other leg (outbound, return, ground)
 * keeps the goal.
 */
export function stopForLeg(trip: Trip, leg: TripLeg): Place {
  if (leg.kind !== 'flight' || leg.role !== 'onward' || !trip.stops?.length || !leg.refs.length) return trip.goal;
  const end = airportEnd(leg.refs[leg.refs.length - 1].dest);
  if (!end) return trip.goal;
  let best = trip.goal;
  let bestKm = greatCircleKm(end, trip.goal);
  for (const s of trip.stops) {
    const km = greatCircleKm(end, s.place);
    if (km < bestKm) { best = s.place; bestKm = km; }
  }
  return best;
}
