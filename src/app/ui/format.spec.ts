import { describe, it, expect } from 'vitest';
import type { Itinerary } from '../utils/connections';
import {
  countdown, daysLabel, formatStay, freshnessAge, greeting, hm, hubDisplayName, isOutside, itinKey, longDay,
  operatesLabel, prettyFlight, relativeCountdown, relativeDay, shortDay, stopsLabel, supOffset, timeRange,
  tzAbbr, tzDiffLabel, weekRangeLabel,
} from './format';

const it1 = {
  legs: [{ flightNumber: 'AC300', origin: 'YUL', dest: 'YYZ', depUtc: 1 }, { flightNumber: null, origin: 'YYZ', dest: 'NRT', depUtc: 2 }],
  hubs: ['YYZ'],
} as unknown as Itinerary;

describe('ui/format', () => {
  it('compact durations', () => {
    expect(hm(395)).toBe('6h35');
    expect(hm(365)).toBe('6h05');
    expect(hm(45)).toBe('45m');
    expect(hm(780)).toBe('13h');
    expect(hm(-5)).toBe('0m');
  });

  it('superscript day offsets', () => {
    expect(supOffset(1)).toBe('⁺¹');
    expect(supOffset(-1)).toBe('⁻¹');
    expect(supOffset(2)).toBe('⁺²');
    expect(supOffset(0)).toBe('');
    expect(supOffset(null)).toBe('');
  });

  it('time ranges in 24h and 12h', () => {
    const f = { depLocal: '18:15', arrLocal: '07:05', arrDayOffset: 1 };
    expect(timeRange(f)).toBe('18:15 → 07:05⁺¹');
    expect(timeRange(f, '12h')).toBe('6:15 PM → 7:05 AM⁺¹');
  });

  it('greets by the hub clock', () => {
    const tz = 'America/Toronto';
    expect(greeting(Date.parse('2026-10-01T13:00:00Z'), tz)).toBe('Good morning'); // 09:00
    expect(greeting(Date.parse('2026-10-01T18:00:00Z'), tz)).toBe('Good afternoon'); // 14:00
    expect(greeting(Date.parse('2026-10-02T01:00:00Z'), tz)).toBe('Good evening'); // 21:00
    expect(greeting(Date.parse('2026-10-01T06:00:00Z'), tz)).toBe('Good evening'); // 02:00
  });

  it('relative days', () => {
    expect(relativeDay('2026-10-01', '2026-10-01')).toBe('Today');
    expect(relativeDay('2026-10-02', '2026-10-01')).toBe('Tomorrow');
    expect(relativeDay('2026-10-03', '2026-10-01')).toBe('Sat');
    expect(relativeDay('2026-10-12', '2026-10-01')).toBe('Mon, Oct 12');
  });

  it('countdowns', () => {
    expect(countdown(130 * 60000)).toBe('in 2h 10m');
    expect(countdown(25 * 60000)).toBe('in 25m');
    expect(countdown(120 * 60000)).toBe('in 2h');
    expect(countdown((2 * 1440 + 180) * 60000)).toBe('in 2d 3h');
    expect(countdown(2 * 1440 * 60000)).toBe('in 2d');
    expect(countdown(0)).toBe('now');
  });

  it('relative countdown badges', () => {
    const now = 0;
    expect(relativeCountdown(0, now, '2026-10-01', '2026-10-01', '08:40')).toBe('Today · 08:40');
    expect(relativeCountdown(130 * 60000, now, '2026-10-01', '2026-10-01')).toBe('Today · in 2h 10m');
    expect(relativeCountdown(0, now, '2026-10-02', '2026-10-01', '08:40')).toBe('Tomorrow · 08:40');
    expect(relativeCountdown(0, now, '2026-10-02', '2026-10-01')).toBe('Tomorrow · Fri');
    expect(relativeCountdown(0, now, '2026-10-03', '2026-10-01')).toBe('In 2 days · Sat');
  });

  it('time zone differences and names', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(tzDiffLabel('Asia/Tokyo', 'America/Toronto', now)).toBe('+13h');
    expect(tzDiffLabel('America/Vancouver', 'America/Toronto', now)).toBe('−3h');
    expect(tzDiffLabel('Asia/Kolkata', 'America/Toronto', now)).toBe('+9h30');
    expect(tzDiffLabel('America/Toronto', 'America/Toronto', now)).toBe('0h');
    expect(tzAbbr('America/Toronto', now)).toBe('EDT');
    expect(tzAbbr('Not/AZone', now)).toBe('');
  });

  it('days and hubs', () => {
    expect(daysLabel(7)).toBe('Daily');
    expect(daysLabel(6)).toBe('6× wk');
    expect(hubDisplayName('YUL')).toBe('Montréal');
    expect(hubDisplayName('YYZ')).toBe('Toronto');
    expect(hubDisplayName('XXX')).toBe('XXX');
  });

  it('flight-modal helpers', () => {
    expect(prettyFlight('AC 812')).toBe('AC812');
    expect(prettyFlight('AC812')).toBe('AC812');
    expect(prettyFlight(null)).toBe('');
    expect(shortDay('2026-10-07')).toBe('Wed, Oct 7');
    expect(longDay('2026-10-07')).toBe('Wednesday, October 7');
    expect(formatStay(((3 * 24 + 22) * 60) * 60000)).toBe('3d 22h');
    expect(formatStay(2 * 86400000)).toBe('2d');
    expect(formatStay(22 * 3600000)).toBe('22h');
    expect(formatStay(45 * 60000)).toBe('45m');
    expect(operatesLabel(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12'])).toBe('Mon Wed Fri');
    expect(operatesLabel(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])).toBe('Daily');
    expect(stopsLabel(it1)).toBe('1 stop · YYZ');
    expect(stopsLabel({ ...it1, hubs: [] })).toBe('Nonstop');
    expect(stopsLabel({ ...it1, hubs: ['YYZ', 'YVR'] })).toBe('2 stops · YYZ YVR');
    expect(itinKey(it1)).toBe('AC300YULYYZ1_ESTYYZNRT2');
    const cov = { from: '2026-09-01', to: '2027-03-31', generatedAt: null, hub: 'YUL' };
    expect(isOutside('2027-04-01', cov)).toBe(true);
    expect(isOutside('2026-08-31', cov)).toBe(true);
    expect(isOutside('2026-10-01', cov)).toBe(false);
    expect(isOutside('2026-10-01', null)).toBe(false);
  });

  it('week labels and freshness', () => {
    expect(weekRangeLabel('2026-10-05')).toBe('Oct 5 – 11');
    expect(weekRangeLabel('2026-09-28')).toBe('Sep 28 – Oct 4');
    expect(weekRangeLabel('2026-12-28')).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(freshnessAge('2026-09-30T08:00:00Z', '2026-09-30')?.text).toBe('today');
    expect(freshnessAge('2026-09-29T12:00:00Z', '2026-09-30')?.text).toBe('yesterday');
    expect(freshnessAge('2026-09-27T12:00:00Z', '2026-09-30')).toEqual({ days: 3, text: '3 days ago' });
    expect(freshnessAge('not a date', '2026-09-30')).toBeNull();
  });
});
