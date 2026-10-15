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
  Router,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { loadSchedules } from './data/schedule-index';
import { loadRouteNetwork } from './data/route-network';
import { createReloadGuard, startupLoad } from './startup';
import { routes } from './app.routes';
import { reloadOnChunkError } from './state/pwa-update.service';
import { PhotoService } from './state/photo.service';
import { AppStateService } from './state/app-state.service';
import { PwaExtrasService } from './share-in/pwa-extras.service';
import { stageDeepLink } from './shell/deep-link';
import { LocaleService } from './i18n/locale.service';
import { I18nTitleStrategy } from './i18n/title-strategy';
import { t } from './i18n/t';

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
          state.flash(t('shell.chunkError'));
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
    // document.title in the UI language (route titles are message keys).
    { provide: TitleStrategy, useClass: I18nTitleStrategy },
    // Before the first navigation: stage an Explore entry under a deep link,
    // and load the schedules and route network (data, not code) and the photo
    // credits in parallel.
    provideAppInitializer(() => {
      // First: the UI language is chosen before anything renders or builds text.
      // A French device fetches its catalogue (a lazy chunk) alongside the data
      // below; i18n.ready gives up after a short budget and starts in English.
      const i18n = inject(LocaleService);
      const staged = stageDeepLink(inject(DOCUMENT).defaultView);
      const state = inject(AppStateService);
      if (staged) state.markStagedBack();
      const extras = inject(PwaExtrasService);
      extras.init();
      const photos = inject(PhotoService);
      // Raced against a budget so a slow network cannot hold the first render;
      // see startupLoad for what happens to the loads that finish later.
      const doc = inject(DOCUMENT);
      const guard = createReloadGuard(doc, inject(Router));
      void photos.load();
      const data = startupLoad(state, loadSchedules(), loadRouteNetwork(), () => extras.announceSchedules(), guard, doc);
      return Promise.all([i18n.ready, data]).then(() => undefined);
    }),
    provideServiceWorker('sw.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:5000',
    }),
  ],
};
