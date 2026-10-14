/**
 * Pure helpers for editing a trip on the Plan tab: the flight to re-plan the
 * outbound onto a new date, the flights between two airports on a day, the
 * role a new flight leg gets, and the ground leg for two ends.
 */
import { airportEnd, groundEstimate, placeEnd } from '../../places/ground';
import { Itinerary, ConnectOptions, allItineraries, directItineraries } from '../../utils/connections';
import { addDays } from '../../utils/time';
import { FlightLeg, GroundLeg, GroundMode, GroundTimes, LegEnd, Trip, isFinalStatus } from '../model';
import { tripStops } from '../stops';

/** The leg "Change date" re-plans: the first outbound flight that is not done with. */
export function outboundLeg(trip: Trip): FlightLeg | null {
  return trip.legs.find((l): l is FlightLeg => l.kind === 'flight' && l.role === 'outbound' && !isFinalStatus(l.status) && l.refs.length > 0) ?? null;
}

/** Flights between two airports on a day: nonstops, plus connections when `connections` is on. */
export function flightsOn(from: string, to: string, dateKey: string, opts: ConnectOptions, connections: boolean): Itinerary[] {
  if (!from || !to || from === to || !dateKey) return [];
  return connections ? allItineraries(from, to, dateKey, opts) : directItineraries(from, to, dateKey);
}

/** The best flight for the outbound leg on `dateKey` (same airports as the current leg), or null when none flies. */
export function replanOutbound(trip: Trip, dateKey: string, opts: ConnectOptions, connections: boolean): Itinerary | null {
  const leg = outboundLeg(trip);
  if (!leg) return null;
  const from = leg.refs[0].origin;
  const to = leg.refs[leg.refs.length - 1].dest;
  const nonstop = directItineraries(from, to, dateKey)[0];
  return nonstop ?? flightsOn(from, to, dateKey, opts, connections)[0] ?? null;
}

/** The role a flight added by hand gets: home is a return, the first way out the outbound, else onward. */
export function roleForNewFlight(trip: Trip, it: Itinerary): FlightLeg['role'] {
  if (it.dest === trip.homeAirport) return 'return';
  const hasOutbound = trip.legs.some(l => l.kind === 'flight' && l.role === 'outbound' && l.status !== 'abandoned');
  return !hasOutbound && it.origin === trip.fromHub ? 'outbound' : 'onward';
}

/** A place to travel between, for the "Add a leg" pickers. */
export interface EndOption { key: string; label: string; end: LegEnd; code: string | null }

/** The stops and home / the airports the trip already uses, as ends to pick from (no duplicates). */
export function endOptions(trip: Trip, airports: readonly string[]): EndOption[] {
  const out: EndOption[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, end: LegEnd | null) => {
    if (!end || seen.has(key)) return;
    seen.add(key);
    out.push({ key, label, end, code: end.code ?? null });
  };
  for (const s of tripStops(trip)) add(`place:${s.place.id}`, s.place.name, placeEnd(s.place));
  for (const c of [trip.fromHub, trip.homeAirport, ...airports]) {
    const e = airportEnd(c);
    add(`code:${c}`, e ? `${e.name} (${c})` : c, e);
  }
  return out;
}

/** Everything a ground leg needs from two ends (Estimated, or Unknown when no way is known); times make it "Saved by you". */
export function groundLegBetween(
  from: LegEnd, to: LegEnd, dateKey: string, mode: GroundMode | null, times: GroundTimes | null = null,
): Omit<GroundLeg, 'id' | 'status' | 'statusAt' | 'note'> {
  const g = groundEstimate(from, to, { dateKey });
  const known = g.mode !== 'unknown' && g.totalMin !== null;
  const chosen: GroundMode = mode ?? (known ? (g.mode as GroundMode) : 'other');
  return {
    kind: 'ground', mode: chosen, from, to, dateKey: times?.depDateKey ?? dateKey,
    estMinutes: known ? g.totalMin : null,
    provenance: times ? 'saved' : known ? 'estimated' : 'unknown',
    userTimes: times,
  };
}

/** A default arrival date for a new stop: two days after the last stop (capped at the day before home-by). */
export function defaultStopDate(trip: Trip): string {
  const stops = tripStops(trip);
  const last = stops[stops.length - 1];
  const want = addDays(last.arriveDate, 2);
  const cap = addDays(trip.homeBy.dateKey, -1);
  return want <= cap ? want : last.arriveDate;
}
