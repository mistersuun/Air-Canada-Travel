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

const NOW_MS = new Date('2026-10-01T12:00:00').getTime();

// The first render compiles the lazy page chunks; allow for a busy machine.
describe('AppComponent (shell)', { timeout: 20_000 }, () => {
  let fixture: ComponentFixture<AppComponent>;
  let el: HTMLElement;
  let state: AppStateService;
  let router: Router;
  let versionUpdates: Subject<VersionEvent>;
  let checkForUpdate: ReturnType<typeof vi.fn>;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      TestBed.tick();
      await TestBed.inject(ApplicationRef).whenStable();
      await new Promise(r => setTimeout(r, 0));
    }
  }

  async function render(url = '/'): Promise<void> {
    window.history.replaceState(null, '', url);
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        { provide: PlatformLocation, useClass: BrowserPlatformLocation },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates, checkForUpdate } },
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
    checkForUpdate = vi.fn().mockResolvedValue(false);
  });

  afterEach(() => {
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
    expect(links().map(a => a.textContent?.trim())).toEqual(['Explore', 'Map', 'Saved', 'Calendar']);
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
    expect(path()).toBe('/saved');
    expect(new URLSearchParams(window.location.search).get('from')).toBe('YUL');
    const tab = el.querySelector<HTMLAnchorElement>('app-tab-bar a[aria-current="page"]')!;
    expect(tab.textContent?.trim()).toBe('Saved');
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
