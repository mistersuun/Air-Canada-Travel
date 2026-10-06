import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { ALL_DAYS, rec, route } from '../../data/testing/schedule-fixtures';
import { PREFS_KEY, PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { FLIGHTLOG_KEY, TRIPS_KEY, type FlightLeg, type Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { sevilleTrip } from '../../trips/testing/seville-fixture';
import { LogbookPage } from './logbook.page';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(opts: { trip?: Trip; outcomes?: unknown[] } = {}) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify({ schema: 1, trips: opts.trip ? [opts.trip] : [] }));
  if (opts.outcomes) trips.setItem(FLIGHTLOG_KEY, JSON.stringify({ schema: 1, notes: [], outcomes: opts.outcomes, dismissed: [] }));
  const prefs = new MemoryStorage();
  prefs.setItem(PREFS_KEY, JSON.stringify({ hub: 'YUL' }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: prefs },
    ],
  });
  const fixture = TestBed.createComponent(LogbookPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function boardedTrip(): Trip {
  const t = sevilleTrip();
  for (const l of t.legs) if (l.kind === 'flight') (l as FlightLeg).status = 'boarded';
  return t;
}

describe('LogbookPage', () => {
  beforeEach(() => {
    setScheduleSource([
      route('YUL', 'LIS', rec('AC812', '21:45', '09:20', '2026-01-01', '2026-12-31', ALL_DAYS, '333')),
      route('YUL', 'CUN', rec('AC3', '08:00', '12:00', '2026-01-01', '2026-12-31', ALL_DAYS, '7M8')),
    ], null);
  });
  afterEach(() => resetScheduleSource());

  it('for a new traveller: no totals, faint inspiration stamps labelled as ideas, no marks', async () => {
    const el = await render();
    expect(el.querySelector('[data-empty]')).toBeTruthy();
    expect(el.querySelector('[data-stats]')).toBeNull();
    expect(clean(el.querySelector('[data-ideas-caption]')?.textContent)).toContain('Places you could go');
    const ideas = [...el.querySelectorAll('[data-ideas] li')].map(li => clean(li.querySelector('.code')?.textContent));
    expect(ideas.sort()).toEqual(['CUN', 'LIS']);
    expect(el.querySelector('[data-stamps]')).toBeNull();
    expect(el.querySelector('[data-achievements]')).toBeNull();
    expect(el.textContent).not.toMatch(/\d+\s*\/\s*\d+|streak|points/i);
  });

  it('counts boarded flights from trip legs and outcomes once, and shows earned stamps', async () => {
    const trip = boardedTrip();
    const out = trip.legs[0] as FlightLeg;
    const el = await render({
      trip,
      outcomes: [
        // Same instance as the trip leg: counted once.
        { id: 'o1', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', kind: 'allBoarded', partySize: 2, tripId: trip.id, note: '', recordedAt: '2026-10-09T00:00:00Z' },
        { id: 'o2', flightNumber: 'AC999', origin: 'YUL', dest: 'LIS', dateKey: '2026-11-01', kind: 'noneBoarded', partySize: 1, tripId: null, note: '', recordedAt: '2026-11-02T00:00:00Z' },
      ],
    });
    expect(out.refs[0].flightNumber).toBe('AC834');
    expect(clean(el.querySelector('[data-flights]')?.textContent)).toBe('2 flights');
    expect(clean(el.querySelector('[data-countries]')?.textContent)).toBe('3 countries');
    expect(clean(el.querySelector('[data-cities]')?.textContent)).toBe('3 cities');
    expect(clean(el.querySelector('[data-km] b')?.textContent)).toMatch(/^[\d,]+$/);
    expect(el.querySelector('[data-earth]')?.textContent).toContain('× around the Earth');
    expect(clean(el.querySelector('[data-longest]')?.textContent)).toContain('Longest flight');
    // Stamps are for arrivals: Madrid. Coming home to YUL earns none, and LIS was only left from.
    const codes = [...el.querySelectorAll('[data-stamps] li')].map(li => clean(li.querySelector('.code')?.textContent));
    expect(codes).toEqual(['MAD']);
    expect(el.querySelector('[data-ideas]')).toBeNull();
    expect(el.querySelector('[data-achievements]')).toBeNull();
  });

  it('stamps are tilted a few degrees and coloured by region', async () => {
    const el = await render({ trip: boardedTrip() });
    const li = el.querySelector('[data-stamps] li') as HTMLElement;
    expect(li.style.color).toContain('--region-');
    const svg = li.querySelector('svg') as SVGElement;
    expect(svg.style.transform).toMatch(/^rotate\(-?[0-5]deg\)$/);
    expect(svg.querySelector('rect')?.getAttribute('stroke-dasharray')).toBeTruthy();
  });
});
