import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../data/testing/schedule-fixtures';
import {
  buildInstance,
  countFlyingDays,
  coverageHubFor,
  flightsOn,
  formatDayLabel,
  formatWeekLabel,
  formatWeekNavLabel,
  getFlightForDay,
  getFlightsForWeek,
  getWeekStart,
  nextFlightDate,
  parseDayMask,
  routeHasFlightOnDay,
  routeHasFlightsInWeek,
  weekdayShort,
} from './week';

beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
afterEach(() => {
  resetScheduleSource();
  vi.useRealTimers();
});

describe('getWeekStart', () => {
  it('returns the Monday at local midnight without mutating the input', () => {
    const wed = new Date('2026-06-10T09:00:00');
    const before = wed.getTime();
    const r = getWeekStart(wed);
    expect([r.getDay(), r.getDate(), r.getHours()]).toEqual([1, 8, 0]);
    expect(getWeekStart(new Date('2026-06-14T20:00:00')).getDate()).toBe(8); // Sunday
    expect(getWeekStart(new Date('2026-06-08T12:00:00')).getDate()).toBe(8); // Monday
    expect(wed.getTime()).toBe(before);
  });
});

describe('parseDayMask', () => {
  it('maps weekday names to Monday-first bits', () => {
    expect(parseDayMask('Mon,Wed,Sun')).toBe(0b1000101);
    expect(parseDayMask('')).toBe(0);
    expect(parseDayMask('Xyz, tue')).toBe(0b10);
  });
});

describe('flightsOn / getFlightsForWeek', () => {
  it('returns every flight on a double day, de-duplicated and sorted by departure', () => {
    const f = flightsOn('YUL', 'ATH', '2026-10-05'); // Monday: AC898 twice (dup row) + AC922
    expect(f.map(x => x.flightNumber)).toEqual(['AC898', 'AC922']);
    expect(f[0].depUtc).toBeLessThan(f[1].depUtc);
    expect(f[0].aircraft).toBe('788'); // first matching row wins
    const week = getFlightsForWeek('YUL', 'ATH', '2026-10-05');
    expect(week.map(d => d.flights.length)).toEqual([2, 0, 2, 0, 2, 0, 0]);
  });

  it('infers +1 for an overnight eastbound flight (YUL→LHR 22:10→10:00)', () => {
    const [f] = flightsOn('YUL', 'LHR', '2026-10-05');
    expect(f.flightNumber).toBe('AC864');
    expect(f.arrDayOffset).toBe(1);
    expect(f.arrDateKey).toBe('2026-10-06');
    expect(f.durationMin).toBe(410); // 6h50: EDT → BST
    expect(f.estimated).toBe(false);
  });

  it('infers 0 across the date line when the calendar date is unchanged (AKL→YVR)', () => {
    const [f] = flightsOn('AKL', 'YVR', '2026-12-04');
    expect(f.arrDayOffset).toBe(0);
    expect(f.durationMin).toBe(845); // 14:00 NZDT → 07:05 PST same date = 14h05
  });

  it('infers +2 for YVR→SYD', () => {
    const [f] = flightsOn('YVR', 'SYD', '2026-12-01');
    expect(f.arrDayOffset).toBe(2);
    expect(f.durationMin).toBe(870); // 23:40 PST → 09:10 AEDT two days later = 14h30
  });

  it('honours an explicit arrDayOffset (including −1)', () => {
    const r = rec('AC1', '01:00', '22:00', '2026-10-01', '2026-10-31', 'Mon', '789', { arrDayOffset: -1 });
    const f = buildInstance(r, 'SYD', 'YVR', '2026-10-05');
    expect(f.arrDayOffset).toBe(-1);
    expect(f.arrDateKey).toBe('2026-10-04');
    expect(f.durationMin).toBeGreaterThan(0);
  });

  it('includes a one-day override (fromDate == toDate)', () => {
    expect(flightsOn('YUL', 'LHR', '2026-10-03').map(f => f.flightNumber)).toEqual(['AC868', 'AC864']);
    expect(flightsOn('YUL', 'LHR', '2026-10-10').map(f => f.flightNumber)).toEqual(['AC864']);
  });

  it('treats toDate as inclusive, even when called with a Date at noon', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-03-31T12:00:00'));
    expect(getFlightForDay('YUL', 'LHR', new Date()).flies).toBe(true); // toDate = 2027-03-31
    expect(routeHasFlightOnDay('YUL', 'LHR', '2027-04-01')).toBe(false);
  });

  it('computes durations across the DST week (UK falls back Oct 25, Canada Nov 1)', () => {
    const week = getFlightsForWeek('YUL', 'LHR', '2026-10-26');
    const durations = week.map(d => d.flights[0].durationMin);
    // Mon–Sat depart on EDT and land on GMT (7h50); Sunday Nov 1 departs on EST (6h50).
    expect(durations).toEqual([470, 470, 470, 470, 470, 470, 410]);
    const oct24 = flightsOn('YUL', 'LHR', '2026-10-24')[0];
    expect(oct24.durationMin).toBe(470); // lands Sun Oct 25 after the UK change
  });

  it('marks days outside published coverage', () => {
    const week = getFlightsForWeek('YUL', 'LHR', '2027-03-29');
    expect(week.map(d => d.coverage)).toEqual(['covered', 'covered', 'covered', 'outside', 'outside', 'outside', 'outside']);
    expect(week[3].flies).toBe(false);
  });

  it('fills the deprecated first-flight fields', () => {
    const d = getFlightForDay('YUL', 'ATH', '2026-10-07');
    expect(d.flightNumber).toBe('AC898');
    expect(d.departure).toBe('17:25');
    expect(d.arrival).toBe('10:35');
    expect(d.aircraft).toBe('788');
    expect(d.date.getDate()).toBe(7);
    expect(getFlightForDay('YUL', 'ATH', '2026-10-06').flightNumber).toBeUndefined();
  });

  it('accepts a legacy Date week start without mutating it', () => {
    const d = new Date('2026-10-05T00:00:00');
    const before = d.getTime();
    const week = getFlightsForWeek('YUL', 'ATH', d);
    expect(week[0].dateKey).toBe('2026-10-05');
    expect(week[6].dateKey).toBe('2026-10-11');
    expect(d.getTime()).toBe(before);
  });

  it('returns nothing for unknown routes', () => {
    expect(getFlightsForWeek('YYZ', 'ZZZ', '2026-10-05').every(d => !d.flies)).toBe(true);
    expect(routeHasFlightsInWeek('YYZ', 'ZZZ', '2026-10-05')).toBe(false);
    expect(routeHasFlightsInWeek('YUL', 'ATH', '2026-10-05')).toBe(true);
  });

  it('skips malformed rows', () => {
    setScheduleSource([route('YUL', 'LHR',
      rec('AC1', 'xx:yy', '10:00', '2026-10-01', '2026-10-31'),
      rec('AC2', '10:00', '12:00', '2026-10-31', '2026-10-01'),
      rec('AC3', '10:00', '22:00', '2026-10-01', '2026-10-31'),
    )]);
    expect(flightsOn('YUL', 'LHR', '2026-10-05').map(f => f.flightNumber)).toEqual(['AC3']);
  });

  it('follows the schedule source when it changes', () => {
    expect(flightsOn('YUL', 'LHR', '2026-10-05')).toHaveLength(1);
    setScheduleSource([]);
    expect(flightsOn('YUL', 'LHR', '2026-10-05')).toHaveLength(0);
  });
});

describe('nextFlightDate / countFlyingDays', () => {
  it('finds the next operating date', () => {
    expect(nextFlightDate('YUL', 'ATH', '2026-10-06')).toBe('2026-10-07');
    expect(nextFlightDate('YUL', 'ATH', '2026-10-07')).toBe('2026-10-07');
    expect(nextFlightDate('YUL', 'ATH', '2026-10-07', false)).toBe('2026-10-09');
    expect(nextFlightDate('YUL', 'ATH', '2026-09-01')).toBe('2026-10-02'); // first Friday in range
    expect(nextFlightDate('AKL', 'YVR', '2026-10-01')).toBe('2026-12-04');
  });

  it('returns null when nothing is published later', () => {
    expect(nextFlightDate('YUL', 'ATH', '2026-11-01')).toBeNull();
    expect(nextFlightDate('YUL', 'ZZZ', '2026-10-01')).toBeNull();
  });

  it('counts flying days', () => {
    expect(countFlyingDays('YUL', 'ATH', '2026-10-01', '2026-10-31')).toBe(13);
  });
});

describe('coverageHubFor', () => {
  it('uses the hub end of a route', () => {
    expect(coverageHubFor('YUL', 'LHR')).toBe('YUL');
    expect(coverageHubFor('LHR', 'YUL')).toBe('YUL');
    expect(coverageHubFor('AKL', 'SYD')).toBeNull();
  });
});

describe('labels', () => {
  it('formats a week in one month', () => {
    expect(formatWeekLabel('2026-06-08')).toBe('Jun 8 – 14, 2026');
    expect(formatWeekLabel(new Date('2026-06-08T00:00:00'))).toBe('Jun 8 – 14, 2026');
  });

  it('formats a week across months and years', () => {
    expect(formatWeekLabel('2026-09-28')).toBe('Sep 28 – Oct 4, 2026');
    expect(formatWeekLabel('2026-12-28')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('formats nav and day labels', () => {
    expect(formatWeekNavLabel('2026-06-08')).toBe('Jun 8');
    expect(formatDayLabel(new Date('2026-06-09T00:00:00'))).toBe('Tue, Jun 9');
    expect(weekdayShort('2026-06-09')).toBe('Tue');
  });
});
