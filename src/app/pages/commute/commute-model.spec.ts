import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, rec, route } from '../../data/testing/schedule-fixtures';
import { toUtcMs } from '../../utils/time';
import {
  CommuteInput, commuteAirports, commuteDays, commuteOptions, commuteProblem, tripHomeOptions,
} from './commute-model';

const WEEKDAYS = 'Mon,Tue,Wed,Thu,Fri';
const ALL = 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';
const A = '2026-09-01';
const B = '2027-03-31';

/** YOW → YYZ: one weekday early flight, then daily flights; YYZ → YOW for the trip home; a one-stop via YUL. */
const ROUTES = [
  route('YOW', 'YYZ',
    rec('AC401', '05:30', '06:40', A, B, WEEKDAYS, '223'),
    rec('AC403', '07:00', '08:10', A, B, ALL, '223'),
    rec('AC405', '12:00', '13:10', A, B, ALL, '223'),
    rec('AC407', '17:00', '18:10', A, B, ALL, '223'),
    rec('AC409', '21:00', '22:10', A, B, ALL, '223')),
  route('YOW', 'YUL', rec('AC501', '06:00', '06:50', A, B, ALL, '223')),
  route('YUL', 'YYZ', rec('AC503', '08:00', '09:25', A, B, ALL, '223')),
  route('YYZ', 'YOW',
    rec('AC402', '16:00', '17:10', A, B, ALL, '223'),
    rec('AC404', '17:30', '18:40', A, B, ALL, '223'),
    rec('AC406', '21:30', '22:40', A, B, ALL, '223')),
];

const TZ = 'America/Toronto';
/** Sun 2026-11-08 00:30 Toronto. */
const NOW = toUtcMs('2026-11-08', '00:30', TZ);
const input = (over: Partial<CommuteInput> = {}): CommuteInput => ({
  home: 'YOW', base: 'YYZ', bufferMin: 60, nowMs: NOW, showConnections: false, connect: { minConnect: 60 }, ...over,
});

beforeEach(() => setScheduleSource(ROUTES, FIXTURE_META));
afterEach(() => resetScheduleSource());

describe('commuteOptions', () => {
  it('lists nonstops that arrive a buffer before report, plus the evening before', () => {
    // Tue 2026-11-10 report 08:00, 60 min buffer: arrive by 07:00.
    const r = commuteOptions(input(), '2026-11-10', '08:00');
    expect(r.deadlineHhmm).toBe('07:00');
    expect(r.options.map(o => o.flights[0])).toEqual(['AC407', 'AC409', 'AC401']);
    expect(r.count).toBe(3);
    expect(r.nonstopCount).toBe(3);
    expect(r.options.map(o => o.dayBefore)).toEqual([true, true, false]);
  });

  it('orders by arrival and marks the latest that works', () => {
    const r = commuteOptions(input({ bufferMin: 30 }), '2026-11-10', '14:00');
    // Same day by 13:30: 401 (06:40), 403 (08:10), 405 (13:10); evening before: 407 (18:10), 409 (22:10).
    expect(r.options.map(o => o.flights[0])).toEqual(['AC407', 'AC409', 'AC401', 'AC403', 'AC405']);
    const latest = r.options.filter(o => o.latest);
    expect(latest).toHaveLength(1);
    expect(latest[0].flights[0]).toBe('AC405');
  });

  it('a flight that lands inside the buffer does not count', () => {
    const r = commuteOptions(input({ bufferMin: 90 }), '2026-11-10', '08:00');
    // 06:40 lands after 06:30 (08:00 minus 90 min): only the evening before is left.
    expect(r.options.filter(o => !o.dayBefore)).toEqual([]);
    expect(commuteOptions(input({ bufferMin: 60 }), '2026-11-10', '07:40').options.filter(o => !o.dayBefore)).toHaveLength(1);
  });

  it('counts the one-stop only when connections are shown, nonstops first', () => {
    const off = commuteOptions(input(), '2026-11-10', '12:00');
    const on = commuteOptions(input({ showConnections: true }), '2026-11-10', '12:00');
    expect(off.options.every(o => o.nonstop)).toBe(true);
    const stop = on.options.find(o => !o.nonstop)!;
    expect(stop.flights).toEqual(['AC501', 'AC503']);
    expect(on.count).toBe(off.count + 1);
    expect(on.options.findIndex(o => !o.nonstop)).toBe(on.options.length - 1);
  });

  it('skips flights that already left', () => {
    const late = input({ nowMs: toUtcMs('2026-11-10', '05:45', TZ) });
    const r = commuteOptions(late, '2026-11-10', '14:00');
    expect(r.options.map(o => o.flights[0])).not.toContain('AC401');
  });

  it('is empty when nothing is scheduled for the pair', () => {
    expect(commuteOptions(input({ home: 'YVR' }), '2026-11-10', '08:00').count).toBe(0);
  });
});

describe('commuteDays', () => {
  it('counts same-day arrivals for 14 days and flags fewer than 2', () => {
    const days = commuteDays(input(), '12:00', '2026-11-08');
    expect(days).toHaveLength(14);
    // Arrive by 11:00: weekdays 401 + 403 (2); weekends 403 only (1).
    const sun = days[0];
    expect(sun.dateKey).toBe('2026-11-08');
    expect(sun.count).toBe(1);
    expect(sun.fewer).toBe(true);
    expect(sun.lastHhmm).toBe('08:10');
    const mon = days[1];
    expect(mon.count).toBe(2);
    expect(mon.fewer).toBe(false);
    expect(days.filter(d => d.fewer).map(d => d.dateKey)).toEqual(['2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21']);
  });

  it('has no flag where the schedules do not reach', () => {
    const days = commuteDays(input(), '12:00', '2027-03-28');
    expect(days.at(-1)).toEqual({ dateKey: '2027-04-10', count: null, lastHhmm: null, fewer: false });
  });
});

describe('tripHomeOptions', () => {
  it('lists base → home flights leaving at least 45 min after release', () => {
    const r = tripHomeOptions(input(), '2026-11-10', '16:30');
    // 16:00 left before release; 17:30 is 60 min after.
    expect(r.map(o => o.flights[0])).toEqual(['AC404', 'AC406']);
    expect(tripHomeOptions(input(), '2026-11-10', '16:50').map(o => o.flights[0])).toEqual(['AC406']);
    expect(tripHomeOptions(input(), '2026-11-10', '16:45').map(o => o.flights[0])).toEqual(['AC404', 'AC406']);
  });
});

describe('helpers', () => {
  it('validates the pair', () => {
    expect(commuteProblem('', 'YYZ')).toBe('home');
    expect(commuteProblem('YYZ', 'YYZ')).toBe('same');
    expect(commuteProblem('YOW', 'YYZ')).toBeNull();
  });

  it('offers hubs and destinations once each', () => {
    const list = commuteAirports();
    const codes = list.map(a => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('YOW');
    expect(codes).toContain('LHR');
  });
});
