import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { buildPrepChecklist } from '../places/prep';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { climateHighlights, DestClimateComponent } from '../pages/destination/dest-climate.component';
import { decodeClimate, climateFor, monthsBetween, typicalForMonths } from './climate';
import { CLIMATE_FETCH } from './climate.service';
import { CLIMATE_FIXTURE } from './testing/climate-fixture';

const idx = decodeClimate(CLIMATE_FIXTURE)!;

describe('typicalForMonths', () => {
  it('lists months across a year end', () => {
    expect(monthsBetween('2026-12-28', '2027-01-03')).toEqual([12, 1]);
    expect(monthsBetween('2026-10-08', '2026-10-15')).toEqual([10]);
  });

  it('adds a rain layer at 10+ wet days', () => {
    const t = typicalForMonths(idx, 'OPO', [1])!;
    expect(t.text).toBe('Typical 14° / 6°, 10 wet days');
    expect(t.advice).toEqual(['a rain layer']);
  });

  it('adds heat advice from 30° and nothing in between', () => {
    expect(typicalForMonths(idx, 'LIS', [10])!.advice).toEqual(['for the heat']);
    expect(typicalForMonths(idx, 'LIS', [4])!.advice).toEqual([]);
  });

  it('is null without normals', () => {
    expect(typicalForMonths(idx, 'XXX', [1])).toBeNull();
    expect(typicalForMonths(null, 'LIS', [1])).toBeNull();
  });
});

describe('prep weather item', () => {
  it('is a non-critical item only when the goal has normals', () => {
    const trip = sevilleTrip();
    expect(buildPrepChecklist(trip, idx).some(i => i.id === 'weather:typical')).toBe(false);
    const w = buildPrepChecklist({ ...trip, goal: { ...trip.goal, acCode: 'LIS' } }, idx).find(i => i.id === 'weather:typical')!;
    expect(w.critical).toBe(false);
    expect(w.title).toMatch(/^Typical \d+° \/ \d+°, \d+ wet days/);
  });
});

describe('destination climate', () => {
  it('marks the warmest and driest months', () => {
    const months = Array.from({ length: 12 }, (_, i) => climateFor(idx, 'LIS', i + 1)!);
    const h = climateHighlights(months);
    expect([...h.warmest]).toEqual([10]);
    expect(h.driest.size).toBe(12); // fixture wet days are all 8
  });

  it('renders the line and strip, and nothing for an unknown code', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE }] });
    const f = TestBed.createComponent(DestClimateComponent);
    f.componentRef.setInput('code', 'LIS');
    f.componentRef.setInput('dateKey', '2026-10-08');
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-climate]')?.textContent).toContain('Typical in Oct');
    expect(el.querySelector('.cl__t')?.textContent).toContain('30° / 23° · 8 wet days');
    expect(el.querySelectorAll('.m')).toHaveLength(12);
    f.componentRef.setInput('code', 'XXX');
    f.detectChanges();
    expect(el.querySelector('[data-climate]')).toBeNull();
  });
});
