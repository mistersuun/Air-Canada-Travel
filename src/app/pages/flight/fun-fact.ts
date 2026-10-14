/**
 * The small "while you wait" fact on the flight page: the destination's
 * daily fact (rotating, same data as the destination page), which can be
 * dismissed per destination. Dismissals live in this browser only.
 */
import { getDestinationCodes } from '../../data/schedule-index';
import { findDestination, findHub } from '../../utils/airports';
import { dailyFact } from '../destination/fun-facts';

const KEY = 'ac.funfact.off.v1';

/** The fact for a destination today; null when none applies or the destination is unknown. */
export function destinationFact(code: string, hubCode: string, nowMs: number): string | null {
  const dest = findDestination(code) ?? findHub(code);
  const hub = findHub(hubCode);
  if (!dest || !hub) return null;
  const nonstops = getDestinationCodes(hub.code).map(c => findHub(c) ?? findDestination(c)).filter((x): x is NonNullable<typeof x> => !!x);
  return dailyFact(dest, hub, nonstops, nowMs);
}

export function dismissedFacts(): Set<string> {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function dismissFact(code: string): Set<string> {
  const next = dismissedFacts().add(code.toUpperCase());
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* storage blocked: it hides for this visit only */
  }
  return next;
}
