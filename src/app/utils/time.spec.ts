import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonths,
  dateKey,
  diffDays,
  formatClock,
  formatDayOffset,
  formatDuration,
  formatKey,
  hhmmToMin,
  isDateKey,
  isValidTimeZone,
  keyToDate,
  minToHhmm,
  monthKeys,
  monthOf,
  toKey,
  todayKey,
  toUtcMs,
  tzOffsetMin,
  utcToLocal,
  weekKeys,
  weekStartKey,
  weekdayIndex,
} from './time';

describe('date keys', () => {
  it('validates keys', () => {
    expect(isDateKey('2026-10-01')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-1-01')).toBe(false);
    expect(isDateKey(20261001)).toBe(false);
  });

  it('converts Dates in the local calendar', () => {
    expect(dateKey(new Date(2026, 9, 1, 23, 59))).toBe('2026-10-01');
    expect(toKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toKey('2026-01-05')).toBe('2026-01-05');
    const d = keyToDate('2026-11-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 1, 0]);
  });

  it('adds days across months, years and DST changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(diffDays('2026-10-25', '2026-11-02')).toBe(8);
  });

  it('computes Monday-first weekdays and weeks', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-11')).toBe(6); // Sunday
    expect(weekStartKey('2026-10-11')).toBe('2026-10-05');
    expect(weekStartKey('2026-10-05')).toBe('2026-10-05');
    expect(weekKeys('2026-12-28')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });

  it('handles months', () => {
    expect(monthOf('2026-10-07')).toBe('2026-10');
    expect(monthKeys('2027-02')).toHaveLength(28);
    expect(monthKeys('2028-02')).toHaveLength(29);
    expect(monthKeys('2026-10')[30]).toBe('2026-10-31');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('clock math', () => {
  it('parses and formats HH:MM', () => {
    expect(hhmmToMin('22:10')).toBe(1330);
    expect(hhmmToMin('7:05')).toBe(425);
    expect(hhmmToMin('bad')).toBeNaN();
    expect(minToHhmm(1330)).toBe('22:10');
    expect(minToHhmm(1500)).toBe('01:00');
    expect(minToHhmm(-30)).toBe('23:30');
  });

  it('formats durations and offsets', () => {
    expect(formatDuration(425)).toBe('7h 05m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(720)).toBe('12h');
    expect(formatDuration(-5)).toBe('0m');
    expect(formatDayOffset(0)).toBe('');
    expect(formatDayOffset(1)).toBe('+1');
    expect(formatDayOffset(-1)).toBe('−1');
  });

  it('formats 12h clocks', () => {
    expect(formatClock('21:05', '12h')).toBe('9:05 PM');
    expect(formatClock('00:30', '12h')).toBe('12:30 AM');
    expect(formatClock('12:00', '12h')).toBe('12:00 PM');
    expect(formatClock('21:05')).toBe('21:05');
    expect(formatClock('xx', '12h')).toBe('xx');
  });

  it('formats date keys without zone drift', () => {
    expect(formatKey('2026-10-07', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
      .toBe('Wednesday, October 7, 2026');
  });
});

describe('time zones', () => {
  it('knows valid zones', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('computes DST-correct offsets', () => {
    expect(tzOffsetMin('America/Toronto', Date.UTC(2026, 6, 1))).toBe(-240);
    expect(tzOffsetMin('America/Toronto', Date.UTC(2026, 11, 1))).toBe(-300);
    expect(tzOffsetMin('Asia/Kolkata', Date.UTC(2026, 11, 1))).toBe(330);
    // Transition day: 2026-11-01 06:00Z is 01:00 EST (after fall-back).
    expect(tzOffsetMin('America/Toronto', Date.UTC(2026, 10, 1, 5, 59))).toBe(-240);
    expect(tzOffsetMin('America/Toronto', Date.UTC(2026, 10, 1, 6, 0))).toBe(-300);
  });

  it('applies the 2026 fixed-offset rules even with older runtime tz data', () => {
    const summer = Date.UTC(2026, 6, 1);
    const winter = Date.UTC(2026, 11, 15);
    expect(tzOffsetMin('America/Vancouver', summer)).toBe(-420);
    expect(tzOffsetMin('America/Vancouver', winter)).toBe(-420);
    expect(tzOffsetMin('America/Edmonton', winter)).toBe(-360);
    expect(tzOffsetMin('America/Winnipeg', winter)).toBe(-300);
    expect(tzOffsetMin('Africa/Casablanca', winter)).toBe(0);
    // Zones without an override keep following the runtime.
    expect(tzOffsetMin('America/Toronto', winter)).toBe(-300);
    expect(tzOffsetMin('America/Regina', winter)).toBe(-360);
    // The last change before the override still applies (PST → PDT, 2026-03-08).
    expect(tzOffsetMin('America/Vancouver', Date.UTC(2026, 1, 1))).toBe(-480);
    expect(toUtcMs('2026-12-01', '09:25', 'America/Vancouver')).toBe(Date.UTC(2026, 11, 1, 16, 25));
    expect(utcToLocal(Date.UTC(2027, 0, 5, 12), 'America/Winnipeg')).toEqual({ dateKey: '2027-01-05', hhmm: '07:00' });
  });

  it('converts local wall time to UTC', () => {
    expect(toUtcMs('2026-10-05', '22:10', 'America/Toronto')).toBe(Date.UTC(2026, 9, 6, 2, 10));
    expect(toUtcMs('2026-12-05', '22:10', 'America/Toronto')).toBe(Date.UTC(2026, 11, 6, 3, 10));
    expect(toUtcMs('2026-10-06', '10:00', 'Europe/London')).toBe(Date.UTC(2026, 9, 6, 9, 0));
    expect(toUtcMs('2026-10-06', '10:00', 'UTC')).toBe(Date.UTC(2026, 9, 6, 10, 0));
  });

  it('resolves DST gaps forward and ambiguous times to the first occurrence', () => {
    // 2027-03-14 02:30 does not exist in Toronto → 03:30 EDT = 07:30Z.
    expect(toUtcMs('2027-03-14', '02:30', 'America/Toronto')).toBe(Date.UTC(2027, 2, 14, 7, 30));
    // 2026-11-01 01:30 happens twice → first (EDT) = 05:30Z.
    expect(toUtcMs('2026-11-01', '01:30', 'America/Toronto')).toBe(Date.UTC(2026, 10, 1, 5, 30));
    // East of UTC too: the first occurrence is the summer-time one.
    expect(toUtcMs('2026-10-25', '01:30', 'Europe/London')).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(toUtcMs('2026-10-25', '02:30', 'Europe/Paris')).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(toUtcMs('2026-10-25', '03:30', 'Europe/Athens')).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(toUtcMs('2026-04-05', '02:30', 'Australia/Sydney')).toBe(Date.UTC(2026, 3, 4, 15, 30));
    expect(toUtcMs('2027-04-04', '02:30', 'Pacific/Auckland')).toBe(Date.UTC(2027, 3, 3, 13, 30));
    // Gaps east of UTC resolve forward: London 01:30 on 2027-03-28 → 02:30 BST = 01:30Z.
    expect(toUtcMs('2027-03-28', '01:30', 'Europe/London')).toBe(Date.UTC(2027, 2, 28, 1, 30));
    // Unambiguous times next to a transition are unaffected.
    expect(toUtcMs('2026-10-25', '00:30', 'Europe/London')).toBe(Date.UTC(2026, 9, 24, 23, 30));
    expect(toUtcMs('2026-10-25', '02:30', 'Europe/London')).toBe(Date.UTC(2026, 9, 25, 2, 30));
  });

  it('converts UTC to local date and time', () => {
    expect(utcToLocal(Date.UTC(2026, 9, 6, 2, 10), 'America/Toronto')).toEqual({ dateKey: '2026-10-05', hhmm: '22:10' });
    expect(utcToLocal(Date.UTC(2026, 9, 6, 2, 10), 'Asia/Tokyo')).toEqual({ dateKey: '2026-10-06', hhmm: '11:10' });
  });

  it('gives today in a zone', () => {
    const now = Date.UTC(2026, 9, 1, 3, 0); // 23:00 Sep 30 in Toronto
    expect(todayKey('America/Toronto', now)).toBe('2026-09-30');
    expect(todayKey('Europe/London', now)).toBe('2026-10-01');
    expect(isDateKey(todayKey())).toBe(true);
  });
});
