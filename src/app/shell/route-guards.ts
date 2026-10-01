import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, RedirectCommand, ResolveFn, Router } from '@angular/router';
import { findDestination } from '../utils/airports';
import { isDateKey, formatKey } from '../utils/time';
import { currentDestinationCode, isDestinationCode } from '../state/prefs.service';
import { TripsService } from '../trips/trips.service';

/** Rebuild the current URL with `code` swapped for its canonical form. */
function withCode(router: Router, route: ActivatedRouteSnapshot, code: string): RedirectCommand {
  const segments = route.pathFromRoot.flatMap(r => r.url.map(u => u.path));
  const i = segments.findIndex(s => s.toUpperCase() === (route.paramMap.get('code') ?? '').toUpperCase());
  if (i >= 0) segments[i] = code;
  return new RedirectCommand(router.createUrlTree(['/', ...segments], { queryParams: route.queryParams }), {
    replaceUrl: true,
  });
}

/**
 * `:code` must be a known destination. Lowercase and renamed codes (PBI →
 * DJT) redirect to the canonical URL; unknown codes go to Explore.
 */
export const knownDestination: CanActivateFn = route => {
  const router = inject(Router);
  const raw = route.paramMap.get('code') ?? '';
  const code = currentDestinationCode(raw.toUpperCase()) as string;
  if (!isDestinationCode(code)) {
    return new RedirectCommand(router.createUrlTree(['/'], { queryParams: route.queryParams }), { replaceUrl: true });
  }
  return code === raw ? true : withCode(router, route, code);
};

/** `:date` must be a YYYY-MM-DD date key; otherwise go to the destination page. */
export const validDate: CanActivateFn = route => {
  if (isDateKey(route.paramMap.get('date'))) return true;
  const router = inject(Router);
  const code = (route.paramMap.get('code') ?? '').toUpperCase();
  return new RedirectCommand(router.createUrlTree(['/to', code], { queryParams: route.queryParams }), {
    replaceUrl: true,
  });
};

/** Old shared links: /?dest=LHR&from=YYZ → /to/LHR?from=YYZ (replaceUrl). */
export const legacyDestRedirect: CanActivateFn = route => {
  const dest = route.queryParamMap.get('dest');
  if (!dest) return true;
  const router = inject(Router);
  const { dest: _drop, ...rest } = route.queryParams;
  const code = currentDestinationCode(dest.toUpperCase());
  const tree = isDestinationCode(code)
    ? router.createUrlTree(['/to', code], { queryParams: rest })
    : router.createUrlTree(['/'], { queryParams: rest });
  return new RedirectCommand(tree, { replaceUrl: true });
};

/** 'Lisbon · Routes'. */
export const destTitle: ResolveFn<string> = route => {
  const d = findDestination((route.paramMap.get('code') ?? '').toUpperCase());
  return d ? `${d.city} · Routes` : 'Routes';
};

/** 'Lisbon · Thu, Oct 1 · Routes'. */
export const flightTitle: ResolveFn<string> = route => {
  const d = findDestination((route.paramMap.get('code') ?? '').toUpperCase());
  const date = route.paramMap.get('date');
  const day = isDateKey(date) ? formatKey(date, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  return [d?.city ?? 'Flight', day, 'Routes'].filter(Boolean).join(' · ');
};

/** `:id` must be a trip on this device; otherwise go to the Trips list. */
export const knownTrip: CanActivateFn = route => {
  const id = route.paramMap.get('id') ?? '';
  if (inject(TripsService).trip(id)) return true;
  return new RedirectCommand(inject(Router).createUrlTree(['/trips']), { replaceUrl: true });
};

/** 'Seville trip · Routes'. */
export const tripTitle: ResolveFn<string> = route => {
  const t = inject(TripsService).trip(route.paramMap.get('id') ?? '');
  return t ? `${t.name} · Routes` : 'Trips · Routes';
};
