import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoverage, resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import {
  MAX_MONTHS, barWidth, chooserMeta, chooserRows, clampKey, dayAria, monthDays, monthLead, monthRange, monthTitle,
  monthWeeks, moveKey, nextSelection, nightsLabel, pickable, rangeLabel, selectLabel,
} from './cal-model';
import { findDestination } from '../../utils/airports';

const TODAY = '2026-10-07';

describe('cal-model', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  it('computes availability per day: past, unpublished, nonstops and connection-only', () => {
    const cov = getCoverage('YUL');
    const oct = monthDays('YUL', 'ATH', '2026-10', TODAY, cov, false);
    expect(oct).toHaveLength(31);
    expect(oct[4]).toMatchObject({ key: '2026-10-05', past: true, direct: 0 });
    expect(oct[6]).toMatchObject({ key: '2026-10-07', past: false, direct: 2, connect: false });
    expect(oct[7]).toMatchObject({ key: '2026-10-08', direct: 0, connect: false });
    const apr = monthDays('YUL', 'LHR', '2027-04', TODAY, cov, false);
    expect(apr.every(d => d.outside && d.direct === 0)).toBe(true);
    const viaYyz = monthDays('YHZ', 'LHR', '2026-10', TODAY, getCoverage('YHZ'), true);
    expect(viaYyz[6]).toMatchObject({ direct: 0, connect: true });
    expect(monthDays('YHZ', 'LHR', '2026-10', TODAY, getCoverage('YHZ'), false)[6].connect).toBe(false);
  });

  it('lays a month out Monday-first in rows of seven', () => {
    expect(monthLead('2026-10')).toBe(3);
    const rows = monthWeeks('2026-10', monthDays('YUL', 'LHR', '2026-10', TODAY, null, false));
    expect(rows).toHaveLength(5);
    expect(rows[0].slice(0, 3)).toEqual([null, null, null]);
    expect(rows[0][3]?.key).toBe('2026-10-01');
    expect(rows[4].filter(Boolean)).toHaveLength(6);
    expect(monthTitle('2026-10')).toBe('October 2026');
  });

  it('spans today to the end of the window', () => {
    expect(monthRange(TODAY, getCoverage('YUL'))).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    expect(monthRange(TODAY, null)).toEqual(['2026-10']);
    expect(monthRange(TODAY, { from: null, to: '2026-01-01', generatedAt: null, hub: null })).toEqual(['2026-10']);
    expect(monthRange(TODAY, { from: null, to: '2030-01-01', generatedAt: null, hub: null })).toHaveLength(MAX_MONTHS);
  });

  it('fills the bar at three departures', () => {
    expect(barWidth(1)).toBeCloseTo(33.33, 1);
    expect(barWidth(3)).toBe(100);
    expect(barWidth(5)).toBe(100);
  });

  it('only lets future, published days be picked', () => {
    const cov = getCoverage('YUL');
    expect(pickable('2026-10-08', TODAY, cov)).toBe(true);
    expect(pickable(TODAY, TODAY, cov)).toBe(true);
    expect(pickable('2026-10-06', TODAY, cov)).toBe(false);
    expect(pickable('2027-05-01', TODAY, cov)).toBe(false);
    expect(pickable('nope', TODAY, cov)).toBe(false);
    expect(pickable(undefined, TODAY, cov)).toBe(false);
  });

  it('selects depart then return; a tap on or before the departure restarts', () => {
    let s = nextSelection({ dep: null, ret: null, active: 'dep' }, '2026-10-08');
    expect(s).toEqual({ dep: '2026-10-08', ret: null, active: 'ret' });
    s = nextSelection(s, '2026-10-15');
    expect(s).toEqual({ dep: '2026-10-08', ret: '2026-10-15', active: 'ret' });
    expect(nextSelection(s, '2026-10-20')).toEqual({ dep: '2026-10-08', ret: '2026-10-20', active: 'ret' });
    expect(nextSelection(s, '2026-10-08')).toEqual({ dep: '2026-10-08', ret: null, active: 'ret' });
    expect(nextSelection(s, '2026-10-02')).toEqual({ dep: '2026-10-02', ret: null, active: 'ret' });
    // Editing the departure keeps a later return, drops an earlier one.
    expect(nextSelection({ ...s, active: 'dep' }, '2026-10-10')).toEqual({ dep: '2026-10-10', ret: '2026-10-15', active: 'ret' });
    expect(nextSelection({ ...s, active: 'dep' }, '2026-10-16')).toEqual({ dep: '2026-10-16', ret: null, active: 'ret' });
  });

  it('labels the selection', () => {
    expect(rangeLabel('2026-10-08', '2026-10-15')).toBe('Oct 8 – 15');
    expect(rangeLabel('2026-10-28', '2026-11-04')).toBe('Oct 28 – Nov 4');
    expect(nightsLabel('2026-10-08', '2026-10-09')).toBe('1 night');
    expect(selectLabel(null, null)).toBe('Select a departure date');
    expect(selectLabel('2026-10-08', null)).toBe('Select Thu, Oct 8 · one way');
    expect(selectLabel('2026-10-08', '2026-10-15')).toBe('Select Oct 8 – 15 · 7 nights');
  });

  it('describes a day for screen readers', () => {
    const base = { key: '2026-10-08', day: 8, direct: 0, connect: false, past: false, outside: false };
    expect(dayAria({ ...base, direct: 2 }, 'dep')).toBe('Thursday, October 8, 2 departures');
    expect(dayAria({ ...base, direct: 1 }, 'ret')).toBe('Thursday, October 8, 1 return departure');
    expect(dayAria({ ...base, connect: true }, 'dep')).toBe('Thursday, October 8, connection only');
    expect(dayAria(base, 'dep')).toBe('Thursday, October 8, no nonstop');
    expect(dayAria({ ...base, past: true }, 'dep')).toBe('Thursday, October 8, past');
    expect(dayAria({ ...base, outside: true }, 'dep')).toBe('Thursday, October 8, not yet published');
  });

  it('moves through the grid by day, week, month and week ends', () => {
    expect(moveKey('2026-10-08', 'ArrowLeft')).toBe('2026-10-07');
    expect(moveKey('2026-10-08', 'ArrowRight')).toBe('2026-10-09');
    expect(moveKey('2026-10-08', 'ArrowUp')).toBe('2026-10-01');
    expect(moveKey('2026-10-08', 'ArrowDown')).toBe('2026-10-15');
    expect(moveKey('2026-10-08', 'Home')).toBe('2026-10-05');
    expect(moveKey('2026-10-08', 'End')).toBe('2026-10-11');
    expect(moveKey('2026-10-31', 'PageDown')).toBe('2026-11-30');
    expect(moveKey('2026-10-08', 'PageUp')).toBe('2026-09-08');
    expect(moveKey('2026-10-08', 'Enter')).toBeNull();
    expect(clampKey('2026-09-01', '2026-10-01', '2027-03-31')).toBe('2026-10-01');
    expect(clampKey('2027-09-01', '2026-10-01', '2027-03-31')).toBe('2027-03-31');
    expect(clampKey('2026-12-01', '2026-10-01', '2027-03-31')).toBe('2026-12-01');
  });

  it('lists favourites first, then nonstop destinations, filtered by the search', () => {
    const { saved, all } = chooserRows('YUL', ['LHR', 'NRT'], TODAY, '');
    expect(saved.map(r => r.code)).toEqual(['LHR', 'NRT']);
    expect(all.map(r => r.code)).toEqual(['ATH']);
    expect(saved[0].meta).toBe('United Kingdom · next Wed, Oct 7');
    expect(saved[1].meta).toBe('Japan · no nonstop published');
    expect(chooserRows('YUL', ['LHR'], TODAY, 'athens').all.map(r => r.code)).toEqual(['ATH']);
    expect(chooserRows('YUL', ['LHR'], TODAY, 'athens').saved).toEqual([]);
    expect(chooserMeta('YUL', findDestination('ATH')!, '2026-10-08')).toBe('Greece · next Fri, Oct 9');
  });

  it('says a route-only favourite is flown with times not in our data', () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    try {
      expect(chooserMeta('YHZ', findDestination('BOS')!, TODAY)).toBe('USA · flies this route · times not in our data');
      expect(chooserMeta('YUL', findDestination('NRT')!, TODAY)).toBe('Japan · no nonstop published');
    } finally {
      resetRouteNetworkSource();
    }
  });
});
