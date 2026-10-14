import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { TripsPage } from './trips.page';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');

async function render(withTrips: boolean) {
  const trips = new MemoryStorage();
  if (withTrips) trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  const prefs = new MemoryStorage();
  prefs.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL' }));
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
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Trips page: New trip and links', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('shows + New trip whether or not trips exist, with Saved and Logbook links', async () => {
    for (const withTrips of [true, false]) {
      TestBed.resetTestingModule();
      const { el } = await render(withTrips);
      expect(el.querySelector('[data-new-trip]')?.textContent?.trim()).toBe('+ New trip');
      expect(el.querySelector<HTMLAnchorElement>('[data-link-saved]')!.getAttribute('href')).toMatch(/^\/saved/);
      expect(el.querySelector<HTMLAnchorElement>('[data-link-logbook]')!.getAttribute('href')).toMatch(/^\/logbook/);
    }
  });

  it('searches a place and opens the destination page of an Air Canada city', async () => {
    const { fixture, el } = await render(true);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('[data-new-trip]')!.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('[data-place-search]')!;
    input.value = 'lis';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const row = el.querySelector<HTMLButtonElement>('[data-place="ac-LIS"]')!;
    expect(row.textContent).toContain('Lisbon');
    row.click();
    expect(nav).toHaveBeenCalledTimes(1);
    // Air Canada flies to Lisbon: its destination page has "Start a trip".
    expect(nav.mock.calls[0][0]).toEqual(['/to', 'LIS']);
  });
});
