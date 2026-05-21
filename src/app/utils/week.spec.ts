import { describe, it, expect } from 'vitest';
import {
  getWeekStart,
  getFlightsForWeek,
  routeHasFlightsInWeek,
  formatWeekLabel,
  formatWeekNavLabel,
  formatDayLabel,
} from './week';

describe('getWeekStart', () => {
  it('returns Monday when given a Monday', () => {
    const mon = new Date('2026-06-08T12:00:00');
    const result = getWeekStart(mon);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(0);
  });

  it('returns the preceding Monday when given a Wednesday', () => {
    const wed = new Date('2026-06-10T09:00:00');
    const result = getWeekStart(wed);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(8);
  });

  it('returns the preceding Monday when given a Sunday', () => {
    const sun = new Date('2026-06-14T20:00:00');
    const result = getWeekStart(sun);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(8);
  });

  it('does not mutate the input date', () => {
    const d = new Date('2026-06-10T09:00:00');
    const before = d.getTime();
    getWeekStart(d);
    expect(d.getTime()).toBe(before);
  });
});

describe('getFlightsForWeek', () => {
  // YYZ → BDA flies Fri,Sun from 2026-11-01 to 2027-03-12
  const weekStart = new Date('2026-11-02T00:00:00'); // Mon Nov 2 2026

  it('returns exactly 7 DayFlight entries', () => {
    const result = getFlightsForWeek('YYZ', 'BDA', weekStart);
    expect(result).toHaveLength(7);
  });

  it('sets date correctly for each day of the week', () => {
    const result = getFlightsForWeek('YYZ', 'BDA', weekStart);
    expect(result[0].date.getDate()).toBe(2);  // Mon Nov 2
    expect(result[6].date.getDate()).toBe(8);  // Sun Nov 8
  });

  it('returns flies=true for Fri and Sun (days the schedule operates)', () => {
    const result = getFlightsForWeek('YYZ', 'BDA', weekStart);
    expect(result[4].flies).toBe(true); // Fri Nov 6
    expect(result[6].flies).toBe(true); // Sun Nov 8
  });

  it('returns flies=false for Mon, Tue, Wed, Thu, Sat', () => {
    const result = getFlightsForWeek('YYZ', 'BDA', weekStart);
    expect(result[0].flies).toBe(false); // Mon
    expect(result[1].flies).toBe(false); // Tue
    expect(result[2].flies).toBe(false); // Wed
    expect(result[3].flies).toBe(false); // Thu
    expect(result[5].flies).toBe(false); // Sat
  });

  it('populates flightNumber, departure, arrival when flies=true', () => {
    const result = getFlightsForWeek('YYZ', 'BDA', weekStart);
    const fri = result[4];
    expect(fri.flightNumber).toBeDefined();
    expect(fri.departure).toBeDefined();
    expect(fri.arrival).toBeDefined();
  });

  it('returns all flies=false for unknown route', () => {
    const result = getFlightsForWeek('YYZ', 'ZZZ', weekStart);
    expect(result.every(d => !d.flies)).toBe(true);
  });

  it('does not mutate weekStart', () => {
    const d = new Date('2026-11-02T00:00:00');
    const before = d.getTime();
    getFlightsForWeek('YYZ', 'BDA', d);
    expect(d.getTime()).toBe(before);
  });
});

describe('routeHasFlightsInWeek', () => {
  it('returns true for a route with flights in the week', () => {
    const weekStart = new Date('2026-11-02T00:00:00');
    expect(routeHasFlightsInWeek('YYZ', 'BDA', weekStart)).toBe(true);
  });

  it('returns false for an unknown route', () => {
    const weekStart = new Date('2026-11-02T00:00:00');
    expect(routeHasFlightsInWeek('YYZ', 'ZZZ', weekStart)).toBe(false);
  });
});

describe('formatWeekLabel', () => {
  it('formats a full week label', () => {
    const weekStart = new Date('2026-06-08T00:00:00');
    const result = formatWeekLabel(weekStart);
    // Expect "Jun 8 – 14, 2026" — exact format depends on system locale
    expect(result).toMatch(/Jun.*8/);
    expect(result).toMatch(/14/);
    expect(result).toMatch(/2026/);
  });
});

describe('formatWeekNavLabel', () => {
  it('formats a short nav label', () => {
    const weekStart = new Date('2026-06-08T00:00:00');
    const result = formatWeekNavLabel(weekStart);
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/8/);
  });
});

describe('formatDayLabel', () => {
  it('formats a day label for flight rows', () => {
    const d = new Date('2026-06-09T00:00:00'); // Tuesday
    const result = formatDayLabel(d);
    expect(result).toMatch(/Tue/);
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/9/);
  });
});
