import { afterEach, describe, expect, it } from 'vitest';
import { DESTINATIONS, HUBS } from '../data/destinations';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { ALL_DAYS, rec, route } from '../data/testing/schedule-fixtures';
import type { BoardedFlight } from './logbook';
import {
  stampAngle, ARCTIC_CIRCLE_LAT, achievements, crossesEquator, entersArctic, inspirationStamps, isRedEye, pathLatitudes, placeStamps,
} from './stamps';

afterEach(() => resetScheduleSource());

let n = 0;
function fl(origin: string, dest: string, dateKey = '2026-10-08', over: Partial<BoardedFlight> = {}): BoardedFlight {
  n++;
  return {
    key: `AC${n}|${origin}|${dateKey}`, flightNumber: `AC${n}`, origin, dest, dateKey,
    depLocal: '10:00', arrLocal: '14:00', arrDateKey: dateKey, aircraft: '333', km: 1000, ...over,
  };
}
const ids = (f: BoardedFlight[]) => achievements(f).map(a => a.id);

describe('geometry', () => {
  it('samples 65 latitudes along the path, ends included', () => {
    const lats = pathLatitudes('YUL', 'LIS');
    expect(lats).toHaveLength(65);
    expect(lats[0]).toBeCloseTo(45.47, 1);
    expect(lats[64]).toBeCloseTo(38.77, 1);
  });
  it('is empty for an unknown airport', () => {
    expect(pathLatitudes('YUL', 'ZZZ')).toEqual([]);
    expect(crossesEquator('YUL', 'ZZZ')).toBe(false);
    expect(entersArctic('ZZZ', 'YUL')).toBe(false);
  });
  it('crosses the equator going south to Brazil and Australia, not to Portugal or Mexico', () => {
    expect(crossesEquator('YYZ', 'GRU')).toBe(true);
    expect(crossesEquator('YVR', 'SYD')).toBe(true);
    expect(crossesEquator('YUL', 'LIS')).toBe(false);
    expect(crossesEquator('YYZ', 'MEX')).toBe(false);
  });
  it('goes over the Arctic Circle on polar routes, not on the Atlantic', () => {
    expect(entersArctic('YVR', 'LHR')).toBe(true);
    expect(entersArctic('YYZ', 'HND')).toBe(true);
    expect(entersArctic('YUL', 'LIS')).toBe(false);
    expect(entersArctic('YUL', 'CDG')).toBe(false);
    expect(ARCTIC_CIRCLE_LAT).toBeCloseTo(66.56, 1);
  });
});

describe('placeStamps', () => {
  it('is empty for no flights', () => {
    expect(placeStamps([])).toEqual([]);
  });
  it('stamps arrivals once with a count and the first date', () => {
    const s = placeStamps([
      fl('YUL', 'LIS', '2026-10-08'), fl('YUL', 'LIS', '2026-09-01'), fl('YUL', 'CUN', '2026-12-01'),
    ]);
    expect(s).toEqual([
      { code: 'LIS', city: 'Lisbon', region: 'Europe', count: 2, firstDateKey: '2026-09-01' },
      { code: 'CUN', city: s0('CUN'), region: 'Mexico', count: 1, firstDateKey: '2026-12-01' },
    ]);
  });
  it('does not stamp coming home to a hub, but does for hub to hub', () => {
    const s = placeStamps([fl('LIS', 'YUL'), fl('YUL', 'YVR')]);
    expect(s.map(x => x.code)).toEqual(['YVR']);
    expect(s[0].region).toBe('Canada');
  });
  it('skips airports it cannot place', () => {
    expect(placeStamps([fl('YUL', 'ZZZ')])).toEqual([]);
  });
});

function s0(code: string): string {
  return DESTINATIONS.find(d => d.code === code)!.city;
}

describe('inspirationStamps', () => {
  const fixture = () => setScheduleSource([
    route('YUL', 'LIS', rec('AC1', '21:45', '09:20', '2026-01-01', '2026-12-31', ALL_DAYS, '333')),
    route('YUL', 'CDG', rec('AC2', '21:45', '09:20', '2026-01-01', '2026-12-31', ALL_DAYS, '333')),
    route('YUL', 'CUN', rec('AC3', '08:00', '12:00', '2026-01-01', '2026-12-31', ALL_DAYS, '7M8')),
    route('YUL', 'MBJ', rec('AC4', '08:00', '12:00', '2026-01-01', '2026-12-31', ALL_DAYS, '7M8')),
    route('YUL', 'ZZZ', rec('AC5', '08:00', '12:00', '2026-01-01', '2026-12-31', ALL_DAYS, '7M8')),
    route('YYZ', 'NRT', rec('AC6', '08:00', '12:00', '2026-01-01', '2026-12-31', ALL_DAYS, '789')),
  ], null);

  it('lists the hub nonstop destinations only, spread across regions', () => {
    fixture();
    const s = inspirationStamps('YUL', 8);
    expect(s.map(x => x.code).sort()).toEqual(['CDG', 'CUN', 'LIS', 'MBJ']);
    // One per region first: Caribbean, Mexico, Europe come before the second European one.
    expect(s.slice(0, 3).map(x => x.region)).toEqual(['Caribbean', 'Mexico', 'Europe']);
  });
  it('respects the limit and is deterministic', () => {
    fixture();
    expect(inspirationStamps('YUL', 2)).toHaveLength(2);
    expect(inspirationStamps('YUL', 2)).toEqual(inspirationStamps('YUL', 2));
  });
  it('is empty for a hub with no flights', () => {
    fixture();
    expect(inspirationStamps('YHZ')).toEqual([]);
  });
});

describe('achievements', () => {
  it('has none for no flights and for an ordinary trip', () => {
    expect(achievements([])).toEqual([]);
    expect(achievements([fl('YUL', 'LIS'), fl('LIS', 'YUL', '2026-10-13')])).toEqual([]);
  });

  it('Crossed the equator', () => {
    const a = achievements([fl('YYZ', 'GRU')]);
    expect(a).toEqual([{ id: 'equator', label: 'Crossed the equator', detail: 'YYZ → GRU' }]);
  });

  it('Over the Arctic Circle', () => {
    expect(achievements([fl('YVR', 'LHR')])).toEqual([
      { id: 'arctic', label: 'Over the Arctic Circle', detail: 'YVR → LHR' },
    ]);
  });

  it('Red-eye needs a 22:00+ departure that lands the next day', () => {
    const red = fl('YUL', 'LIS', '2026-10-08', { depLocal: '22:10', arrDateKey: '2026-10-09' });
    expect(isRedEye(red)).toBe(true);
    expect(ids([red])).toEqual(['redEye']);
    expect(isRedEye(fl('YUL', 'LIS', '2026-10-08', { depLocal: '21:59', arrDateKey: '2026-10-09' }))).toBe(false);
    expect(isRedEye(fl('YUL', 'YYZ', '2026-10-08', { depLocal: '22:30', arrDateKey: '2026-10-08' }))).toBe(false);
    expect(isRedEye(fl('YUL', 'LIS', '2026-10-08', { depLocal: null, arrDateKey: null }))).toBe(false);
    expect(isRedEye(fl('YUL', 'LIS', '2026-10-08', { depLocal: '23:59', arrDateKey: '2026-10-09' }))).toBe(true);
  });

  it('Day tripper needs out and back on the same date', () => {
    const same = [fl('YUL', 'YYZ', '2026-10-08', { depLocal: '07:00' }), fl('YYZ', 'YUL', '2026-10-08', { depLocal: '20:00' })];
    expect(achievements(same)).toEqual([{ id: 'dayTripper', label: 'Day tripper', detail: 'YUL → YYZ and back' }]);
    // Reported with the earlier departure as the way out, whatever the list order.
    expect(achievements([...same].reverse())[0].detail).toBe('YUL → YYZ and back');
    expect(ids([fl('YUL', 'YYZ', '2026-10-08'), fl('YYZ', 'YUL', '2026-10-09')])).toEqual([]);
    expect(ids([fl('YUL', 'YYZ', '2026-10-08'), fl('YYZ', 'YVR', '2026-10-08')])).toEqual([]);
    expect(ids([fl('YUL', 'YYZ', '2026-10-08')])).toEqual([]);
  });

  it('Every hub needs each hub as an origin or destination', () => {
    const lap = HUBS.slice(1).map(h => fl(HUBS[0].code, h.code));
    expect(ids(lap)).toContain('everyHub');
    expect(ids(lap.slice(1))).not.toContain('everyHub');
  });

  it('All regions needs a stamp in every listed region', () => {
    const regions = [...new Set(DESTINATIONS.map(d => d.region))];
    const flights = regions.map(r => fl('YUL', DESTINATIONS.find(d => d.region === r)!.code));
    expect(ids(flights)).toContain('allRegions');
    expect(ids(flights.slice(1))).not.toContain('allRegions');
  });

  it('Antipodes for Sydney, Auckland, Melbourne or Brisbane', () => {
    for (const c of ['SYD', 'AKL', 'BNE']) expect(ids([fl('YVR', c)])).toContain('antipodes');
    expect(achievements([fl('YVR', 'AKL')]).find(a => a.id === 'antipodes')!.detail).toBe('Auckland');
    expect(ids([fl('YVR', 'HNL')])).not.toContain('antipodes');
  });

  it('is computed, not stored: the same flights always give the same list in a fixed order', () => {
    const flights = [fl('YVR', 'SYD', '2026-10-08', { depLocal: '23:00', arrDateKey: '2026-10-10' })];
    expect(ids(flights)).toEqual(['equator', 'redEye', 'antipodes']);
    expect(achievements(flights)).toEqual(achievements(flights));
  });
});

describe('stampAngle', () => {
  it('is a few degrees, the same every time, and varies by code', () => {
    const codes = DESTINATIONS.map(d => d.code);
    for (const c of codes) {
      const a = stampAngle(c);
      expect(a).toBeGreaterThanOrEqual(-5);
      expect(a).toBeLessThanOrEqual(5);
      expect(stampAngle(c)).toBe(a);
    }
    expect(new Set(codes.map(stampAngle)).size).toBeGreaterThan(5);
  });
});
