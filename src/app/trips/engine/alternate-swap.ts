/**
 * "Use instead" for a backup: the backup's itinerary (current schedule, else
 * the saved snapshot) and the re-estimated ground leg from the airport it
 * lands at. Shared by the leg sheet and the boarding-pass swap offer, so both
 * swap exactly like Recover does (TripsService.swapLeg, with Undo).
 */
import { airportEnd, groundEstimate, type GroundEstimate } from '../../places/ground';
import type { Itinerary } from '../../utils/connections';
import type { Alternate, Trip } from '../model';
import { itineraryFromRefs, itineraryFromSnapshot } from './legs';

export interface AlternateSwapPlan { it: Itinerary; ground: GroundEstimate | null }

/** What swapLeg needs to swap `alt` in; null when its itinerary can't be built. */
export function alternateSwapPlan(trip: Trip, alt: Alternate): AlternateSwapPlan | null {
  const it = itineraryFromRefs(alt.refs) ?? itineraryFromSnapshot(alt.refs);
  if (!it) return null;
  const end = airportEnd(it.dest);
  // The timetable day is the day the new flight lands.
  const ground = end ? groundEstimate(end, trip.goal, { dateKey: it.arrDateKey }) : null;
  return { it, ground };
}
