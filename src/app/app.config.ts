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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Signals drive every view; no zone.js.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withViewTransitions({ skipInitialTransition: true }),
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
