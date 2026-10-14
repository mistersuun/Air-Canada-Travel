import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import {
  destTitle, flightTitle, knownDestination, knownTrip, legacyDestRedirect, tripTitle, unknownPage, validDate,
} from './shell/route-guards';

/**
 * URL scheme (spec §2.1). Pages receive params as signal inputs
 * (withComponentInputBinding): code = input.required<string>(), date, flight.
 * Build links with ui/links.ts (destPath, flightPath, calendarPath, and the
 * Trips v2 builders tripPath, tripImportPath, recoverPath, todayPath,
 * reachPath, gatewayPath).
 *
 * A static `title` is a message key; I18nTitleStrategy translates it (and
 * re-runs title resolvers) in the UI language.
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
    title: 'shell.title.home',
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
    title: 'shell.title.map',
  },
  {
    path: 'saved',
    loadComponent: () => import('./pages/saved/saved.page').then(m => m.SavedPage),
    title: 'shell.title.saved',
  },
  {
    path: 'calendar',
    loadComponent: () => import('./pages/calendar/calendar.page').then(m => m.CalendarPage),
    title: 'shell.title.calendar',
  },
  {
    path: 'calendar/:code',
    canActivate: [knownDestination],
    loadComponent: () => import('./pages/calendar/calendar.page').then(m => m.CalendarPage),
    title: 'shell.title.calendar',
  },
  {
    path: 'trips',
    loadComponent: () => import('./pages/trips/trips.page').then(m => m.TripsPage),
    title: 'shell.title.trips',
  },
  {
    // Before trips/:id so 'import' is never read as a trip id.
    path: 'trips/import',
    loadComponent: () => import('./pages/trips/import/trip-import.page').then(m => m.TripImportPage),
    title: 'shell.title.tripImport',
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
    title: 'shell.title.recover',
  },
  // Trip extras (extras spec §2.1): links via extras/links.ts.
  {
    path: 'trips/:id/files',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/files/trip-files.page').then(m => m.TripFilesPage),
    title: 'shell.title.files',
  },
  {
    path: 'trips/:id/passes/add',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/passes/add-pass.page').then(m => m.AddPassPage),
    title: 'shell.title.addPass',
  },
  {
    path: 'trips/:id/pass/:passId',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/passes/pass-view.page').then(m => m.PassViewPage),
    title: 'shell.title.pass',
  },
  {
    path: 'trips/:id/share',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/share/trip-share.page').then(m => m.TripSharePage),
    title: 'shell.title.share',
  },
  {
    path: 'trips/:id/recap',
    canActivate: [knownTrip],
    loadComponent: () => import('./pages/share/recap.page').then(m => m.RecapPage),
    title: 'shell.title.recap',
  },
  {
    // Web Share Target (?id= from the service worker) and desktop File Handling.
    path: 'share-in',
    loadComponent: () => import('./pages/share-in/share-in.page').then(m => m.ShareInPage),
    title: 'shell.title.shareIn',
  },
  {
    // End-to-end encrypted group plan: the key is in the URL fragment.
    path: 'g/:id',
    loadComponent: () => import('./pages/group/group.page').then(m => m.GroupPage),
    title: 'shell.title.group',
  },
  {
    path: 'logbook',
    loadComponent: () => import('./pages/logbook/logbook.page').then(m => m.LogbookPage),
    title: 'shell.title.logbook',
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile.page').then(m => m.ProfilePage),
    title: 'shell.title.profile',
  },
  {
    path: 'weekend',
    loadComponent: () => import('./pages/weekend/weekend.page').then(m => m.WeekendPage),
    title: 'shell.title.weekend',
  },
  {
    path: 'today',
    loadComponent: () => import('./pages/today/today.page').then(m => m.TodayPage),
    title: 'shell.title.today',
  },
  {
    path: 'reach/:place',
    loadComponent: () => import('./pages/reach/reach.page').then(m => m.ReachPage),
    title: 'shell.title.reach',
  },
  {
    path: 'reach/:place/:code',
    loadComponent: () => import('./pages/reach/gateway.page').then(m => m.GatewayPage),
    title: 'shell.title.reach',
  },
  { path: '**', canActivate: [unknownPage], children: [] },
];
