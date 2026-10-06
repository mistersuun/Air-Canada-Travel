import {
  ApplicationConfig,
  DOCUMENT,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { loadSchedules } from './data/schedule-index';
import { loadRouteNetwork } from './data/route-network';
import { routes } from './app.routes';
import { reloadOnChunkError } from './state/pwa-update.service';
import { PhotoService } from './state/photo.service';
import { AppStateService } from './state/app-state.service';
import { PwaExtrasService } from './share-in/pwa-extras.service';
import { stageDeepLink } from './shell/deep-link';

/** '/to/LIS' for a route snapshot tree (query params and fragment ignored). */
export function snapshotPath(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  for (let s: ActivatedRouteSnapshot | null = root; s; s = s.firstChild) {
    for (const seg of s.url) parts.push(seg.path);
  }
  return '/' + parts.join('/');
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Signals drive every view; no zone.js.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withNavigationErrorHandler(e => {
        const state = inject(AppStateService);
        if (reloadOnChunkError(e.error, inject(DOCUMENT).defaultView, e.url) === 'blocked') {
          state.flash("Couldn't open this page — check your connection.");
        }
      }),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withViewTransitions({
        skipInitialTransition: true,
        // Query-param-only writes (search, ?sel=, ?tab=, week moves) stay on the
        // same page: no crossfade.
        onViewTransitionCreated: ({ transition, from, to }) => {
          if (snapshotPath(from) === snapshotPath(to)) transition.skipTransition();
        },
      }),
    ),
    // Before the first navigation: stage an Explore entry under a deep link,
    // and load the schedules and route network (data, not code) and the photo
    // credits in parallel.
    provideAppInitializer(() => {
      const staged = stageDeepLink(inject(DOCUMENT).defaultView);
      const state = inject(AppStateService);
      if (staged) state.markStagedBack();
      const extras = inject(PwaExtrasService);
      extras.init();
      const photos = inject(PhotoService);
      return Promise.all([loadSchedules(), loadRouteNetwork(), photos.load()]).then(([schedulesOk]) => {
        state.reportDataLoad(schedulesOk);
        extras.announceSchedules();
      });
    }),
    provideServiceWorker('sw.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
