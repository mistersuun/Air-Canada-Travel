/**
 * Matches a decoded pass leg to the trip's flight legs (extras spec §4.6).
 * Pure. A match is only ever a suggestion: the user confirms it or picks
 * another leg. A pass for a backup (alternate) is never matched to a leg:
 * the UI offers to swap the leg to that backup first.
 */
import { isFinalStatus, type FlightRef, type Trip } from '../trips/model';
import { diffDays } from '../utils/time';
import { julianToDateKey, normalizeFlightNumber } from './bcbp';
import type { BcbpLeg, MatchCandidate, PassRecord } from './model';

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

/** A backup (alternate) flight a pass is for: the leg it is folded under, which backup, and its segment. */
export interface AlternateMatch { legId: string; altId: string; refIndex: number; ref: FlightRef }

function findAlternate(
  flight: string, from: string, to: string, julian: number, issueDate: string | null, trip: Trip,
  savedDateKey: string | null = null,
): AlternateMatch | null {
  for (const l of trip.legs) {
    if (l.kind !== 'flight' || isFinalStatus(l.status)) continue;
    for (const alt of l.alternates) {
      const refIndex = alt.refs.findIndex(r => r.flightNumber.toUpperCase() === flight && r.origin === from && r.dest === to);
      if (refIndex < 0) continue;
      const ref = alt.refs[refIndex];
      const d = savedDateKey ?? julianToDateKey(julian, ref.dateKey, issueDate);
      if (!d || Math.abs(diffDays(ref.dateKey, d)) > 1) continue;
      return { legId: l.id, altId: alt.id, refIndex, ref };
    }
  }
  return null;
}

/**
 * The trip's backup flight with this pass's number, route and date (±1 day),
 * folded under an open leg, if any: the UI then offers "Swap this leg to
 * AC812?" instead of matching.
 */
export function matchingAlternate(leg: BcbpLeg, trip: Trip, issueDate: string | null = null): AlternateMatch | null {
  return findAlternate(normalizeFlightNumber(leg.carrier, leg.flightNumber), leg.from, leg.to, leg.julian, issueDate, trip);
}

/**
 * For a saved pass: the backup it is for, when the leg it is saved to (or no
 * leg) doesn't fly that flight and no planned leg does. Null otherwise.
 */
export function passAlternate(
  pass: Pick<PassRecord, 'tripId' | 'legId' | 'flightNumber' | 'from' | 'to' | 'julian'> & Partial<Pick<PassRecord, 'dateKey'>>,
  trip: Trip,
): AlternateMatch | null {
  if (pass.tripId !== trip.id) return null;
  const flight = pass.flightNumber.toUpperCase();
  // The date the user confirmed for the pass, when there is one: a flight on another date is not this pass's flight.
  const saved = pass.dateKey ?? null;
  const flies = (refs: readonly FlightRef[]) => refs.some(r => r.flightNumber.toUpperCase() === flight
    && r.origin === pass.from && r.dest === pass.to && (saved === null || Math.abs(diffDays(r.dateKey, saved)) <= 1));
  if (trip.legs.some(l => l.kind === 'flight' && !isFinalStatus(l.status) && flies(l.refs))) return null;
  const own = pass.legId ? trip.legs.find(l => l.id === pass.legId) : undefined;
  if (own?.kind === 'flight' && flies(own.refs)) return null;
  return findAlternate(flight, pass.from, pass.to, pass.julian, null, trip, saved);
}

/** "This pass is for AC812 (your backup). Swap this leg to AC812?" */
export function swapOfferText(flightNumber: string): string {
  return `This pass is for ${flightNumber} (your backup). Swap this leg to ${flightNumber}?`;
}

/** The pass date to show when nothing matched: anchored on the trip's first day (null → ask the user). */
export function unmatchedDateKey(leg: BcbpLeg, issueDate: string | null, trip: Trip): string | null {
  return julianToDateKey(leg.julian, trip.outboundDate, issueDate);
}
