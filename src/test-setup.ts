/**
 * Vitest global setup (jsdom).
 *
 * - Installs public/data/schedules.json as the published schedule data.
 * - Initialises the Angular TestBed environment. The app bootstraps with
 *   Angular 21's default zoneless change detection (main.ts has no
 *   provideZoneChangeDetection), and TestBed is zoneless by default too, so no
 *   zone.js import is needed. In specs, use `await fixture.whenStable()` or
 *   `fixture.detectChanges()` after changing inputs via
 *   `fixture.componentRef.setInput(...)`.
 * - Stubs browser APIs jsdom lacks (matchMedia, <dialog>.showModal/close,
 *   ResizeObserver, IntersectionObserver, scrollTo/scrollIntoView).
 *
 * Services that need a SwUpdate should get a stub in their spec, e.g.
 *   providers: [{ provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: EMPTY } }]
 */
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { installSchedules } from './app/data/schedule-index';

// The published schedules (the app fetches this file at startup). Specs that
// need stable data inject fixtures with setScheduleSource; resetScheduleSource
// comes back to this.
installSchedules(JSON.parse(readFileSync(`${process.cwd()}/public/data/schedules.json`, 'utf8')));

const testBed = getTestBed();
try {
  testBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting(), {
    teardown: { destroyAfterEach: true },
  });
} catch {
  // Already initialised (setup file re-evaluated in the same worker).
}

// ---- jsdom gaps --------------------------------------------------------------
if (typeof window !== 'undefined') {
  // jsdom logs "Not implemented" for canvas; report "no 2D context" quietly (celebrate() then skips).
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  }
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });
  }

  const dialogProto = (globalThis as { HTMLDialogElement?: { prototype: HTMLDialogElement } })
    .HTMLDialogElement?.prototype;
  if (dialogProto) {
    if (!dialogProto.showModal) {
      dialogProto.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
    }
    if (!dialogProto.show) {
      dialogProto.show = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
    }
    if (!dialogProto.close) {
      dialogProto.close = function (this: HTMLDialogElement, returnValue?: string) {
        if (!this.hasAttribute('open')) return;
        if (returnValue !== undefined) this.returnValue = returnValue;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  }

  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  const g = globalThis as Record<string, unknown>;
  if (!g['ResizeObserver']) g['ResizeObserver'] = NoopObserver;
  if (!g['IntersectionObserver']) g['IntersectionObserver'] = NoopObserver;

  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}
