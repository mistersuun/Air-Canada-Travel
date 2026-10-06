import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import {
  destTitle, flightTitle, knownDestination, knownTrip, legacyDestRedirect, tripTitle, validDate,
} from './shell/route-guards';

/**
 * URL scheme (spec §2.1). Pages receive params as signal inputs
 * (withComponentInputBinding): code = input.required<string>(), date, flight.
 * Build links with ui/links.ts (destPath, flightPath, calendarPath, and the
 * Trips v2 builders tripPath, tripImportPath, recoverPath, todayPath,
 * reachPath, gatewayPath).
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
  {
    path: 'trips',
    loadComponent: () => import('./pages/trips/trips.page').then(m => m.TripsPage),
    title: 'Trips · Routes',
  },
  {
    // Before trips/:id so 'import' is never read as a trip id.
    path: 'trips/import',
    loadComponent: () => import('./pages/trips/import/trip-import.page').then(m => m.TripImportPage),
    title: 'Shared trip · Routes',
  },
  {
    path: 'trips/:id',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/trips/trip-detail.page').then(m => m.TripDetailPage),
    title: tripTitle,
  },
  {
    path: 'trips/:id/recover',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/today/recover.page').then(m => m.RecoverPage),
    title: 'Still reachable · Routes',
  },
  // Trip extras (extras spec §2.1): links via extras/links.ts.
  {
    path: 'trips/:id/files',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/files/trip-files.page').then(m => m.TripFilesPage),
    title: 'Files · Routes',
  },
  {
    path: 'trips/:id/passes/add',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/passes/add-pass.page').then(m => m.AddPassPage),
    title: 'Add boarding pass · Routes',
  },
  {
    path: 'trips/:id/pass/:passId',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/passes/pass-view.page').then(m => m.PassViewPage),
    title: 'Boarding pass · Routes',
  },
  {
    path: 'trips/:id/share',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/share/trip-share.page').then(m => m.TripSharePage),
    title: 'Share trip · Routes',
  },
  {
    path: 'trips/:id/recap',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/share/recap.page').then(m => m.RecapPage),
    title: 'Trip recap · Routes',
  },
  {
    // Web Share Target (?id= from the service worker) and desktop File Handling.
    path: 'share-in',
    loadComponent: () => import('./pages/share-in/share-in.page').then(m => m.ShareInPage),
    title: 'Add to a trip · Routes',
  },
  {
    // End-to-end encrypted group plan: the key is in the URL fragment.
    path: 'g/:id',
    loadComponent: () => import('./pages/group/group.page').then(m => m.GroupPage),
    title: 'Group trip · Routes',
  },
  {
    path: 'logbook',
    loadComponent: () => import('./pages/logbook/logbook.page').then(m => m.LogbookPage),
    title: 'Logbook · Routes',
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile.page').then(m => m.ProfilePage),
    title: 'Travel profile · Routes',
  },
  {
    path: 'weekend',
    loadComponent: () => import('./pages/weekend/weekend.page').then(m => m.WeekendPage),
    title: 'Weekend finder · Routes',
  },
  {
    path: 'today',
    loadComponent: () => import('./pages/today/today.page').then(m => m.TodayPage),
    title: 'Today · Routes',
  },
  {
    path: 'reach/:place',
    loadComponent: () => import('./pages/reach/reach.page').then(m => m.ReachPage),
    title: 'Reach · Routes',
  },
  {
    path: 'reach/:place/:code',
    loadComponent: () => import('./pages/reach/gateway.page').then(m => m.GatewayPage),
    title: 'Reach · Routes',
  },
  { path: '**', redirectTo: '' },
];
