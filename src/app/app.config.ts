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
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { loadSchedules } from './data/schedule-index';
import { routes } from './app.routes';
import { PhotoService } from './state/photo.service';
import { AppStateService } from './state/app-state.service';
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
    // and load the schedules (data, not code) and the photo credits in parallel.
    provideAppInitializer(() => {
      const staged = stageDeepLink(inject(DOCUMENT).defaultView);
      const state = inject(AppStateService);
      if (staged) state.markStagedBack();
      const photos = inject(PhotoService);
      return Promise.all([loadSchedules(), photos.load()]).then(() => undefined);
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
