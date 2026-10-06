import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY, TripsFile } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { TripsPage } from './trips.page';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');

async function render(file: TripsFile | null, favourites: string[] = ['MAD', 'LIS', 'BCN', 'OPO']) {
  const trips = new MemoryStorage();
  if (file) trips.setItem(TRIPS_KEY, JSON.stringify(file));
  const prefs = new MemoryStorage();
  prefs.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', favourites }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: prefs },
    ],
  });
  const fixture = TestBed.createComponent(TripsPage);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const text = (sel: string, root: ParentNode = el) => (root.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const all = (sel: string) => [...el.querySelectorAll(sel)].map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
  return { fixture, el, text, all };
}

describe('TripsPage', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('shows the Seville trip as the g2 timeline card', async () => {
    const { el, text, all } = await render(SEVILLE_TRIPS_FILE);
    expect(text('h1')).toBe('Trips');
    expect(text('.tc__name')).toBe('Seville');
    expect(text('.tc__dates')).toBe('Thu Oct 8 → home by Tue Oct 13, 22:00');
    expect(text('[data-countdown]')).toBe('7 sleeps to Seville');
    expect(all('.tc__chip')).toEqual(['2 travellers · stay together', 'From YUL']);
    expect(all('.tl__top app-leg-status-tag, .tl__top app-provenance-tag')).toEqual(['Listed', 'Estimated', 'Saved by you', 'Planned']);
    expect(all('.tl__m')[0]).toBe('17:55 → 06:50⁺¹ · 2 backups · Scheduled');
    expect(all('.tl__m')[3]).toContain('home 8h before your deadline');
    expect(text('.tl__end')).toBe('Home, Montréal');
    expect(text('[data-return-warning]')).toBe(
      'Return leg not listed yet. Listing usually opens a few days before; check your pass rules.');
    // Legs link to the trip with ?leg=.
    const a = el.querySelector<HTMLAnchorElement>('[data-leg="leg-ret813"] a')!;
    expect(a.getAttribute('href')).toMatch(/^\/trips\/sevtrip001\?.*leg=leg-ret813/);
    expect(el.querySelector('[data-empty]')).toBeNull();
  });

  it('keeps the starred places: top 3 and "All N" → /saved', async () => {
    const { el, text } = await render(SEVILLE_TRIPS_FILE);
    expect(text('[data-starred] h2')).toBe('Starred places');
    const all = el.querySelector<HTMLAnchorElement>('[data-starred] .ui-sec-h a')!;
    expect(all.textContent?.trim()).toBe('All 4');
    expect(all.getAttribute('href')).toMatch(/^\/saved/);
    expect(el.querySelectorAll('[data-starred] app-dest-row')).toHaveLength(3);
  });

  it('a starred place the network lists but the schedules do not says times are not in our data', async () => {
    setRouteNetworkSource({ ...ROUTE_NETWORK_FIXTURE, routes: { 'YUL-BOS': ['X', 0, null, null, null] } });
    try {
      const { all } = await render(SEVILLE_TRIPS_FILE, ['BOS', 'EWR']);
      expect(all('[data-starred] app-dest-row .tm')).toEqual([
        'USA · flies this route · times not in our data',
        'USA · not found in our schedule data',
      ]);
    } finally {
      resetRouteNetworkSource();
    }
  });

  it('shows the empty state and hides the starred section without favourites', async () => {
    const { el, text } = await render(null, []);
    expect(text('[data-empty] h2')).toBe('No trips yet');
    expect(text('[data-empty] p')).toBe('Search a city on Explore, or open a destination and tap Start a trip.');
    expect(el.querySelector('[data-starred]')).toBeNull();
    expect(el.querySelector('app-trip-card')).toBeNull();
  });

  it('shows later trips compact and folds past trips away', async () => {
    const later = { ...sevilleTrip(), id: 'later00001', name: 'Lisbon trip', outboundDate: '2026-11-02',
      homeBy: { dateKey: '2026-11-08', hhmm: '20:00' }, goal: { ...sevilleTrip().goal, name: 'Lisbon' }, legs: [] };
    const past = { ...sevilleTrip(), id: 'past000001', outboundDate: '2026-09-01', homeBy: { dateKey: '2026-09-05', hhmm: '20:00' }, legs: [] };
    const { el, all } = await render({ schema: 1, trips: [SEVILLE_TRIPS_FILE.trips[0], later, past] });
    const cards = el.querySelectorAll('.tp > app-trip-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.tc')!.classList).not.toContain('is-compact');
    expect(cards[1].querySelector('.tc')!.classList).toContain('is-compact');
    expect(cards[1].textContent).toContain('No legs yet');
    expect(el.querySelector('[data-past] summary')!.textContent).toContain('Past trips');
    expect(el.querySelectorAll('[data-past] app-trip-card')).toHaveLength(1);
    expect(all('[data-countdown]')).toEqual(['7 sleeps to Seville', 'In 32 days', 'Done']);
  });
});
