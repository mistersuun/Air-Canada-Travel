import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { buildPrepChecklist } from '../places/prep';
import type { FlightLeg } from '../trips/model';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { climateHighlights, DestClimateComponent } from '../pages/destination/dest-climate.component';
import { decodeClimate, climateFor, monthsBetween, packingFacts, typicalForMonths, wetDaysText } from './climate';
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

  it('shows a range and bases advice on the extremes when months differ', () => {
    const t = typicalForMonths(idx, 'OPO', [1, 2, 3])!; // highs 14-16, lows 6-8, wet 10
    expect(t.text).toBe('Typical 14\u201316\u00b0 / 6\u20138\u00b0, 10 wet days');
    const lis = typicalForMonths(idx, 'LIS', [9, 10])!; // highs 27, 30
    expect(lis.text).toContain('27\u201330\u00b0');
    expect(lis.advice).toEqual(['for the heat']);
  });

  it('pluralises wet days', () => {
    expect(wetDaysText(0)).toBe('no wet days');
    expect(wetDaysText(1)).toBe('1 wet day');
    expect(wetDaysText(9)).toBe('9 wet days');
    expect(wetDaysText(2, 5)).toBe('2\u20135 wet days');
  });

  it('is null without normals', () => {
    expect(typicalForMonths(idx, 'XXX', [1])).toBeNull();
    expect(typicalForMonths(null, 'LIS', [1])).toBeNull();
  });
});

describe('packingFacts', () => {
  const mk = (tmax: number, tmin: number, wet: number) => decodeClimate({
    v: 1, attribution: '', period: '',
    codes: { AAA: { tmax: Array(12).fill(tmax), tmin: Array(12).fill(tmin), precip: Array(12).fill(50), wet: Array(12).fill(wet) } },
  })!;

  it('phrases rain, warm layer and heat from the typical numbers, naming the month', () => {
    expect(packingFacts(mk(12, 4, 12), 'AAA', [10]).map(p => p.title)).toEqual([
      'Rain jacket — wet on about 12 of 31 days in Oct',
      'Warm layer — lows around 4° in Oct',
    ]);
    expect(packingFacts(mk(33, 24, 3), 'AAA', [7])).toEqual([{ id: 'pack:sun', title: 'Sun protection — highs around 33° in Jul' }]);
    expect(packingFacts(mk(2, -5, 3), 'AAA', [1]).map(p => p.id)).toEqual(['pack:coat', 'pack:warm']);
    expect(packingFacts(mk(-3, -10, 12), 'AAA', [1])[0].title).toBe('Waterproof layer \u2014 rain or snow on about 12 of 31 days in Jan');
  });

  it('says nothing for mild weather or an unknown code', () => {
    expect(packingFacts(mk(22, 14, 4), 'AAA', [5])).toEqual([]);
    expect(packingFacts(mk(12, 4, 12), 'ZZZ', [10])).toEqual([]);
    expect(packingFacts(null, 'AAA', [10])).toEqual([]);
  });

  it('become non-critical prep items after the typical-weather line', () => {
    const trip = { ...sevilleTrip(), goal: { ...sevilleTrip().goal, acCode: 'AAA' } };
    const items = buildPrepChecklist(trip, mk(12, 4, 12));
    const ids = items.map(i => i.id).filter(id => /^(weather|pack):/.test(id));
    expect(ids).toEqual(['weather:typical', 'pack:rain', 'pack:warm']);
    expect(items.find(i => i.id === 'pack:warm')).toMatchObject({ critical: false, detail: 'Typical for these months, not a forecast' });
  });
});

describe('prep weather item', () => {
  it('is a non-critical item only when the goal has normals', () => {
    const trip = sevilleTrip();
    expect(buildPrepChecklist(trip, idx).some(i => i.id === 'weather:typical')).toBe(false);
    const w = buildPrepChecklist({ ...trip, goal: { ...trip.goal, acCode: 'LIS' } }, idx).find(i => i.id === 'weather:typical')!;
    expect(w.critical).toBe(false);
    expect(w.title).toMatch(/^Typical [\d\u2013]+° \/ [\d\u2013]+°, [\d\u2013]+ wet days/);
    // No goal code: falls back to where the last flight leg lands.
    const noCode = { ...trip, goal: { ...trip.goal, acCode: undefined } } as typeof trip;
    const last = [...noCode.legs].reverse().find(l => l.kind === 'flight' && l.refs.length) as FlightLeg;
    const dest = last.refs[last.refs.length - 1].dest;
    const has = !!idx.byCode.get(dest);
    expect(buildPrepChecklist(noCode, idx).some(i => i.id === 'weather:typical')).toBe(has);
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
