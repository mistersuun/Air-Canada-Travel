/**
 * Route builders for the trip extras (extras spec §2.1): files, boarding
 * passes, the share card and the travel profile.
 *
 *   [routerLink]="filesPath(trip.id)"                          → /trips/:id/files
 *   [routerLink]="addPassPath(id)" [queryParams]="addPassQuery(legId, 'camera')"
 *   [routerLink]="passPath(id, passId)"                        → /trips/:id/pass/:passId
 */

/** Command array for `/trips/:id/files` (query `?day=<dateKey>` scrolls to that day). */
export function filesPath(tripId: string): string[] {
  return ['/trips', tripId, 'files'];
}

/** Command array for `/trips/:id/passes/add`; pass the query with addPassQuery(). */
export function addPassPath(tripId: string): string[] {
  return ['/trips', tripId, 'passes', 'add'];
}

/** `{ leg, src }` for the add-pass page; `src` preselects the input. */
export function addPassQuery(legId?: string | null, src?: 'camera' | 'file' | null): Record<string, string> {
  const q: Record<string, string> = {};
  if (legId) q['leg'] = legId;
  if (src) q['src'] = src;
  return q;
}

/** Command array for `/trips/:id/pass/:passId`. */
export function passPath(tripId: string, passId: string): string[] {
  return ['/trips', tripId, 'pass', passId];
}

/** Command array for `/trips/:id/share`. */
export function tripSharePath(tripId: string): string[] {
  return ['/trips', tripId, 'share'];
}

/** Command array for `/profile`. */
export function profilePath(): string[] {
  return ['/profile'];
}

/** Command array for `/trips/:id/recap`. */
export function recapPath(tripId: string): string[] {
  return ['/trips', tripId, 'recap'];
}

/** Command array for `/logbook`. */
export function logbookPath(): string[] {
  return ['/logbook'];
}
