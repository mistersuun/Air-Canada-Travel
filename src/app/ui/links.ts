/**
 * Route path builders and flight slugs. Every in-app link goes through these,
 * so the URL scheme lives in one place (see app.routes.ts).
 *
 *   [routerLink]="destPath('LIS')"                      → /to/LIS
 *   [routerLink]="flightPath('LIS', '2026-10-01', it)"   → /flight/LIS/2026-10-01/AC812
 *   [routerLink]="calendarPath('CUN')"                  → /calendar/CUN
 *
 * Global query params (from, week, day, region, q) are added by the caller
 * with `[queryParams]="state.globalParams()"`; AppStateService also restores
 * them after any navigation that dropped them.
 */
import type { Itinerary } from '../utils/connections';

/** Command array for `/to/:code`. */
export function destPath(code: string): string[] {
  return ['/to', code.toUpperCase()];
}

/** Command array for `/flight/:code/:date[/:slug]`. */
export function flightPath(code: string, date: string, it?: Itinerary | null): string[] {
  const path = ['/flight', code.toUpperCase(), date];
  if (it) path.push(flightSlug(it));
  return path;
}

/** Command array for `/calendar` or `/calendar/:code`. */
export function calendarPath(code?: string | null): string[] {
  return code ? ['/calendar', code.toUpperCase()] : ['/calendar'];
}

/** 'AC812', 'AC300+AC1', 'EST+AC1' (an estimated leg has no number). */
export function flightSlug(it: Itinerary): string {
  return it.legs.map(l => (l.estimated || !l.flightNumber ? 'EST' : l.flightNumber.replace(/\s+/g, ''))).join('+');
}

/** The itinerary whose slug matches (case-insensitive), or null. */
export function matchSlug(slug: string | null | undefined, its: readonly Itinerary[]): Itinerary | null {
  if (!slug) return null;
  const want = slug.replace(/\s+/g, '').toUpperCase();
  return its.find(it => flightSlug(it).toUpperCase() === want) ?? null;
}
