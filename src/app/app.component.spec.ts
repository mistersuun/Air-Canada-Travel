import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { resetScheduleSource, setScheduleSource } from './data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from './data/testing/schedule-fixtures';
import { AppStateService, NOW } from './state/app-state.service';
import { PREFS_STORAGE } from './state/prefs.service';
import { PwaUpdateService } from './state/pwa-update.service';
import { MemoryStorage } from './state/testing';
import { TRIPS_STORAGE } from './trips/storage';
import { TRIPS_KEY } from './trips/model';
import { SEVILLE_TRIPS_FILE } from './trips/testing/seville-fixture';

const NOW_MS = new Date('2026-10-01T12:00:00').getTime();

// The first render compiles the lazy page chunks; allow for a busy machine.
describe('AppComponent (shell)', { timeout: 20_000 }, () => {
  let fixture: ComponentFixture<AppComponent>;
  let el: HTMLElement;
  let state: AppStateService;
  let router: Router;
  let versionUpdates: Subject<VersionEvent>;
  let unrecoverable: Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>;
  let checkForUpdate: ReturnType<typeof vi.fn>;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      TestBed.tick();
      await TestBed.inject(ApplicationRef).whenStable();
      await new Promise(r => setTimeout(r, 0));
    }
  }

  let tripsStorage: MemoryStorage;

  async function render(url = '/'): Promise<void> {
    window.history.replaceState(null, '', url);
    tripsStorage ??= new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        { provide: PlatformLocation, useClass: BrowserPlatformLocation },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: TRIPS_STORAGE, useValue: tripsStorage },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates, unrecoverable, checkForUpdate } },
      ],
    });
    fixture = TestBed.createComponent(AppComponent);
    el = fixture.nativeElement;
    state = TestBed.inject(AppStateService);
    router = TestBed.inject(Router);
    router.initialNavigation();
    await settle();
  }

  const path = () => window.location.pathname;
  const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    versionUpdates = new Subject<VersionEvent>();
    unrecoverable = new Subject();
    checkForUpdate = vi.fn().mockResolvedValue(false);
  });

  afterEach(() => {
    tripsStorage = undefined!;
    vi.useRealTimers();
    resetScheduleSource();
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the skip link, top nav, routed page and tab bar, with the sky wash on Explore', async () => {
    await render();
    expect(el.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    expect(el.querySelector('app-top-nav nav')).toBeTruthy();
    expect(el.querySelector('main#main app-home-page')).toBeTruthy();
    expect(el.querySelector('app-tab-bar nav')).toBeTruthy();
    expect(el.classList).toContain('ui-skywash');
  });

  it('nav links change route and aria-current follows', async () => {
    await render();
    const links = () => [...el.querySelectorAll<HTMLAnchorElement>('app-top-nav .seg__a')];
    expect(links().map(a => a.textContent?.trim())).toEqual(['Explore', 'Map', 'Trips', 'Calendar']);
    expect(links()[0].getAttribute('aria-current')).toBe('page');
    links()[1].click();
    await settle();
    expect(path()).toBe('/map');
    expect(el.querySelector('app-map-page')).toBeTruthy();
    expect(links()[1].getAttribute('aria-current')).toBe('page');
    expect(links()[0].getAttribute('aria-current')).toBeNull();
    expect(el.classList).not.toContain('ui-skywash');
    expect(el.querySelector('app-top-nav')!.classList).toContain('is-overlay');

    links()[2].click();
    await settle();
    expect(path()).toBe('/trips');
    expect(el.querySelector('app-trips-page')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('from')).toBe('YUL');
    const tab = el.querySelector<HTMLAnchorElement>('app-tab-bar a[aria-current="page"]')!;
    expect(tab.textContent?.trim()).toBe('Trips');
    expect(el.querySelector('app-tab-bar')!.classList).not.toContain('is-hidden');

    // The full starred view stays, under the Trips section.
    await router.navigateByUrl('/saved');
    await settle();
    expect(el.querySelector('app-saved-page')).toBeTruthy();
    expect(links()[2].getAttribute('aria-current')).toBe('page');
  });

  it('routes the Trips v2 screens', async () => {
    tripsStorage = new MemoryStorage();
    tripsStorage.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    await render();

    await router.navigateByUrl('/trips/sevtrip001?tab=return');
    await settle();
    expect(el.querySelector('app-trip-detail-page app-return-tab')).toBeTruthy();
    expect(el.querySelector('app-tab-bar')!.classList).toContain('is-hidden');
    expect(document.title).toBe('Seville trip · Routes');

    await router.navigateByUrl('/trips/nope123456');
    await settle();
    expect(path()).toBe('/trips');

    await router.navigateByUrl('/trips/import');
    await settle();
    expect(el.querySelector('app-trip-import-page')).toBeTruthy();

    await router.navigateByUrl('/trips/sevtrip001/recover?at=YUL');
    await settle();
    expect(el.querySelector('app-recover-page')).toBeTruthy();

    await router.navigateByUrl('/today');
    await settle();
    expect(el.querySelector('app-today-page')).toBeTruthy();
    expect(el.classList).not.toContain('ui-skywash');

    await router.navigateByUrl('/reach/gn-2510911');
    await settle();
    expect(el.querySelector('app-reach-page')).toBeTruthy();
    expect(el.classList).toContain('ui-skywash');

    await router.navigateByUrl('/reach/gn-2510911/MAD');
    await settle();
    expect(el.querySelector('app-gateway-page')).toBeTruthy();
    expect(el.querySelector('app-top-nav a[aria-current="page"]')?.textContent?.trim()).toBe('Explore');
  });

  it('hides the tab bar on detail pages and the top nav on /to', async () => {
    await render();
    await router.navigateByUrl('/to/LHR');
    await settle();
    expect(el.querySelector('app-destination-page')?.textContent).toContain('LHR');
    expect(el.querySelector('app-tab-bar')!.classList).toContain('is-hidden');
    expect(el.querySelector('app-top-nav')!.classList).toContain('is-hidden');

    await router.navigateByUrl('/flight/LHR/2026-10-02/AC864');
    await settle();
    expect(el.querySelector('app-flight-page')?.textContent).toContain('AC864');
    expect(el.querySelector('app-tab-bar')!.classList).toContain('is-hidden');
    expect(el.querySelector('app-top-nav')!.classList).not.toContain('is-hidden');
    expect(el.classList).toContain('ui-skywash');

    await router.navigateByUrl('/calendar/LHR');
    await settle();
    expect(el.querySelector('app-tab-bar')!.classList).toContain('is-hidden');
    expect(el.querySelector('app-top-nav a[aria-current="page"]')?.textContent?.trim()).toBe('Calendar');
  });

  it('guards: lowercase and renamed codes redirect, unknown codes and bad dates fall back', async () => {
    await render();
    await router.navigateByUrl('/to/lhr');
    await settle();
    expect(path()).toBe('/to/LHR');
    await router.navigateByUrl('/to/PBI');
    await settle();
    expect(path()).toBe('/to/DJT');
    await router.navigateByUrl('/to/ZZZ');
    await settle();
    expect(path()).toBe('/');
    await router.navigateByUrl('/flight/LHR/not-a-date');
    await settle();
    expect(path()).toBe('/to/LHR');
    await router.navigateByUrl('/nowhere');
    await settle();
    expect(path()).toBe('/');
  });

  it('a legacy ?dest= link lands on the destination page', async () => {
    await render('/?dest=LHR&from=YYZ');
    expect(path()).toBe('/to/LHR');
    expect(new URLSearchParams(window.location.search).get('from')).toBe('YYZ');
    expect(state.hub()).toBe('YYZ');
  });

  it('the settings gear opens the sheet, Done closes it', async () => {
    await render();
    el.querySelector<HTMLButtonElement>('app-top-nav [aria-label="Settings"]')!.click();
    await settle();
    expect(el.querySelector('app-settings dialog')?.hasAttribute('open')).toBe(true);
    el.querySelector<HTMLButtonElement>('app-settings [data-done]')!.click();
    await settle();
    expect(el.querySelector('app-settings')).toBeNull();
    expect(state.settingsOpen()).toBe(false);

    el.querySelector<HTMLButtonElement>('app-tab-bar [aria-label="Settings"]')!.click();
    await settle();
    expect(el.querySelector('app-settings')).toBeTruthy();
  });

  it('shows the update toast before notices; Reload reloads and the toast dismisses', async () => {
    await render();
    const pwa = TestBed.inject(PwaUpdateService);
    const reload = vi.spyOn(pwa, 'reload').mockImplementation(() => undefined);
    state.flash('Link copied');
    await settle();
    expect(el.querySelector('app-toast')?.textContent).toContain('Link copied');
    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    await settle();
    const toast = el.querySelector('app-toast')!;
    expect(toast.textContent).toContain('New schedules available');
    [...toast.querySelectorAll('button')].find(b => b.textContent?.includes('Reload'))!.click();
    expect(reload).toHaveBeenCalled();
    toast.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click();
    await settle();
    expect(el.querySelector('app-toast')?.textContent).toContain('Link copied');
    el.querySelector<HTMLButtonElement>('app-toast [aria-label="Dismiss"]')!.click();
    await settle();
    expect(el.querySelector('app-toast')).toBeNull();
  });

  it('holds the update toast back on a pass view and shows it once the user leaves', async () => {
    await render();
    state.path.set('/trips/t1/pass/p1');
    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    await settle();
    expect(el.querySelector('app-toast')).toBeNull();
    state.path.set('/saved');
    await settle();
    expect(el.querySelector('app-toast')?.textContent).toContain('New schedules available');
  });

  it('offers a repair reload when the service worker is unrecoverable', async () => {
    await render();
    const pwa = TestBed.inject(PwaUpdateService);
    const reload = vi.spyOn(pwa, 'reload').mockImplementation(() => undefined);
    state.path.set('/trips/t1/pass/p1');
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'corrupt' });
    await settle();
    const toast = el.querySelector('app-toast')!;
    expect(toast.textContent).toContain('The app needs to reload to repair itself');
    [...toast.querySelectorAll('button')].find(b => b.textContent?.includes('Reload'))!.click();
    expect(reload).toHaveBeenCalled();
  });

  it('says so when the schedules failed to load, and Retry re-runs the load', async () => {
    await render();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    state.reportDataLoad(false);
    await settle();
    const banner = el.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain("Couldn't load flight schedules. Results are empty, not cancelled.");
    const retry = vi.spyOn(state, 'retryDataLoad').mockResolvedValue(undefined);
    banner.querySelector('button')!.click();
    expect(retry).toHaveBeenCalled();
    state.reportDataLoad(true);
    await settle();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('tapping the stale tag shows its detail as a notice', async () => {
    await render();
    state.todayKey.set('2027-03-20');
    await settle();
    el.querySelector<HTMLButtonElement>('app-top-nav button.ui-tag')!.click();
    await settle();
    expect(el.querySelector('app-toast')?.textContent).toContain('Published schedules end in');
  });

  it('notice actions run from the toast', async () => {
    await render();
    const run = vi.fn();
    state.flash('Removed Lisbon', { label: 'Undo', run });
    await settle();
    [...el.querySelectorAll<HTMLButtonElement>('app-toast button')].find(b => b.textContent?.includes('Undo'))!.click();
    expect(run).toHaveBeenCalled();
  });

  it('checks for updates and refreshes today when the tab becomes visible', async () => {
    await render();
    const refresh = vi.spyOn(state, 'refreshToday');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalled();
    expect(checkForUpdate).toHaveBeenCalled();
  });

  describe('shortcuts', () => {
    it('? opens the shortcuts sheet', async () => {
      await render();
      key('?');
      await settle();
      expect(el.querySelector('app-shortcuts-sheet dialog')?.textContent).toContain('Back / close');
    });

    it('/ focuses the page search field', async () => {
      await render();
      const input = el.querySelector<HTMLInputElement>('main [data-search-input]')!;
      expect(input).toBeTruthy();
      key('/');
      expect(document.activeElement).toBe(input);
    });

    it('/ on a page without search opens Explore', async () => {
      await render();
      await router.navigateByUrl('/saved');
      await settle();
      expect(el.querySelector('main [data-search-input]')).toBeNull();
      key('/');
      await settle();
      expect(path()).toBe('/');
    });

    it('Esc goes back from a detail page, and clears the search on Explore', async () => {
      await render('/?q=lon');
      expect(state.query()).toBe('lon');
      state.goToDestination('LHR');
      await settle();
      expect(path()).toBe('/to/LHR');
      key('Escape');
      await settle();
      expect(path()).toBe('/');
      key('Escape');
      expect(state.query()).toBe('');
    });

    it('ignores shortcuts while a dialog is open', async () => {
      await render();
      state.openSettings();
      await settle();
      key('?');
      expect(state.shortcutsOpen()).toBe(false);
    });
  });
});
