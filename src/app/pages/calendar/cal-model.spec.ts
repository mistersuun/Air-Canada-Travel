import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoverage, resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import { NO_OPTS } from '../../utils/connections';
import {
  homeAfterUtc, minuteOf, outboundsOn, resetItinerariesMemo, waysHome, type CountCtx, type DayCount,
} from '../../planner/round-trip';
import {
  MAX_MONTHS, blockedPeek, cellCount, chooserMeta, chooserRows, clampKey, dayAria, dayMarker, firstFlightDay, listRowText,
  monthDays, monthLead, monthRange, monthTitle, monthWeeks, moveKey, nextDayWith, nextSelection, nightsLabel, nonstopWeekdays,
  nonstopsLine, peekDep, peekRet, pickable, rangeLabel, seeLabel, timesText, windowEnd,
} from './cal-model';
import { findDestination } from '../../utils/airports';

const TODAY = '2026-10-07';

const NOW = Date.parse('2026-10-07T12:00:00Z');

function ctx(over: Partial<CountCtx> = {}): CountCtx {
  return {
    today: TODAY, nowMinute: minuteOf(NOW), coverage: getCoverage('YUL'), showConnections: false, connect: NO_OPTS, ...over,
  };
}

describe('cal-model', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    resetItinerariesMemo();
  });
  afterEach(() => resetScheduleSource());

  it('counts flights out per day: past, unpublished, nonstops and connections only', () => {
    const oct = monthDays('YUL', 'ATH', '2026-10', ctx(), '24h');
    expect(oct).toHaveLength(31);
    expect(oct[4]).toMatchObject({ key: '2026-10-05', past: true, count: { state: 'past', total: 0 } });
    // Wed: AC898 and AC922 (the duplicate AC898 row is counted once).
    expect(oct[6]).toMatchObject({ key: '2026-10-07', past: false, count: { state: 'ok', total: 2, direct: 2, first: '17:25', last: '21:30' } });
    expect(oct[7].count).toMatchObject({ key: '2026-10-08', state: 'none', total: 0 });
    const apr = monthDays('YUL', 'LHR', '2027-04', ctx(), '24h');
    expect(apr.every(d => d.outside && d.count.state === 'unpublished')).toBe(true);
    const yhz = ctx({ coverage: getCoverage('YHZ') });
    const viaYyz = monthDays('YHZ', 'LHR', '2026-10', { ...yhz, showConnections: true }, '24h');
    expect(viaYyz[7].count).toMatchObject({ state: 'ok', direct: 0 });
    expect(viaYyz[7].count.connecting).toBeGreaterThan(0);
    const off = monthDays('YHZ', 'LHR', '2026-10', yhz, '24h')[7].count;
    expect(off).toMatchObject({ state: 'none', total: 0 });
    expect(off.hidden).toBeGreaterThan(0);
    // Loading wins over every other state.
    expect(monthDays('YUL', 'ATH', '2026-10', ctx({ loading: true }), '24h')[6].count.state).toBe('loading');
  });

  it('counts ways home after the departure lands, with nights, and before-dep days', () => {
    const dep = '2026-10-08';
    // AC864 lands LHR Fri 10:00; AC865 leaves 12:10, so the arrival day has a way home.
    const after = homeAfterUtc(null, outboundsOn('YUL', 'LHR', dep, ctx()), NO_OPTS);
    const days = monthDays('YUL', 'LHR', '2026-10', ctx(), '24h', { dep, afterUtc: after });
    const at = (k: string) => days.find(d => d.key === k)!.count;
    expect(at('2026-10-07')).toMatchObject({ state: 'before-dep', total: 0 });
    expect(at(dep)).toMatchObject({ state: 'none', nights: 0 });
    expect(at('2026-10-09')).toMatchObject({ state: 'ok', total: 1, nights: 1, first: '12:10' });
    expect(at('2026-10-15')).toMatchObject({ state: 'ok', total: 1, nights: 7 });
    // The counts are the rows: the same function lists them.
    expect(at('2026-10-15').total).toBe(waysHome('LHR', 'YUL', '2026-10-15', ctx(), after).length);
  });

  it('draws a marker per state and a count line', () => {
    const c = (o: Partial<DayCount>): DayCount => ({
      key: '2026-10-08', state: 'ok', total: 1, direct: 1, connecting: 0, hidden: 0, first: '22:10', last: '22:10', ...o,
    });
    expect([dayMarker(c({})), cellCount(c({}))]).toEqual(['solid', '1']);
    expect([dayMarker(c({ direct: 0, connecting: 1 })), cellCount(c({ direct: 0, connecting: 1 }))]).toEqual(['dotted', '1']);
    expect([dayMarker(c({ state: 'none', total: 0 })), cellCount(c({ state: 'none', total: 0 }))]).toEqual(['none', '–']);
    expect([dayMarker(c({ state: 'unpublished' })), cellCount(c({ state: 'unpublished' }))]).toEqual(['hatch', '–']);
    expect([dayMarker(c({ state: 'past' })), cellCount(c({ state: 'past' }))]).toEqual([null, '']);
    expect([dayMarker(c({ state: 'before-dep' })), cellCount(c({ state: 'before-dep' }))]).toEqual([null, '']);
    expect(cellCount(c({ state: 'loading' }))).toBe('·');
  });

  it('words List rows, the footer peek and times', () => {
    const c = (o: Partial<DayCount>): DayCount => ({
      key: '2026-11-20', state: 'ok', total: 2, direct: 2, connecting: 0, hidden: 0, first: '18:05', last: '22:10', ...o,
    });
    expect(timesText(c({}))).toBe('18:05, 22:10');
    expect(timesText(c({ total: 1, direct: 1, last: '18:05' }))).toBe('18:05');
    expect(timesText(c({ total: 3, first: '11:20', last: '11:20' }))).toBe('11:20');
    expect(listRowText(c({}), 'out', TODAY)).toBe('Fri, Nov 20 · 2 nonstop · 18:05, 22:10');
    expect(listRowText(c({ total: 4, direct: 4, first: '06:10', last: '22:40' }), 'out', TODAY)).toBe('Fri, Nov 20 · 4 flights · 06:10–22:40');
    expect(listRowText(c({ key: '2026-11-23', total: 1, direct: 0, connecting: 1, first: '09:40', last: '09:40' }), 'out', TODAY))
      .toBe('Mon, Nov 23 · connections only · 09:40');
    const home = c({ key: '2026-11-28', total: 3, direct: 3, first: '07:10', last: '13:00', nights: 8 });
    expect(listRowText(home, 'home', TODAY)).toBe('8 nights · Sat, Nov 28 · 3 home · 07:10–13:00');
    expect(peekDep(c({}), TODAY)).toBe('Leave Fri, Nov 20 · 2 flights · 18:05, 22:10');
    expect(peekRet(home, '2026-11-20', TODAY)).toBe('Home Sat, Nov 28 · 8 nights · 3 ways home · 07:10–13:00');
    expect(peekRet({ ...home, key: '2026-11-20', nights: 0 }, '2026-11-20', TODAY)).toContain('Day trip');
  });

  it('explains a day that cannot be picked, with the next one', () => {
    const cov = getCoverage('YUL');
    expect(blockedPeek('2026-11-23', 'home', '2026-11-24', TODAY, cov))
      .toEqual({ text: 'No flights home on Mon, Nov 23 · next: Tue, Nov 24', go: '2026-11-24' });
    expect(blockedPeek('2026-11-19', 'out', null, TODAY, cov)).toEqual({ text: 'No flights out on Thu, Nov 19' });
    expect(blockedPeek('2027-05-01', 'out', null, TODAY, cov)).toEqual({ text: 'Not yet published · schedules end Mar 31, 2027' });
    expect(windowEnd(null)).toBe('');
    expect(nextDayWith('2026-10-07', k => (k === '2026-10-09' ? 1 : 0), null)).toBe('2026-10-09');
    expect(nextDayWith('2026-10-07', () => 0, '2026-10-20')).toBeNull();
  });

  it('finds the first flying day, with connections when they are shown', () => {
    expect(firstFlightDay('YUL', 'LHR', ctx())).toBe(TODAY);
    expect(firstFlightDay('YUL', 'ATH', ctx({ today: '2026-10-08' }))).toBe('2026-10-09');
    expect(firstFlightDay('YHZ', 'LHR', ctx({ coverage: getCoverage('YHZ') }))).toBeNull();
    expect(firstFlightDay('YHZ', 'LHR', ctx({ coverage: getCoverage('YHZ'), showConnections: true }))).toBe(TODAY);
  });

  it('lists the weekdays with a nonstop in a month', () => {
    const cov = getCoverage('YUL');
    expect(nonstopWeekdays('YUL', 'ATH', '2026-10', TODAY, cov)).toEqual([0, 2, 4]);
    expect(nonstopsLine([0, 2, 4])).toBe('Nonstops: Mon, Wed, Fri');
    expect(nonstopsLine([])).toBeNull();
    expect(nonstopWeekdays('YUL', 'ATH', '2026-11', TODAY, cov)).toEqual([]);
  });

  it('lays a month out Monday-first in rows of seven', () => {
    expect(monthLead('2026-10')).toBe(3);
    const rows = monthWeeks('2026-10', monthDays('YUL', 'LHR', '2026-10', ctx(), '24h'));
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

  it('only lets future, published days be picked', () => {
    const cov = getCoverage('YUL');
    expect(pickable('2026-10-08', TODAY, cov)).toBe(true);
    expect(pickable(TODAY, TODAY, cov)).toBe(true);
    expect(pickable('2026-10-06', TODAY, cov)).toBe(false);
    expect(pickable('2027-05-01', TODAY, cov)).toBe(false);
    expect(pickable('nope', TODAY, cov)).toBe(false);
    expect(pickable(undefined, TODAY, cov)).toBe(false);
  });

  it('selects depart then return; a tap before the departure restarts; a tap on it can make a day trip', () => {
    let s = nextSelection({ dep: null, ret: null, active: 'dep' }, '2026-10-08');
    expect(s).toEqual({ dep: '2026-10-08', ret: null, active: 'ret' });
    s = nextSelection(s, '2026-10-15');
    expect(s).toEqual({ dep: '2026-10-08', ret: '2026-10-15', active: 'ret' });
    expect(nextSelection(s, '2026-10-20')).toEqual({ dep: '2026-10-08', ret: '2026-10-20', active: 'ret' });
    expect(nextSelection(s, '2026-10-08')).toEqual({ dep: '2026-10-08', ret: null, active: 'ret' });
    expect(nextSelection(s, '2026-10-08', true)).toEqual({ dep: '2026-10-08', ret: '2026-10-08', active: 'ret' });
    expect(nextSelection(s, '2026-10-02')).toEqual({ dep: '2026-10-02', ret: null, active: 'ret' });
    expect(nextSelection(s, '2026-10-02', true)).toEqual({ dep: '2026-10-02', ret: null, active: 'ret' });
    // Editing the departure keeps a later return, drops an earlier one.
    expect(nextSelection({ ...s, active: 'dep' }, '2026-10-10')).toEqual({ dep: '2026-10-10', ret: '2026-10-15', active: 'ret' });
    expect(nextSelection({ ...s, active: 'dep' }, '2026-10-16')).toEqual({ dep: '2026-10-16', ret: null, active: 'ret' });
  });

  it('labels the selection and the See flights button', () => {
    expect(rangeLabel('2026-10-08', '2026-10-15')).toBe('Oct 8 – 15');
    expect(rangeLabel('2026-10-28', '2026-11-04')).toBe('Oct 28 – Nov 4');
    expect(nightsLabel('2026-10-08', '2026-10-09')).toBe('1 night');
    expect(nightsLabel('2026-10-08', '2026-10-08')).toBe('Day trip');
    expect(seeLabel(null, null, TODAY)).toBe('Tap the day you leave');
    expect(seeLabel('2026-11-20', null, TODAY)).toBe('See flights · one way · Fri, Nov 20');
    expect(seeLabel('2026-11-20', '2026-11-28', TODAY)).toBe('See flights · Nov 20 – 28 · 8 nights');
    expect(seeLabel('2026-11-20', '2026-11-20', TODAY)).toBe('See flights · Fri, Nov 20 · Day trip');
    // Another year carries the year.
    expect(seeLabel('2027-06-02', null, TODAY)).toBe('See flights · one way · Wed, Jun 2, 2027');
  });

  it('describes a day for screen readers from its count', () => {
    const d = monthDays('YUL', 'ATH', '2026-10', ctx(), '24h');
    expect(dayAria(d[6], 'out')).toBe('Wednesday, October 7, 2026, 2 flights out');
    expect(dayAria(d[7], 'out')).toBe('Thursday, October 8, 2026, no flights');
    expect(dayAria(d[4], 'out')).toBe('Monday, October 5, 2026, past');
    const apr = monthDays('YUL', 'LHR', '2027-04', ctx(), '24h');
    expect(dayAria(apr[0], 'out')).toBe('Thursday, April 1, 2027, not yet published');
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
