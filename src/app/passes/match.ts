/**
 * Matches a decoded pass leg to the trip's flight legs (extras spec §4.6).
 * Pure. A match is only ever a suggestion: the user confirms it or picks
 * another leg. Backups (alternates) are not matched in v1.
 */
import { isFinalStatus, type FlightRef, type Trip } from '../trips/model';
import { diffDays } from '../utils/time';
import { julianToDateKey, normalizeFlightNumber } from './bcbp';
import type { BcbpLeg, MatchCandidate } from './model';

interface Ranked { c: MatchCandidate; final: boolean; order: number }

/**
 * Every flight-leg segment with the same flight number, origin and
 * destination whose date is within ±1 day of the pass date (resolved against
 * that segment's date). Open legs first, then the closest date, then leg order.
 */
export function matchPassLeg(leg: BcbpLeg, issueDate: string | null, trip: Trip): MatchCandidate[] {
  const flight = normalizeFlightNumber(leg.carrier, leg.flightNumber);
  const out: Ranked[] = [];
  trip.legs.forEach((l, order) => {
    if (l.kind !== 'flight') return;
    l.refs.forEach((ref, refIndex) => {
      if (ref.flightNumber.toUpperCase() !== flight) return;
      if (leg.from !== ref.origin || leg.to !== ref.dest) return;
      const d = julianToDateKey(leg.julian, ref.dateKey, issueDate);
      if (!d) return;
      const delta = diffDays(ref.dateKey, d);
      if (delta < -1 || delta > 1) return;
      out.push({
        c: { tripId: trip.id, legId: l.id, refIndex, ref, dateKey: d, deltaDays: delta as -1 | 0 | 1 },
        final: isFinalStatus(l.status), order,
      });
    });
  });
  out.sort((a, b) => Number(a.final) - Number(b.final) || Math.abs(a.c.deltaDays) - Math.abs(b.c.deltaDays)
    || a.order - b.order || a.c.refIndex - b.c.refIndex);
  return out.map(r => r.c);
}

/**
 * The trip's backup flight with this pass's number and route, if any: the UI
 * then says "This pass is for AC812, one of your backups…" instead of matching.
 */
export function matchingAlternate(leg: BcbpLeg, trip: Trip): { legId: string; ref: FlightRef } | null {
  const flight = normalizeFlightNumber(leg.carrier, leg.flightNumber);
  for (const l of trip.legs) {
    if (l.kind !== 'flight') continue;
    for (const alt of l.alternates) {
      const ref = alt.refs.find(r => r.flightNumber.toUpperCase() === flight && r.origin === leg.from && r.dest === leg.to);
      if (ref) return { legId: l.id, ref };
    }
  }
  return null;
}

/** The pass date to show when nothing matched: anchored on the trip's first day (null → ask the user). */
export function unmatchedDateKey(leg: BcbpLeg, issueDate: string | null, trip: Trip): string | null {
  return julianToDateKey(leg.julian, trip.outboundDate, issueDate);
}
