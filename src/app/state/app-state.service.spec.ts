import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource, getCoverage } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../data/testing/schedule-fixtures';
import { computeRoutes, hubStats } from '../utils/routes';
import { summarizeWeek } from '../utils/connections';
import { getFlightsForWeek } from '../utils/week';
import { AppStateService, NOTICE_MS, NOW, ROUTES_ENGINE, RoutesEngine } from './app-state.service';
import { PREFS_KEY, PREFS_STORAGE, PrefsService } from './prefs.service';
import { MemoryStorage } from './testing';

// Thursday 1 Oct 2026, noon local: week starts Mon 28 Sep.
const NOW_MS = new Date('2026-10-01T12:00:00').getTime();

function engineSpy() {
  const spy = { computeRoutes: vi.fn(computeRoutes), hubStats: vi.fn(hubStats) };
  const engine: RoutesEngine = { computeRoutes: spy.computeRoutes, hubStats: spy.hubStats, getCoverage, getFlightsForWeek, summarizeWeek };
  return { spy, engine };
}

@Component({ standalone: true, template: '' })
class BlankPage {}

const TEST_ROUTES = [
  { path: '', component: BlankPage },
  { path: 'to/:code', component: BlankPage },
  { path: 'map', component: BlankPage },
  { path: '**', redirectTo: '' },
];

/** Let effects run and pending navigations finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise(r => setTimeout(r, 0)); // popstate navigations are scheduled
  }
}

function setup(opts: { url?: string; storage?: Storage; now?: () => number } = {}) {
  window.history.replaceState(null, '', `/${opts.url ?? ''}`);
  const { spy, engine } = engineSpy();
  const clock = { now: NOW_MS };
  TestBed.configureTestingModule({
    providers: [
      { provide: PREFS_STORAGE, useValue: opts.storage ?? new MemoryStorage() },
      { provide: ROUTES_ENGINE, useValue: engine },
      { provide: NOW, useValue: opts.now ?? (() => clock.now) },
      provideRouter(TEST_ROUTES),
      { provide: PlatformLocation, useClass: BrowserPlatformLocation },
    ],
  });
  const state = TestBed.inject(AppStateService);
  const prefs = TestBed.inject(PrefsService);
  return { state, prefs, spy, clock };
}

const search = () => window.location.search;

describe('AppStateService', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => {
    resetScheduleSource();
    window.history.replaceState(null, '', '/');
  });

  describe('defaults', () => {
    it('starts on the current week with no day, at the default hub', () => {
      const { state } = setup();
      expect(state.todayKey()).toBe('2026-10-01');
      expect(state.weekStartKey()).toBe('2026-09-28');
      expect(state.selectedDateKey()).toBeNull();
      expect(state.hub()).toBe('YUL');
      expect(state.hubName()).toBe('Montreal');
      expect(state.region()).toBe('All');
    });

    it('restores hub, region and connections from saved prefs', () => {
      const storage = new MemoryStorage();
      storage.setItem(PREFS_KEY, JSON.stringify({ hub: 'YYZ', region: 'Europe', showConnections: false }));
      const { state } = setup({ storage });
      expect(state.hub()).toBe('YYZ');
      expect(state.region()).toBe('Europe');
      expect(state.showConnections()).toBe(false);
    });
  });

  describe('routes', () => {
    it('computes routes for the hub and week from the fixtures', () => {
      const { state } = setup();
      const codes = state.routes().filter(r => r.isDirect).map(r => r.destination.code);
      expect(codes).toContain('LHR');
      expect(codes).toContain('ATH');
    });

    it('runs computeRoutes only when an input signal changes', () => {
      const { state, prefs, spy } = setup();
      state.routes();
      state.routes();
      expect(spy.computeRoutes).toHaveBeenCalledTimes(1);

      // Unrelated state: theme, time format, opening settings.
      prefs.setTheme('dark');
      prefs.update({ timeFormat: '12h' });
      state.routes();
      expect(spy.computeRoutes).toHaveBeenCalledTimes(1);

      state.selectDay('2026-10-02');
      state.routes();
      expect(spy.computeRoutes).toHaveBeenCalledTimes(2);
      expect(spy.computeRoutes.mock.lastCall![0]).toMatchObject({ home: 'YUL', weekStartKey: '2026-09-28', dateKey: '2026-10-02' });
    });

    it('passes favourites, sort, filters, query and connection prefs through', () => {
      const { state, prefs, spy } = setup();
      prefs.toggleFavourite('ATH');
      prefs.update({ minConnect: 90 });
      state.setSort('days');
      state.setQuery('  athens ');
      state.setFilters({ widebodyOnly: true });
      state.routes();
      const arg = spy.computeRoutes.mock.lastCall![0];
      expect(arg.favourites).toEqual(['ATH']);
      expect(arg.sort).toBe('days');
      expect(arg.query).toBe('athens');
      expect(arg.filters?.widebodyOnly).toBe(true);
      expect(arg.connect).toMatchObject({ minConnect: 90 });
      expect(state.routes().map(r => r.destination.code)).toEqual(['ATH']);
    });

    it('filters by region', () => {
      const { state } = setup();
      state.setRegion('Europe');
      expect(state.routes().length).toBeGreaterThan(0);
      expect(state.routes().every(r => r.destination.region === 'Europe')).toBe(true);
    });

    it('returns no routes for a week outside the fixture coverage, and exposes coverage', () => {
      const { state } = setup();
      state.goToWeek('2020-01-06');
      expect(state.routes()).toHaveLength(0);
      expect(state.coverage().to).toBeTruthy();
    });
  });

  describe('navigation', () => {
    it('prev/next move by one week with date keys and clear the day', () => {
      const { state } = setup();
      state.selectDay('2026-10-01');
      state.nextWeek();
      expect(state.weekStartKey()).toBe('2026-10-05');
      expect(state.selectedDateKey()).toBeNull();
      state.prevWeek();
      state.prevWeek();
      expect(state.weekStartKey()).toBe('2026-09-21');
    });

    it('prev/next cross month and DST boundaries by calendar days', () => {
      const { state } = setup();
      state.goToWeek('2026-10-26');
      state.nextWeek(); // DST ends 1 Nov in North America
      expect(state.weekStartKey()).toBe('2026-11-02');
    });

    it('jumpTo selects the day and moves to its week', () => {
      const { state } = setup();
      state.jumpTo('2026-12-31');
      expect(state.weekStartKey()).toBe('2026-12-28');
      expect(state.selectedDateKey()).toBe('2026-12-31');
    });

    it('ignores invalid keys', () => {
      const { state } = setup();
      state.goToWeek('nope');
      state.selectDay('2026-13-01');
      expect(state.weekStartKey()).toBe('2026-09-28');
      expect(state.selectedDateKey()).toBeNull();
    });

    it('clearing the day resets a departure sort', () => {
      const { state } = setup();
      state.selectDay('2026-10-01');
      state.setSort('departure');
      state.selectDay(null);
      expect(state.sort()).toBe('az');
    });

    it('jumpToCoverage goes to the given key or the last covered week', () => {
      const { state } = setup();
      state.jumpToCoverage();
      expect(state.weekStartKey()).toBe('2027-03-29'); // fixture coverage ends 2027-03-31
      state.jumpToCoverage('2026-11-11');
      expect(state.weekStartKey()).toBe('2026-11-09');
    });

    it('setHub and setRegion save to prefs; invalid values are ignored', () => {
      const storage = new MemoryStorage();
      const { state } = setup({ storage });
      state.setHub('YVR');
      state.setHub('XXX');
      state.setRegion('Mexico');
      state.setRegion('Atlantis');
      expect(state.hub()).toBe('YVR');
      expect(state.region()).toBe('Mexico');
      expect(JSON.parse(storage.getItem(PREFS_KEY)!)).toMatchObject({ hub: 'YVR', region: 'Mexico' });
    });

    it('clearFilters resets filters, query and region', () => {
      const { state } = setup();
      state.setFilters({ types: ['Sun'] });
      state.setQuery('lis');
      state.setRegion('Europe');
      expect(state.activeFilterCount()).toBe(2);
      expect(state.hasActiveFilters()).toBe(true);
      state.clearFilters();
      expect(state.activeFilterCount()).toBe(0);
      expect(state.hasActiveFilters()).toBe(false);
      expect(state.region()).toBe('All');
    });
  });

  describe('midnight and week rollover', () => {
    it('moves an untouched past week to the current week when the tab returns', () => {
      const { state, clock } = setup();
      clock.now = new Date('2026-10-05T08:00:00').getTime(); // next Monday
      state.refreshToday();
      expect(state.todayKey()).toBe('2026-10-05');
      expect(state.weekStartKey()).toBe('2026-10-05');
    });

    it('leaves a week the user chose alone', () => {
      const { state, clock } = setup();
      state.goToWeek('2026-09-21');
      clock.now = new Date('2026-10-05T08:00:00').getTime();
      state.refreshToday();
      expect(state.todayKey()).toBe('2026-10-05');
      expect(state.weekStartKey()).toBe('2026-09-21');
    });
  });

  describe('URL', () => {
    async function boot(url = '', storage?: Storage) {
      const env = setup({ url, storage });
      const router = TestBed.inject(Router);
      router.initialNavigation();
      await settle();
      return { ...env, router };
    }

    it('boots from ?from=YYZ&day=…&region=…&q=… without saving the hub', async () => {
      const storage = new MemoryStorage();
      const { state, prefs } = await boot('?from=YYZ&day=2026-10-07&region=Europe&q=lon', storage);
      expect(state.hub()).toBe('YYZ');
      expect(prefs.hub()).toBe('YUL');
      expect(state.weekStartKey()).toBe('2026-10-05');
      expect(state.selectedDateKey()).toBe('2026-10-07');
      expect(state.region()).toBe('Europe');
      expect(state.query()).toBe('lon');
    });

    it('falls back to prefs for invalid params', async () => {
      const { state } = await boot('?from=NOPE&day=bad');
      expect(state.hub()).toBe('YUL');
      expect(state.selectedDateKey()).toBeNull();
    });

    it('mirrors the global keys with replaceUrl, leaving defaults out', async () => {
      const { state } = await boot();
      const before = window.history.length;
      expect(search()).toBe('?from=YUL');
      state.setRegion('Europe');
      state.selectDay('2026-10-02');
      state.setQuery('lon');
      await settle();
      expect(new URLSearchParams(search()).toString()).toBe('from=YUL&day=2026-10-02&region=Europe&q=lon');
      state.selectDay(null);
      state.nextWeek();
      await settle();
      const p = new URLSearchParams(search());
      expect(p.get('week')).toBe('2026-10-05');
      expect(p.has('day')).toBe(false);
      expect(window.history.length).toBe(before);
    });

    it('keeps page-owned keys when a global key changes', async () => {
      const { state, router } = await boot();
      await router.navigate(['/to', 'LHR'], { queryParams: { tab: 'map', from: 'YUL' } });
      await settle();
      state.selectDay('2026-10-02');
      await settle();
      const p = new URLSearchParams(search());
      expect(window.location.pathname).toBe('/to/LHR');
      expect(p.get('tab')).toBe('map');
      expect(p.get('day')).toBe('2026-10-02');
    });

    it('restores the global keys after a navigation that dropped them', async () => {
      const { state, router } = await boot('?q=lis');
      expect(state.query()).toBe('lis');
      await router.navigate(['/map']);
      await settle();
      expect(window.location.pathname).toBe('/map');
      expect(new URLSearchParams(search()).get('q')).toBe('lis');
      expect(state.path()).toBe('/map');
    });

    it('Back returns to the previous page with the global state as the user left it', async () => {
      const { state } = await boot();
      state.goToDestination('LHR');
      await settle();
      expect(window.location.pathname).toBe('/to/LHR');
      expect(state.canGoBack()).toBe(true);
      state.jumpTo('2026-10-14');
      await settle();
      const popped = new Promise(r => window.addEventListener('popstate', r, { once: true }));
      state.goBack();
      await popped;
      await settle();
      expect(window.location.pathname).toBe('/');
      expect(state.path()).toBe('/');
      expect(state.selectedDateKey()).toBe('2026-10-14');
      expect(new URLSearchParams(search()).get('day')).toBe('2026-10-14');
    });

    it('goBack without an in-app entry navigates to the fallback', async () => {
      const { state } = await boot();
      expect(state.canGoBack()).toBe(false);
      state.goBack(['/map']);
      await settle();
      expect(window.location.pathname).toBe('/map');
    });

    it('a staged deep link counts as an in-app Back', async () => {
      const { state } = await boot();
      state.markStagedBack();
      expect(state.canGoBack()).toBe(true);
    });

    it('globalParams carries the non-default keys for links', async () => {
      const { state } = await boot('?region=Europe');
      expect(state.globalParams()).toEqual({ from: 'YUL', region: 'Europe' });
    });
  });

  describe('shell state', () => {
    it('opens and closes settings and shortcuts', () => {
      const { state } = setup();
      state.openSettings();
      state.openShortcuts();
      expect(state.settingsOpen()).toBe(true);
      expect(state.shortcutsOpen()).toBe(true);
      state.closeSettings();
      state.closeShortcuts();
      expect(state.settingsOpen()).toBe(false);
      expect(state.shortcutsOpen()).toBe(false);
    });

    it('flash shows a notice that expires, longer with an action', () => {
      vi.useFakeTimers();
      try {
        const { state } = setup();
        state.flash('Link copied');
        expect(state.notice()).toEqual({ message: 'Link copied' });
        vi.advanceTimersByTime(NOTICE_MS);
        expect(state.notice()).toBeNull();
        const run = vi.fn();
        state.flash('Removed Lisbon', { label: 'Undo', run });
        vi.advanceTimersByTime(NOTICE_MS);
        expect(state.notice()?.actionLabel).toBe('Undo');
        state.notice()!.action!();
        expect(run).toHaveBeenCalled();
        expect(state.notice()).toBeNull();
        state.flash('x');
        state.dismissNotice();
        expect(state.notice()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('toggleFavourite and favouriteSet', () => {
      const { state } = setup();
      state.toggleFavourite('LHR');
      expect(state.favouriteSet().has('LHR')).toBe(true);
      state.toggleFavourite('LHR');
      expect(state.favouriteSet().size).toBe(0);
    });

    it('allRoutes ignores search, filters and region; routeByCode indexes them', () => {
      const { state } = setup();
      state.setQuery('athens');
      state.setRegion('Europe');
      expect(state.routes().map(r => r.destination.code)).toEqual(['ATH']);
      expect(state.allRoutes().length).toBeGreaterThan(1);
      expect(state.routeByCode().get('LHR')?.destination.city).toBe('London');
    });

    it('hubInfo, timeFormat and nowMs', () => {
      const { state, prefs, clock } = setup();
      expect(state.hubInfo().code).toBe('YUL');
      prefs.update({ timeFormat: '12h' });
      expect(state.timeFormat()).toBe('12h');
      clock.now += 60_000;
      state.refreshToday();
      expect(state.nowMs()).toBe(clock.now);
    });

    it('dataInfo describes the coverage and flags an old scrape or running-out coverage', () => {
      const { state, clock } = setup();
      const at = (iso: string) => { clock.now = new Date(`${iso}T12:00:00`).getTime(); state.refreshToday(); };
      const info = state.dataInfo();
      expect(info.to).toBe('2027-03-31');
      expect(info.updatedLabel).toBe('Updated Sep 28 · data to Mar 31, 2027');
      expect(info.staleTag).toBeNull();
      expect(info.staleDetail).toBe('');
      // Scrape 45 days old is fine; 46 flags it, while coverage is still long.
      at('2026-11-12');
      expect(state.dataInfo().staleTag).toBeNull();
      at('2026-11-13');
      expect(state.dataInfo().staleTag).toBe('Schedules last updated Sep 28');
      expect(state.dataInfo().staleDetail).toContain('46 days ago');
      // Coverage: 21 days left is not flagged for coverage (the old scrape still is), 20 is.
      at('2027-03-10');
      expect(state.dataInfo().staleTag).toBe('Schedules last updated Sep 28');
      at('2027-03-11');
      expect(state.dataInfo().staleTag).toBe('Schedules published to Mar 31');
      expect(state.dataInfo().staleDetail).toContain('20 days from today');
      // Last day is still "published to"; past it, "No schedules after".
      at('2027-03-31');
      expect(state.dataInfo().staleTag).toBe('Schedules published to Mar 31');
      at('2027-04-01');
      expect(state.dataInfo().staleTag).toBe('No schedules after Mar 31');
    });

    it('dataLoad starts ok; a retry that succeeds clears a failure and reloads the page', async () => {
      const { state } = setup();
      expect(state.dataLoad()).toBe('ok');
      state.reportDataLoad(false);
      expect(state.dataLoad()).toBe('failed');
      const file = JSON.parse(readFileSync(`${process.cwd()}/public/data/schedules.json`, 'utf8'));
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(file))));
      const reload = vi.spyOn(state, 'reloadPage').mockImplementation(() => undefined);
      try {
        await state.retryDataLoad();
        expect(state.dataLoad()).toBe('ok');
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
        setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
      }
    });

    it('a retry that fails stays failed, and going online retries a failed load', async () => {
      const { state } = setup();
      state.reportDataLoad(false);
      const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const reload = vi.spyOn(state, 'reloadPage').mockImplementation(() => undefined);
      try {
        await state.retryDataLoad();
        expect(state.dataLoad()).toBe('failed');
        expect(reload).not.toHaveBeenCalled();
        const before = fetchMock.mock.calls.length;
        window.dispatchEvent(new Event('online'));
        await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
        expect(state.dataLoad()).toBe('failed');
      } finally {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      }
    });
  });
  describe('starredThisWeek', () => {
    it('lists starred places with their operating days, sorted by city', () => {
      const { state, prefs } = setup();
      prefs.toggleFavourite('LHR');
      prefs.toggleFavourite('ATH');
      const items = state.starredThisWeek();
      expect(items.map(i => i.code)).toEqual(['ATH', 'LHR']);
      // Week of 28 Sep: ATH runs Mon/Wed/Fri from 1 Oct, so only Fri 2 Oct.
      expect(items[0]).toMatchObject({ city: 'Athens', days: 'Fri', direct: true, dayKeys: ['2026-10-02'] });
      expect(items[1].days).toBe('Mon Tue Wed Thu Fri Sat Sun');
    });

    it('includes starred places with no direct flight, marked not direct', () => {
      const { state, prefs } = setup();
      prefs.toggleFavourite('DEL'); // no YUL→DEL row in the fixtures
      prefs.update({ showConnections: false });
      expect(state.starredThisWeek()).toEqual([
        { code: 'DEL', city: 'Delhi', country: 'India', dayKeys: [], days: '', direct: false },
      ]);
    });
  });
});
