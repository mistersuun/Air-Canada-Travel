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
import { deadlineUtc } from './homeby';
import { activeTravelDay, placeName } from './today';

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

/** Not archived and the deadline is less than a day ago. */
export function isActive(t: Trip, nowMs: number): boolean {
  return !t.archived && deadlineUtc(t.homeBy, t.homeAirport) > nowMs - 86_400_000;
}

/** Open changes on a leg that has not left yet. */
function liveChanges(trip: Trip, nowMs: number): number {
  return trip.changes.filter(c => {
    if (c.state !== 'open') return false;
    const leg = trip.legs.find(l => l.id === c.legId);
    return !!leg && leg.kind === 'flight' && !!leg.refs.length && refDepUtc(leg.refs[0]) > nowMs;
  }).length;
}

/** The soonest active trip leaving in 1 to 7 days, or null. `_log` is accepted so callers pass the same inputs as the other engines. */
export function comingUp(trips: Trip[], _log: FlightLog, nowMs: number): ComingUp | null {
  let best: { trip: Trip; next: Next } | null = null;
  for (const trip of trips) {
    if (trip.archived) continue;
    if (activeTravelDay([trip], nowMs)) continue;   // the today banner has it
    const next = nextDeparture(trip, nowMs);
    if (!next || next.days < 1 || next.days > COMING_UP_DAYS) continue;
    if (!best || next.depUtc < best.next.depUtc) best = { trip, next };
  }
  if (!best) return null;
  const { trip, next } = best;
  const actions = prepActions(trip, next.leg);
  const listsReturn = next.leg.role === 'return' && actions.some(x => x.startsWith('List '));
  if (returnNotListed(trip, nowMs) && !listsReturn) {
    actions.push('Return not listed');
  }
  const changes = openChanges(trip);
  if (changes) actions.push(`${changes} schedule ${changes === 1 ? 'change' : 'changes'}`);
  const dest = placeName(next.leg.refs[next.leg.refs.length - 1].dest);
  const where = next.leg.role === 'outbound' ? (trip.goal.name || dest) : next.leg.role === 'return' ? `Home to ${dest}` : dest;
  const when = next.days === 1 ? 'tomorrow' : `in ${next.days} days`;
  return { tripId: trip.id, days: next.days, actions, text: [`${where} ${when}`, ...actions].join(' · ') };
}

/**
 * Number for the app-icon badge: open prep actions for trips leaving within
 * 72h, open schedule changes on flights that have not left, and pending
 * outcome prompts (the caller's count, which pendingOutcomePrompts caps at 3).
 * Only active trips count, and imported shared copies are left out.
 */
export function badgeCount(trips: Trip[], pendingOutcomes: number, nowMs: number): number {
  let n = pendingOutcomes;
  for (const trip of trips) {
    if (!isActive(trip, nowMs) || trip.sharedFrom) continue;
    n += liveChanges(trip, nowMs);
    const next = nextDeparture(trip, nowMs);
    if (next && next.depUtc - nowMs <= BADGE_WINDOW_HOURS * 60 * MINUTE_MS) n += prepActions(trip, next.leg).length;
  }
  return n;
}
