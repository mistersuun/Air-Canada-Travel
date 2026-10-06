/**
 * "Coming up": the next trip leaving within a week (not today, which the
 * today banner covers) and what is still to do for it, plus the count behind
 * the app-icon badge. Pure; the clock is passed in. Facts and counts only.
 */
import { legPrepItems } from '../../places/prep';
import { returnNotListed } from '../../pages/trips/trips-model';
import { airportTz } from '../../utils/airports';
import { MINUTE_MS, diffDays, utcToLocal } from '../../utils/time';
import { FlightLeg, FlightLog, Trip } from '../model';
import { refDepUtc } from './legs';
import { placeName } from './today';

export const COMING_UP_DAYS = 7;
export const BADGE_WINDOW_HOURS = 72;
const LIVE: readonly string[] = ['planned', 'listed', 'checkedIn'];

export interface ComingUp { tripId: string; days: number; text: string; actions: string[] }

interface Next { leg: FlightLeg; depUtc: number; days: number }

/** The trip's next flight leg that has not left yet. */
function nextDeparture(trip: Trip, nowMs: number): Next | null {
  let best: Next | null = null;
  for (const leg of trip.legs) {
    if (leg.kind !== 'flight' || !LIVE.includes(leg.status) || !leg.refs.length) continue;
    const ref = leg.refs[0];
    const depUtc = refDepUtc(ref);
    if (depUtc <= nowMs) continue;
    if (!best || depUtc < best.depUtc) {
      best = { leg, depUtc, days: diffDays(utcToLocal(nowMs, airportTz(ref.origin)).dateKey, ref.dateKey) };
    }
  }
  return best;
}

/** Open prep items for a leg, as short actions ('List AC834'); check-in is a day-of step and is left out. */
function prepActions(trip: Trip, leg: FlightLeg): string[] {
  return legPrepItems(trip, leg.id)
    .filter(i => !i.done && !i.id.startsWith('checkin:'))
    .map(i => i.title.replace(/^List for /, 'List '));
}

const openChanges = (trip: Trip) => trip.changes.filter(c => c.state === 'open').length;

/** The soonest active trip leaving in 1 to 7 days, or null. `_log` is accepted so callers pass the same inputs as the other engines. */
export function comingUp(trips: Trip[], _log: FlightLog, nowMs: number): ComingUp | null {
  let best: { trip: Trip; next: Next } | null = null;
  for (const trip of trips) {
    if (trip.archived) continue;
    const next = nextDeparture(trip, nowMs);
    if (!next || next.days < 1 || next.days > COMING_UP_DAYS) continue;
    if (!best || next.depUtc < best.next.depUtc) best = { trip, next };
  }
  if (!best) return null;
  const { trip, next } = best;
  const actions = prepActions(trip, next.leg);
  if (returnNotListed(trip, nowMs)) actions.push('Return not listed');
  const changes = openChanges(trip);
  if (changes) actions.push(`${changes} schedule ${changes === 1 ? 'change' : 'changes'}`);
  const where = trip.goal.name || placeName(next.leg.refs[next.leg.refs.length - 1].dest);
  const when = next.days === 1 ? 'tomorrow' : `in ${next.days} days`;
  return { tripId: trip.id, days: next.days, actions, text: [`${where} ${when}`, ...actions].join(' · ') };
}

/**
 * Number for the app-icon badge: open prep actions for trips leaving within
 * 72h, open schedule changes on active trips, and pending outcome prompts.
 */
export function badgeCount(trips: Trip[], pendingOutcomes: number, nowMs: number): number {
  let n = pendingOutcomes;
  for (const trip of trips) {
    if (trip.archived) continue;
    n += openChanges(trip);
    const next = nextDeparture(trip, nowMs);
    if (next && next.depUtc - nowMs <= BADGE_WINDOW_HOURS * 60 * MINUTE_MS) n += prepActions(trip, next.leg).length;
  }
  return n;
}
