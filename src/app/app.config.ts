import {
  ApplicationConfig,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { loadSchedules } from './data/schedule-index';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Signals drive every view; no zone.js (removed from angular.json polyfills).
    provideZonelessChangeDetection(),
    // The schedules are data, not code (public/data/schedules.json, cached by
    // the service worker): fetch them before the first render.
    provideAppInitializer(() => loadSchedules().then(() => undefined)),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
