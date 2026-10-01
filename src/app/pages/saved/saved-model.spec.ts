import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoverage, resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import {
  cardMeta, directDots, footerDays, heroMeta, nextDeparture, routeEndsOn, rowMeta, starredDots, upcoming, viaHub,
  watchingMeta,
} from './saved-model';

/** Wed Oct 7 2026, 08:00 in Montréal. */
const NOW = Date.parse('2026-10-07T12:00:00Z');
const TODAY = '2026-10-07';

describe('saved-model', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  it('finds the next nonstop after now, skipping flights that already left', () => {
    expect(nextDeparture('YUL', 'LHR', TODAY, NOW)?.dateKey).toBe(TODAY);
    // 23:00 Montréal: AC864 (22:10) has gone, so tomorrow's.
    const late = Date.parse('2026-10-08T03:00:00Z');
    expect(nextDeparture('YUL', 'LHR', TODAY, late)?.dateKey).toBe('2026-10-08');
    // ATH flies Mon/Wed/Fri in October.
    expect(nextDeparture('YUL', 'ATH', '2026-10-08', NOW)?.dateKey).toBe('2026-10-09');
    expect(nextDeparture('YUL', 'DEL', TODAY, NOW)).toBeNull();
  });

  it('reports when a route ends before the window does', () => {
    const cov = getCoverage('YUL');
    expect(routeEndsOn('YUL', 'ATH', TODAY, cov.to)).toBe('Oct 31');
    expect(routeEndsOn('YUL', 'LHR', TODAY, cov.to)).toBeNull();
    expect(routeEndsOn('YUL', 'NRT', TODAY, cov.to)).toBeNull();
  });

  it('sorts upcoming departures and lists favourites without a nonstop', () => {
    const { items, rest } = upcoming('YUL', ['ATH', 'LHR', 'DEL', 'NRT', 'ZZZ'], TODAY, NOW, getCoverage('YUL'));
    expect(items.map(i => i.code)).toEqual(['ATH', 'LHR']);
    expect(items[0].badge).toBe('Today · 17:25');
    expect(items[0].weekDays).toBe(3);
    expect(items[0].thisWeek).toBe(true);
    expect(items[0].endsOn).toBe('Oct 31');
    expect(items[1].season).toBe('Year-round');
    expect(rest.map(r => r.code)).toEqual(['DEL', 'NRT']);
    expect(rest[1].via).toBeNull();
    const yhz = upcoming('YHZ', ['LHR'], TODAY, NOW, getCoverage('YHZ'));
    expect(yhz.items).toEqual([]);
    expect(yhz.rest).toEqual([{ code: 'LHR', city: 'London', country: 'United Kingdom', via: 'YYZ' }]);
  });

  it('formats the card, footer and row lines', () => {
    const { items } = upcoming('YUL', ['ATH', 'LHR'], TODAY, NOW, getCoverage('YUL'), '24h');
    const [ath, lhr] = items;
    expect(heroMeta(ath)).toBe('Greece · AC898 · 10h10');
    expect(cardMeta(ath)).toBe('AC898 · 3× this week · ends Oct 31');
    expect(cardMeta(lhr)).toBe('AC864 · Daily');
    expect(cardMeta({ ...ath, thisWeek: false })).toBe('AC898 · 3× that week · ends Oct 31');
    expect(footerDays(lhr)).toBe('Daily');
    expect(footerDays(ath)).toBe('3× wk');
    expect(rowMeta(lhr, TODAY)).toBe('22:10 → 10:00⁺¹ · 6h50');
    expect(rowMeta(lhr, '2026-10-06')).toBe('Tomorrow · 22:10 · 6h50');
  });

  it('finds a connecting hub when there is no nonstop', () => {
    expect(viaHub('YHZ', 'LHR', TODAY)).toBe('YYZ');
    expect(viaHub('YUL', 'NRT', TODAY)).toBeNull();
  });

  it('builds dots and the watching meta line', () => {
    const cov = getCoverage('YUL');
    const week = '2026-10-05';
    expect(starredDots({ dayKeys: ['2026-10-05', '2026-10-07'], direct: true }, week, cov))
      .toEqual(['on', 'off', 'on', 'off', 'off', 'off', 'off']);
    expect(starredDots({ dayKeys: ['2026-10-06'], direct: false }, week, cov)[1]).toBe('connect');
    expect(starredDots({ dayKeys: [], direct: false }, '2027-03-29', cov).slice(3)).toEqual(['outside', 'outside', 'outside', 'outside']);
    expect(directDots('YUL', 'ATH', week, cov)).toEqual(['on', 'off', 'on', 'off', 'on', 'off', 'off']);
    expect(watchingMeta({ dayKeys: [], days: '', direct: false })).toBe('No flights this week');
    expect(watchingMeta({ dayKeys: ['a', 'b'], days: 'Mon Wed', direct: true })).toBe('Mon Wed');
    expect(watchingMeta({ dayKeys: ['1', '2', '3', '4', '5', '6', '7'], days: 'x', direct: true })).toBe('Daily');
    expect(watchingMeta({ dayKeys: ['a'], days: 'Tue', direct: false })).toBe('Connections only');
  });
});
