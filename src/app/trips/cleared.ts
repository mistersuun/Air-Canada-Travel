import { findDestination, findHub } from '../utils/airports';
import { formatKm, greatCircleKm } from '../utils/geo';

/**
 * 'Cleared · YUL → LHR · 5,215 km' ('Cleared · some of you · YUL → …' when only some boarded).
 * The distance is left out when either airport is unknown.
 */
export function clearedMessage(origin: string, dest: string, some = false): string {
  const a = findHub(origin) ?? findDestination(origin);
  const b = findHub(dest) ?? findDestination(dest);
  const base = `Cleared · ${some ? 'some of you · ' : ''}${origin} → ${dest}`;
  return a && b ? `${base} · ${formatKm(greatCircleKm(a, b))}` : base;
}
