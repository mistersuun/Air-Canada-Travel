import { afterEach, describe, expect, it } from 'vitest';
import {
  ROUTE_INDEX,
  getAircraftCodes,
  getCoverage,
  getCoverageByAirport,
  getDestinationCodes,
  getOriginCodes,
  getRouteSchedules,
  getSchedulesForRoute,
  getSchedulesMeta,
  isCovered,
  resetScheduleSource,
  scheduleVersion,
  setScheduleSource,
} from './schedule-index';
import { ROUTE_SCHEDULES } from './schedules';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from './testing/schedule-fixtures';

afterEach(() => resetScheduleSource());

describe('schedule index', () => {
  it('indexes the generated schedules by default', () => {
    const r = ROUTE_SCHEDULES[0];
    expect(getSchedulesForRoute(r.originCode, r.destinationCode)).toBe(r.schedules);
    expect(getRouteSchedules()).toBe(ROUTE_SCHEDULES);
  });

  it('swaps to an injected source and back', () => {
    const v = scheduleVersion();
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    expect(scheduleVersion()).toBe(v + 1);
    expect(ROUTE_INDEX.get('YUL-LHR')).toHaveLength(2);
    expect(getSchedulesForRoute('YUL', 'LHR')).toHaveLength(2);
    expect(getSchedulesForRoute('YUL', 'ZZZ')).toEqual([]);
    expect(getSchedulesMeta()).toBe(FIXTURE_META);
    resetScheduleSource();
    expect(ROUTE_INDEX.get('YUL-LHR')).not.toHaveLength(2);
  });

  it('merges duplicate route entries and lists origins and destinations', () => {
    setScheduleSource([
      route('YUL', 'LHR', rec('AC1', '10:00', '22:00', '2026-10-01', '2026-10-31')),
      route('YUL', 'LHR', rec('AC2', '11:00', '23:00', '2026-10-01', '2026-10-31')),
      route('YYZ', 'LHR', rec('AC3', '11:00', '23:00', '2026-10-01', '2026-10-31')),
      route('YOW', 'LHR'),
    ]);
    expect(getSchedulesForRoute('YUL', 'LHR').map(s => s.flightNumber)).toEqual(['AC1', 'AC2']);
    expect(getOriginCodes('LHR')).toEqual(['YUL', 'YYZ']);
    expect(getDestinationCodes('YUL')).toEqual(['LHR']);
    expect(getDestinationCodes('ZZZ')).toEqual([]);
    expect(getAircraftCodes()).toEqual(['789']);
  });

  it('computes coverage globally, per airport, and prefers SCHEDULES_META', () => {
    setScheduleSource([
      route('YUL', 'LHR', rec('AC1', '10:00', '22:00', '2026-10-01', '2027-03-31')),
      route('YEG', 'LHR', rec('AC2', '10:00', '22:00', '2026-11-01', '2026-12-15')),
    ]);
    expect(getCoverage()).toEqual({ from: '2026-10-01', to: '2027-03-31', generatedAt: null, hub: null });
    expect(getCoverage('YEG')).toMatchObject({ from: '2026-11-01', to: '2026-12-15', hub: 'YEG' });
    expect(getCoverage('ZZZ').hub).toBeNull();
    expect(getCoverageByAirport().get('LHR')).toEqual({ from: '2026-10-01', to: '2027-03-31' });
    expect(isCovered('2026-12-16', 'YEG')).toBe(false);
    expect(isCovered('2026-12-16', 'YUL')).toBe(true);
    expect(isCovered('2027-04-01')).toBe(false);

    setScheduleSource(FIXTURE_ROUTES, { generatedAt: '2026-09-28T06:00:00Z', coverageFrom: '2026-01-01', coverageTo: '2027-12-31' });
    expect(getCoverage()).toEqual({ from: '2026-01-01', to: '2027-12-31', generatedAt: '2026-09-28T06:00:00Z', hub: null });
    expect(getCoverage('YUL').generatedAt).toBe('2026-09-28T06:00:00Z');
  });

  it('has no coverage without data', () => {
    setScheduleSource([]);
    expect(getCoverage()).toEqual({ from: null, to: null, generatedAt: null, hub: null });
    expect(isCovered('2026-10-01')).toBe(false);
  });
});
