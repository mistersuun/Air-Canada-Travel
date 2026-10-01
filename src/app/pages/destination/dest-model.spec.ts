import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetScheduleSource, setScheduleSource, getCoverage } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { findItineraries } from '../../utils/connections';
import { toUtcMs } from '../../utils/time';
import { hm } from '../../ui/format';
import {
  availMonth, bestHub, destState, destSummary, itinFlights, monthRange, mostFrequent, nextConnectionDate,
  nextDeparture, placeLabel, shortAircraft, timelineDay, timelineItems, upcoming, zoneAbbr,
} from './dest-model';
import { currencyCode, currencyName } from './currency';

/** Noon in Montréal on Thu, Oct 1 2026. */
const NOON = toUtcMs('2026-10-01', '12:00', 'America/Toronto');

beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
afterEach(() => resetScheduleSource());

describe('small helpers', () => {
  it('shortens aircraft names and finds the most frequent value', () => {
    expect(shortAircraft('77W')).toBe('777-300ER');
    expect(shortAircraft('333')).toBe('A330-300');
    expect(shortAircraft(null)).toBe('');
    expect(mostFrequent(['a', 'b', 'b', 'a', 'b'])).toBe('b');
    expect(mostFrequent(['a', 'b', 'b', 'a'])).toBe('a'); // a tie goes to the first seen
    expect(mostFrequent([])).toBeNull();
  });

  it('labels the place without repeating the country', () => {
    expect(placeLabel('Japan', 'Asia & Pacific')).toBe('Japan · Asia & Pacific');
    expect(placeLabel('USA', 'USA')).toBe('USA');
    expect(placeLabel('Peru', '')).toBe('Peru');
  });

  it('formats the timeline date line', () => {
    expect(timelineDay('2026-10-01', '2026-10-01')).toBe('Today, Oct 1');
    expect(timelineDay('2026-10-02', '2026-10-01')).toBe('Fri, Oct 2');
  });

  it('names time zones, preferring a real abbreviation', () => {
    expect(zoneAbbr('Asia/Tokyo', 'JP', NOON)).toBe('JST');
    expect(zoneAbbr('Europe/London', 'GB', NOON)).toBe('BST');
    expect(zoneAbbr('Not/AZone', 'XX', NOON)).toBe('');
  });
});

describe('currency', () => {
  it('maps countries to currency names in the design’s case', () => {
    expect(currencyCode('jp')).toBe('JPY');
    expect(currencyName('JP')).toBe('Japanese yen');
    expect(currencyName('PT')).toBe('Euro');
    expect(currencyName('US')).toBe('US dollar');
    expect(currencyName('CW')).toBe('Caribbean guilder');
    expect(currencyName('XX')).toBe('');
    expect(currencyName(null)).toBe('');
  });
});

describe('upcoming and timelineItems', () => {
  it('lists nonstop departures from now on, day by day', () => {
    const its = upcoming('YUL', 'LHR', '2026-10-01', NOON, 'direct', undefined, 5);
    // Daily AC864, plus the one-day AC868 on Sat Oct 3 (12:00, before AC864).
    expect(its.map(i => `${i.dateKey} ${i.legs[0].flightNumber}`)).toEqual([
      '2026-10-01 AC864', '2026-10-02 AC864', '2026-10-03 AC868', '2026-10-03 AC864', '2026-10-04 AC864', '2026-10-05 AC864',
    ]);
    expect(upcoming('YUL', 'LHR', '2026-10-01', NOON, 'direct', undefined, 21, 3)).toHaveLength(3);
  });

  it('drops departures that have already left', () => {
    const late = toUtcMs('2026-10-01', '23:00', 'America/Toronto');
    expect(upcoming('YUL', 'LHR', '2026-10-01', late, 'direct', undefined, 2)[0].dateKey).toBe('2026-10-02');
  });

  it("lists one-stop connections in 'via' mode, and nothing outside the published window", () => {
    const via = upcoming('YHZ', 'LHR', '2026-10-01', NOON, 'via', undefined, 2);
    expect(via.length).toBeGreaterThan(0);
    expect(via.every(i => i.hubs.length === 1)).toBe(true);
    expect(via.map(i => i.departUtc)).toEqual(via.map(i => i.departUtc).sort((a, b) => a - b));
    const yyz = via.find(i => i.hubs[0] === 'YYZ')!;
    expect(itinFlights(yyz)).toBe('AC603 + AC848');
    expect(bestHub([yyz, yyz, via[0]])).toBe('YYZ');
    expect(bestHub([])).toBeNull();
    expect(upcoming('YHZ', 'LHR', '2027-04-01', NOON, 'via', undefined, 7)).toEqual([]);
  });

  it('builds timeline rows with a countdown on the first', () => {
    const its = upcoming('YUL', 'LHR', '2026-10-01', NOON, 'direct', undefined, 2);
    const [a, b] = timelineItems(its, '2026-10-01', NOON);
    expect(a.dateLabel).toBe('Today, Oct 1 · in 10h 10m');
    expect(a.time).toBe('22:10');
    expect(a.detail).toBe('AC864 · arrives 10:00 +1');
    expect(a.sub).toBe(`A330-300 · ${hm(its[0].totalMin)}`);
    expect(b.dateLabel).toBe('Fri, Oct 2');
    expect(timelineItems(its, '2026-10-01', NOON, '12h', false)[0]).toMatchObject({
      dateLabel: 'Today, Oct 1', time: '10:10 PM', detail: 'AC864 · arrives 10:00 AM +1',
    });
    const via = timelineItems(upcoming('YHZ', 'LHR', '2026-10-01', NOON, 'via', undefined, 2), '2026-10-01', NOON);
    expect(via[0].sub).toMatch(/^1 stop · [A-Z]{3} · \d+h/);
  });
});

describe('destSummary', () => {
  it('summarises a week of nonstops', () => {
    const s = destSummary('YUL', 'LHR', '2026-09-28', []);
    expect(s).toMatchObject({
      direct: true, operates: 'Daily', daysThisWeek: 7, aircraft: 'Airbus A330-300', aircraftShort: 'A330-300',
    });
    expect(s.stops).toMatch(/^Nonstop · \d+h\d\d$/);
    expect(s.meta).toBe(`${s.stops} · 7× this week · A330-300`);
    expect(s.season).toBe('Year-round');
  });

  it('falls back to the sample when the week has no nonstop', () => {
    const later = upcoming('YUL', 'ATH', '2026-10-01', NOON, 'direct', undefined, 3);
    const s = destSummary('YUL', 'ATH', '2026-11-02', later);
    expect(s.direct).toBe(true);
    expect(s.daysThisWeek).toBe(0);
    expect(s.operates).toBe('');
    expect(s.meta).not.toContain('this week');
  });

  it('describes connections, and nothing at all', () => {
    const via = findItineraries('YHZ', 'LHR', '2026-10-01');
    const s = destSummary('YHZ', 'LHR', '2026-09-28', via);
    expect(s).toMatchObject({ direct: false, stops: '1 stop · via YYZ', operates: '' });
    expect(s.meta).toMatch(/^1 stop · via YYZ · /);
    expect(destSummary('YUL', 'ATH', '2026-11-02', [])).toMatchObject({ direct: false, stops: '', meta: '' });
  });
});

describe('destState', () => {
  const cov = () => getCoverage('YUL');

  it('is ok when the week has a nonstop', () => {
    expect(destState('YUL', 'LHR', '2026-09-28', '2026-10-01', cov(), false)).toEqual({ kind: 'ok' });
  });

  it('flags a week beyond the published window', () => {
    expect(destState('YUL', 'LHR', '2027-05-03', '2026-10-01', cov(), false)).toEqual({ kind: 'outside', week: 'May 3 – 9' });
  });

  it('points at the next nonstop when the week has none', () => {
    const s = destState('YUL', 'ATH', '2026-09-21', '2026-09-21', cov(), false);
    expect(s).toEqual({ kind: 'no-nonstop', next: '2026-10-02', nextLabel: 'Fri, Oct 2', connections: false });
  });

  it('is not-served with no nonstop ahead and no connection', () => {
    expect(destState('YUL', 'AKL', '2026-11-02', '2026-10-01', cov(), false)).toEqual({ kind: 'not-served' });
    expect(destState('YUL', 'AKL', '2026-11-02', '2026-10-01', cov(), true)).toMatchObject({ kind: 'no-nonstop', next: null });
  });
});

describe('nextDeparture and nextConnectionDate', () => {
  it('formats the header block', () => {
    const its = upcoming('YUL', 'LHR', '2026-10-01', NOON, 'direct', undefined, 3);
    expect(nextDeparture(its[0], '2026-10-01')).toMatchObject({ when: 'Today · 22:10', detail: 'AC864 · arrives Fri 10:00 local' });
    expect(nextDeparture(its[1], '2026-10-01')!.when).toBe('Tomorrow · 22:10');
    expect(nextDeparture(its[0], '2026-09-28')!.when).toBe('Thu, Oct 1 · 22:10');
    expect(nextDeparture(null, '2026-10-01')).toBeNull();
  });

  it('finds the next connection inside the window only', () => {
    expect(nextConnectionDate('YHZ', 'LHR', '2026-10-01')).toBe('2026-10-01');
    expect(nextConnectionDate('YUL', 'ATH', '2026-10-01', undefined, 30)).toBeNull();
    expect(nextConnectionDate('YHZ', 'LHR', '2027-03-30', undefined, 10)).toBe('2027-03-30');
    expect(nextConnectionDate('YHZ', 'DEL', '2027-03-25', undefined, 30)).toBeNull();
    expect(nextConnectionDate('YHZ', 'LHR', '2027-05-01', undefined, 5)).toBeNull();
  });
});

describe('month availability', () => {
  it('builds a Monday-first month with bars sized by departures', () => {
    const m = availMonth('YUL', 'LHR', '2026-10', '2026-10-02', false);
    expect(m.title).toBe('October 2026');
    expect(m.lead).toBe(3); // Oct 1 2026 is a Thursday
    expect(m.cells).toHaveLength(31);
    expect(m.cells[0]).toMatchObject({ dateKey: '2026-10-01', off: true, fill: 0, direct: 0 });
    expect(m.cells[1]).toMatchObject({ day: 2, direct: 1, fill: 33, off: false, connect: false });
    expect(m.cells[2]).toMatchObject({ direct: 2, fill: 67 });
    expect(m.cells[2].label).toBe('Sat, Oct 3: 2 nonstop departures');
    expect(m.unpublished).toBe(false);
  });

  it('marks connection-only days and unpublished months', () => {
    const m = availMonth('YHZ', 'LHR', '2026-10', '2026-10-01', true);
    expect(m.cells[0]).toMatchObject({ connect: true, direct: 0, label: 'Thu, Oct 1: connection only' });
    const none = availMonth('YUL', 'ATH', '2026-11', '2026-10-01', false);
    expect(none.cells[0].label).toBe('Sun, Nov 1: no flights');
    const late = availMonth('YUL', 'LHR', '2027-05', '2026-10-01', false);
    expect(late.unpublished).toBe(true);
    expect(late.cells[0]).toMatchObject({ off: true, label: 'Sat, May 1: not yet published' });
  });

  it('ranges from today’s month to the coverage end', () => {
    expect(monthRange('2026-10-01', getCoverage('YUL'))).toEqual({ first: '2026-10', last: '2027-03' });
    expect(monthRange('2026-10-01', null)).toEqual({ first: '2026-10', last: '2026-12' });
    expect(monthRange('2027-06-01', getCoverage('YUL'))).toEqual({ first: '2027-06', last: '2027-06' });
  });
});
