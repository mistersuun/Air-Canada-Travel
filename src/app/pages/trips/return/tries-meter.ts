import { returnBoarded } from '../../../logbook/logbook';
import type { Trip } from '../../../trips/model';
import type { ConnectOptions } from '../../../utils/connections';
import { buildReturnView } from './return-model';

/** Plane icons shown before the count turns into "+N". */
export const METER_MAX = 6;

export interface TriesMeter {
  /** Planes to draw. */
  planes: number;
  /** Tries beyond the planes ("+2"), 0 when all are drawn. */
  extra: number;
  /** '3 tries home left'. */
  label: string;
  /** Amber at the last one; otherwise neutral. */
  last: boolean;
}

/** The "lives" meter for N tries home left. Facts only: a count, no danger colours. */
export function triesMeter(n: number): TriesMeter {
  const count = Math.max(0, Math.floor(n));
  return {
    planes: Math.min(count, METER_MAX),
    extra: Math.max(0, count - METER_MAX),
    label: `${count} ${count === 1 ? 'try' : 'tries'} home left`,
    last: count === 1,
  };
}

/**
 * Tries home still left on a trip (the Return tab's count for the day the
 * return flies); null once the way home is boarded or when there is no
 * airport to count from.
 */
export function triesHomeLeft(trip: Trip, connect: ConnectOptions): number | null {
  if (returnBoarded(trip)) return null;
  const v = buildReturnView(trip, connect);
  return v.gateway ? v.flyTries : null;
}
