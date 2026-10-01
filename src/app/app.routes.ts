import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { destTitle, flightTitle, knownDestination, legacyDestRedirect, validDate } from './shell/route-guards';

/**
 * URL scheme (spec §2.1). Pages receive params as signal inputs
 * (withComponentInputBinding): code = input.required<string>(), date, flight.
 * Build links with ui/links.ts (destPath, flightPath, calendarPath).
 */
/** Matches flight/:code/:date with an optional trailing :flight slug. */
export function flightMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if ((segments.length !== 3 && segments.length !== 4) || segments[0].path !== 'flight') return null;
  const posParams: Record<string, UrlSegment> = { code: segments[1], date: segments[2] };
  if (segments[3]) posParams['flight'] = segments[3];
  return { consumed: segments, posParams };
}

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [legacyDestRedirect],
    loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage),
    title: 'Routes',
  },
  {
    path: 'to/:code',
    canActivate: [knownDestination],
    loadComponent: () => import('./pages/destination/destination.page').then(m => m.DestinationPage),
    title: destTitle,
  },
  {
    // One config for /flight/:code/:date and /flight/:code/:date/:flight, so
    // moving between them reuses FlightPage (and keeps its picked return).
    matcher: flightMatcher,
    canActivate: [knownDestination, validDate],
    loadComponent: () => import('./pages/flight/flight.page').then(m => m.FlightPage),
    title: flightTitle,
  },
  {
    path: 'map',
    loadComponent: () => import('./pages/map/map.page').then(m => m.MapPage),
    title: 'Map · Routes',
  },
  {
    path: 'saved',
    loadComponent: () => import('./pages/saved/saved.page').then(m => m.SavedPage),
    title: 'Saved · Routes',
  },
  {
    path: 'calendar',
    loadComponent: () => import('./pages/calendar/calendar.page').then(m => m.CalendarPage),
    title: 'Calendar · Routes',
  },
  {
    path: 'calendar/:code',
    canActivate: [knownDestination],
    loadComponent: () => import('./pages/calendar/calendar.page').then(m => m.CalendarPage),
    title: 'Calendar · Routes',
  },
  { path: '**', redirectTo: '' },
];
