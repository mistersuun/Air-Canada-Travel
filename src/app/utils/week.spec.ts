import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../data/testing/schedule-fixtures';
import {
  buildInstance,
  countFlyingDays,
  coverageHubFor,
  droppedForBlockTime,
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

  it('keeps one instance per flight number, preferring the newer filing when times overlap', () => {
    setScheduleSource([route('YUL', 'LHR',
      rec('AC864', '22:00', '10:00', '2026-09-01', '2027-03-31', undefined, '333'),
      rec('AC864', '18:40', '06:40', '2026-10-05', '2026-10-07', undefined, '333'),
    )]);
    expect(flightsOn('YUL', 'LHR', '2026-10-06').map(f => f.depLocal)).toEqual(['18:40']);
    expect(flightsOn('YUL', 'LHR', '2026-10-08').map(f => f.depLocal)).toEqual(['22:00']);
  });

  it('prefers the more specific filing, then the later-starting one (BOS-YUL AC8611, SFO-YVR AC567)', () => {
    setScheduleSource([route('BOS', 'YUL',
      // A one-day retime inside a week-long filing that starts the same day.
      rec('AC8611', '19:00', '20:29', '2026-10-08', '2026-10-15', 'Mon,Thu,Fri,Sun', 'E75'),
      rec('AC8611', '18:50', '20:19', '2026-10-08', '2026-10-08', 'Thu', 'E75'),
    ), route('SFO', 'YVR',
      // A stale season-long row vs the newer month rows inside it.
      rec('AC567', '14:45', '18:05', '2026-12-01', '2027-02-28', undefined, '223'),
      rec('AC567', '14:40', '18:00', '2027-02-01', '2027-02-28', undefined, '223'),
    )]);
    expect(flightsOn('BOS', 'YUL', '2026-10-08').map(f => f.depLocal)).toEqual(['18:50']);
    expect(flightsOn('BOS', 'YUL', '2026-10-09').map(f => f.depLocal)).toEqual(['19:00']);
    expect(flightsOn('SFO', 'YVR', '2027-02-10').map(f => f.depLocal)).toEqual(['14:40']);
    expect(flightsOn('SFO', 'YVR', '2027-01-10').map(f => f.depLocal)).toEqual(['14:45']);
  });

  it('shows two flight numbers filed for the same departure once (YYZ-AUS AC1043/AC1739)', () => {
    setScheduleSource([route('YYZ', 'AUS',
      rec('AC1739', '08:15', '10:48', '2026-10-22', '2026-10-22', 'Thu', '7M8'),
      rec('AC1043', '08:15', '10:48', '2026-10-20', '2026-10-24', 'Tue,Thu,Fri,Sat', '223'),
      rec('AC1043', '17:45', '20:18', '2026-10-19', '2026-10-19', 'Mon', '223'),
    )]);
    const [f, ...rest] = flightsOn('YYZ', 'AUS', '2026-10-22');
    expect(rest).toEqual([]);
    expect(f.flightNumber).toBe('AC1043');
    expect(f.altFlightNumbers).toEqual(['AC1739']);
    expect(flightsOn('YYZ', 'AUS', '2026-10-23')[0].altFlightNumbers).toBeUndefined();
  });

  it('reads YVR, YYC and YWG with their post-2026 fixed offsets', () => {
    setScheduleSource([
      route('YVR', 'SEA', rec('AC8798', '09:25', '09:32', '2026-11-02', '2027-02-27', undefined, 'CR9')),
      route('YWG', 'YYZ', rec('AC256', '06:15', '08:50', '2026-11-02', '2026-11-30', undefined, '320')),
      route('YYC', 'EWR', rec('AC584', '07:45', '13:26', '2026-11-01', '2026-11-30', undefined, '320')),
    ]);
    // PDT kept all winter: 09:25 (UTC−7) → 09:32 PST (UTC−8) is 67 min, not 7.
    expect(flightsOn('YVR', 'SEA', '2026-11-10')[0].durationMin).toBe(67);
    // Manitoba keeps CDT: 06:15 (UTC−5) → 08:50 EST = 155 min, not 95.
    expect(flightsOn('YWG', 'YYZ', '2026-11-10')[0].durationMin).toBe(155);
    // Alberta keeps MDT: 07:45 (UTC−6) → 13:26 EST = 281 min, as 06:45 → 13:26 EDT in October.
    expect(flightsOn('YYC', 'EWR', '2026-11-10')[0].durationMin).toBe(281);
    expect(droppedForBlockTime()).toEqual([]);
  });

  it('drops instances with implausible block times (parse errors)', () => {
    setScheduleSource([
      route('YUL', 'FRA', rec('AC845', '09:55', '12:00', '2026-09-01', '2027-03-31', undefined, '333')),
      route('YVR', 'SEA', rec('AC8798', '10:00', '10:07', '2026-09-01', '2027-03-31', undefined, 'DH4')),
      route('YUL', 'LHR', rec('AC864', '22:10', '10:00', '2026-09-01', '2027-03-31', undefined, '333')),
    ]);
    expect(flightsOn('YUL', 'FRA', '2026-10-06')).toEqual([]); // ~20h "+1"
    expect(flightsOn('YVR', 'SEA', '2026-10-06')).toEqual([]); // 7 min
    expect(flightsOn('YUL', 'LHR', '2026-10-06')).toHaveLength(1);
    expect(droppedForBlockTime().map(f => `${f.origin}-${f.dest}`).sort()).toEqual(['YUL-FRA', 'YVR-SEA']);
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
    expect(f.durationMin).toBe(785); // 14:00 NZDT → 07:05 same date; YVR stays on UTC−7 from Nov 2026 = 13h05
  });

  it('infers +2 for YVR→SYD', () => {
    const [f] = flightsOn('YVR', 'SYD', '2026-12-01');
    expect(f.arrDayOffset).toBe(2);
    expect(f.durationMin).toBe(930); // 23:40 (UTC−7) → 09:10 AEDT two days later = 15h30
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
