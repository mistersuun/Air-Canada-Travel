import { t } from '../../../i18n/t';
import { returnBoarded } from '../../../logbook/logbook';
import type { Trip } from '../../../trips/model';
import type { ConnectOptions } from '../../../utils/connections';
import { type HomeByPlan, homeByPlan } from '../../../trips/engine/homeby';
import { returnFlyKey, returnGateway } from './return-model';

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
    label: t('trips.meter.label', { n: count }),
    last: count === 1,
  };
}

/**
 * Tries home still left on a trip: the flights home from the return day on
 * that have not departed yet and still beat the deadline (the Return tab's
 * count, minus the ones already gone). Null once the way home is boarded,
 * when there is no airport to count from, or when the schedules do not cover
 * every day (so "none left" is never claimed on missing data).
 */
export function triesHomeLeft(trip: Trip, connect: ConnectOptions, nowMs: number): number | null {
  if (returnBoarded(trip)) return null;
  const gateway = returnGateway(trip);
  if (!gateway) return null;
  const flyKey = returnFlyKey(trip);
  const plan = homeByPlan(gateway, trip.homeAirport, trip.homeBy, flyKey, connect);
  if (!plan.covered) return null;
  return triesLeftInPlan(plan, flyKey, nowMs);
}

/** Tries on `flyKey` or later that have not departed at `nowMs`. */
export function triesLeftInPlan(plan: Pick<HomeByPlan, 'days'>, flyKey: string, nowMs: number): number {
  let n = 0;
  for (const d of plan.days) {
    if (d.dateKey < flyKey) continue;
    n += d.tries.filter(t => t.itinerary.departUtc > nowMs).length;
  }
  return n;
}
