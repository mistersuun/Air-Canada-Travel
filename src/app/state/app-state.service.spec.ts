import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { resetScheduleSource, setScheduleSource, getCoverage } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../data/testing/schedule-fixtures';
import { computeRoutes, hubStats } from '../utils/routes';
import { summarizeWeek } from '../utils/connections';
import { getFlightsForWeek } from '../utils/week';
import { AppStateService, NOW, ROUTES_ENGINE, RoutesEngine } from './app-state.service';
import { PREFS_KEY, PREFS_STORAGE, PrefsService } from './prefs.service';
import { MemoryStorage } from './testing';

// Thursday 1 Oct 2026, noon local: week starts Mon 28 Sep.
const NOW_MS = new Date('2026-10-01T12:00:00').getTime();

function engineSpy() {
  const spy = { computeRoutes: vi.fn(computeRoutes), hubStats: vi.fn(hubStats) };
  const engine: RoutesEngine = { computeRoutes: spy.computeRoutes, hubStats: spy.hubStats, getCoverage, getFlightsForWeek, summarizeWeek };
  return { spy, engine };
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
    it('boots from ?from=YYZ&day=…&dest=LHR without saving the hub', () => {
      const storage = new MemoryStorage();
      const { state, prefs } = setup({ url: '?from=YYZ&day=2026-10-07&dest=LHR&region=Europe&q=lon', storage });
      expect(state.hub()).toBe('YYZ');
      expect(prefs.hub()).toBe('YUL');
      expect(state.weekStartKey()).toBe('2026-10-05');
      expect(state.selectedDateKey()).toBe('2026-10-07');
      expect(state.openCode()).toBe('LHR');
      expect(state.openDestination()?.city).toBe('London');
      expect(state.openEntry()?.destination.code).toBe('LHR');
      expect(state.region()).toBe('Europe');
      expect(state.query()).toBe('lon');
    });

    it('falls back to prefs for invalid params', () => {
      const { state } = setup({ url: '?from=NOPE&day=bad&dest=ZZZ' });
      expect(state.hub()).toBe('YUL');
      expect(state.selectedDateKey()).toBeNull();
      expect(state.openCode()).toBeNull();
    });

    it('mirrors state with replaceState, leaving defaults out', () => {
      const { state } = setup();
      const before = window.history.length;
      TestBed.tick();
      expect(search()).toBe('?from=YUL');
      state.setRegion('Europe');
      state.selectDay('2026-10-02');
      state.setQuery('lon');
      TestBed.tick();
      expect(search()).toBe('?from=YUL&day=2026-10-02&region=Europe&q=lon');
      state.selectDay(null);
      state.nextWeek();
      TestBed.tick();
      expect(search()).toBe('?from=YUL&week=2026-10-05&region=Europe&q=lon');
      expect(window.history.length).toBe(before);
    });

    it('pushes a history entry when a destination opens, and Back closes it', async () => {
      const { state } = setup();
      TestBed.tick();
      const before = window.history.length;
      state.openDestinationByCode('LHR');
      TestBed.tick();
      expect(window.history.length).toBe(before + 1);
      expect(search()).toContain('dest=LHR');

      // Simulate the browser's Back button.
      const popped = new Promise(r => window.addEventListener('popstate', r, { once: true }));
      window.history.back();
      await popped;
      expect(state.openCode()).toBeNull();
      expect(search()).not.toContain('dest=');
    });

    it('closing the modal in the UI pops the pushed entry and keeps later state', async () => {
      const { state } = setup();
      TestBed.tick();
      state.openDestinationByCode('LHR');
      TestBed.tick();
      state.jumpTo('2026-10-14'); // e.g. a calendar tap inside the modal
      TestBed.tick();
      const popped = new Promise(r => window.addEventListener('popstate', r, { once: true }));
      state.closeDestination();
      expect(state.openCode()).toBeNull();
      await popped;
      TestBed.tick();
      expect(state.selectedDateKey()).toBe('2026-10-14');
      expect(search()).toBe('?from=YUL&day=2026-10-14');
    });

    it('a deep-linked modal sits on its own history entry, so Back closes it and stays in the app', async () => {
      const { state } = setup({ url: '?from=YYZ&dest=LHR' });
      TestBed.tick();
      expect(state.openCode()).toBe('LHR');
      expect(window.history.state?.acModal).toBe(true);
      expect(search()).toBe('?from=YYZ&dest=LHR');

      const popped = new Promise(r => window.addEventListener('popstate', r, { once: true }));
      window.history.back();
      await popped;
      TestBed.tick();
      expect(state.openCode()).toBeNull();
      expect(search()).toBe('?from=YYZ');
    });

    it('closing a deep-linked modal in the UI pops its entry', async () => {
      const { state } = setup({ url: '?dest=LHR' });
      TestBed.tick();
      const popped = new Promise(r => window.addEventListener('popstate', r, { once: true }));
      state.closeDestination();
      await popped;
      TestBed.tick();
      expect(state.openCode()).toBeNull();
      expect(search()).toBe('?from=YUL');
    });

    it('ignores unknown destination codes', () => {
      const { state } = setup();
      state.openDestinationByCode('ZZZ');
      expect(state.openCode()).toBeNull();
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
