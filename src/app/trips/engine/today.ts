/**
 * Outcome prompts and the day of travel (spec §2.8). Pure; the clock is
 * passed in.
 */
import { airportName, airportTz, isHub } from '../../utils/airports';
import { MINUTE_MS, utcToLocal } from '../../utils/time';
import { flightsOn } from '../../utils/week';
import { hubDisplayName } from '../../ui/format';
import { FlightLog, FlightRef, LegStatus, Trip, instanceKey } from '../model';
import { refDepUtc, refFromInstance } from './legs';

export interface OutcomePrompt { key: string /* instanceKey */; tripId: string | null; legId: string | null; ref: FlightRef; partySize: number }
export interface TravelDay { tripId: string; legId: string; at: string; title: string /* 'Montréal → Madrid' */ }

/** A prompt is asked once the flight left at least this long ago. */
export const OUTCOME_AFTER_MIN = 30;
export const MAX_OUTCOME_PROMPTS = 3;
/** "Departed less than this long ago" still counts as the travel day. */
export const TRAVEL_DAY_GRACE_MIN = 120;

const PROMPT_STATUSES: readonly LegStatus[] = ['planned', 'listed', 'checkedIn'];

/** City name for an airport: 'Montréal' for YUL, 'Madrid' for MAD. */
export function placeName(code: string): string {
  return isHub(code) ? hubDisplayName(code) : airportName(code);
}

/**
 * Flights that left over 30 min ago with no outcome yet: trip segments still
 * Planned / Listed / Checked in, plus flights the user wrote load notes for.
 * Skips dismissed keys. Newest first, at most 3.
 */
export function pendingOutcomePrompts(trips: Trip[], log: FlightLog, nowMs: number): OutcomePrompt[] {
  const done = new Set([...log.outcomes.map(o => instanceKey(o)), ...log.dismissed]);
  const cutoff = nowMs - OUTCOME_AFTER_MIN * MINUTE_MS;
  const out = new Map<string, OutcomePrompt & { depUtc: number }>();
  const tripKeys = new Set<string>();

  for (const trip of trips) {
    if (trip.archived) continue;
    for (const leg of trip.legs) {
      if (leg.kind !== 'flight') continue;
      for (const ref of leg.refs) tripKeys.add(instanceKey(ref));
      if (!PROMPT_STATUSES.includes(leg.status)) continue;
      for (const ref of leg.refs) {
        const key = instanceKey(ref);
        const depUtc = refDepUtc(ref);
        if (depUtc >= cutoff || done.has(key) || out.has(key)) continue;
        out.set(key, { key, tripId: trip.id, legId: leg.id, ref, partySize: trip.party.count, depUtc });
      }
    }
  }

  for (const n of log.notes) {
    const key = instanceKey(n);
    if (done.has(key) || out.has(key) || tripKeys.has(key)) continue;
    const inst = flightsOn(n.origin, n.dest, n.dateKey).find(f =>
      f.flightNumber === n.flightNumber || (f.altFlightNumbers ?? []).includes(n.flightNumber));
    if (!inst || inst.depUtc >= cutoff) continue;
    out.set(key, {
      key, tripId: null, legId: null,
      ref: { ...refFromInstance(inst), flightNumber: n.flightNumber },
      partySize: 1, depUtc: inst.depUtc,
    });
  }

  return [...out.values()]
    .sort((a, b) => b.depUtc - a.depUtc)
    .slice(0, MAX_OUTCOME_PROMPTS)
    .map(({ depUtc: _d, ...p }) => p);
}

/**
 * Today's travel: a flight leg that is not done and departs today (local at
 * its origin) or left less than 2h ago. The next departure wins; a trip that
 * is archived never counts.
 */
export function activeTravelDay(trips: Trip[], nowMs: number): TravelDay | null {
  const candidates: { day: TravelDay; depUtc: number }[] = [];
  for (const trip of trips) {
    if (trip.archived) continue;
    for (const leg of trip.legs) {
      if (leg.kind !== 'flight' || !PROMPT_STATUSES.includes(leg.status) || !leg.refs.length) continue;
      const ref = leg.refs[0];
      const depUtc = refDepUtc(ref);
      const today = utcToLocal(nowMs, airportTz(ref.origin)).dateKey;
      const recent = depUtc <= nowMs && nowMs - depUtc < TRAVEL_DAY_GRACE_MIN * MINUTE_MS;
      if (ref.dateKey !== today && !recent) continue;
      const last = leg.refs[leg.refs.length - 1];
      candidates.push({
        depUtc,
        day: { tripId: trip.id, legId: leg.id, at: ref.origin, title: `${placeName(ref.origin)} → ${placeName(last.dest)}` },
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.depUtc - b.depUtc);
  const live = candidates.find(c => c.depUtc >= nowMs - TRAVEL_DAY_GRACE_MIN * MINUTE_MS);
  return (live ?? candidates[candidates.length - 1]).day;
}
