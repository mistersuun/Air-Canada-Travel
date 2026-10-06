/**
 * "In the air" on /today: where along the great circle a flight is, estimated
 * from the schedule alone (time-linear: elapsed / scheduled duration). Pure
 * and clock free. An estimate, never a live position.
 */
import { findDestination, findHub } from '../../utils/airports';
import { greatCircleKm } from '../../utils/geo';
import { refArrUtc, refDepUtc } from '../../trips/engine/legs';
import type { FlightRef } from '../../trips/model';

export interface InAir {
  /** 0..1 of the scheduled time elapsed. */
  progress: number;
  /** Great-circle km left, rounded to the nearest 10. */
  kmLeft: number;
}

function coords(code: string): { lat: number; lng: number } | null {
  return findHub(code) ?? findDestination(code);
}

/** null before departure, from arrival on, or when the airports or times are unknown. */
export function inAirProgress(ref: FlightRef, nowMs: number): InAir | null {
  const dep = refDepUtc(ref);
  const arr = refArrUtc(ref);
  if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr <= dep) return null;
  if (nowMs < dep || nowMs >= arr) return null;
  const a = coords(ref.origin);
  const b = coords(ref.dest);
  if (!a || !b) return null;
  const progress = (nowMs - dep) / (arr - dep);
  const kmLeft = Math.round((greatCircleKm(a, b) * (1 - progress)) / 10) * 10;
  return { progress, kmLeft };
}
