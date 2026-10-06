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

// ── Trips v2 (spec §5.1) ──────────────────────────────────────────────────────

/** A trip detail tab (?tab=; absent = plan). */
export type TripTabKey = 'plan' | 'prep' | 'return';

/** Command array for `/trips`. */
export function tripsPath(): string[] {
  return ['/trips'];
}

/** Command array for `/trips/:id`; pass the tab and leg with tripQuery(). */
export function tripPath(id: string): string[] {
  return ['/trips', id];
}

/** Query params for a trip detail link: `{ tab: 'prep' }`, `{ leg: '<legId>' }` (plan is the default tab). */
export function tripQuery(tab?: TripTabKey | null, leg?: string | null): Record<string, string> {
  const q: Record<string, string> = {};
  if (tab && tab !== 'plan') q['tab'] = tab;
  if (leg) q['leg'] = leg;
  return q;
}

/** '/trips/:id?tab=…&leg=…' for router.navigateByUrl. */
export function tripUrl(id: string, tab?: TripTabKey | null, leg?: string | null): string {
  const q = new URLSearchParams(tripQuery(tab, leg)).toString();
  return `/trips/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
}

/** Command array for `/g/:id` (the key and write token go in the fragment `#k=…&w=…`). */
export function groupPath(id: string): string[] {
  return ['/g', id];
}

/** Command array for `/trips/import` (the payload goes in the fragment `#t=`). */
export function tripImportPath(): string[] {
  return ['/trips', 'import'];
}

/** Command array for `/trips/:id/recover` (query: `?at=YUL&leg=<legId>`). */
export function recoverPath(id: string): string[] {
  return ['/trips', id, 'recover'];
}

/** Command array for `/today` (optional query `?trip=<id>`). */
export function todayPath(): string[] {
  return ['/today'];
}

/** Command array for `/reach/:place` ('gn-2510911'). */
export function reachPath(placeId: string): string[] {
  return ['/reach', placeId];
}

/** Command array for `/reach/:place/:code`. */
export function gatewayPath(placeId: string, code: string): string[] {
  return ['/reach', placeId, code.toUpperCase()];
}
