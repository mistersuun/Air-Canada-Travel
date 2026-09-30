import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  decodeDayMask,
  decodeSchedules,
  installSchedules,
  isCovered,
  loadSchedules,
  resetScheduleSource,
  scheduleVersion,
  setScheduleSource,
} from './schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from './testing/schedule-fixtures';

afterEach(() => resetScheduleSource());

describe('schedule index', () => {
  it('indexes the published schedules by default (installed by test-setup)', () => {
    const routes = getRouteSchedules();
    expect(routes.length).toBeGreaterThan(100);
    const r = routes[0];
    expect(getSchedulesForRoute(r.originCode, r.destinationCode)).toBe(r.schedules);
    expect(getSchedulesMeta()?.recordCount).toBe(routes.reduce((n, x) => n + x.schedules.length, 0));
  });

  it('decodes the compact file format', () => {
    expect(decodeDayMask('M-W-F--')).toBe('Mon,Wed,Fri');
    expect(decodeDayMask('---R--U')).toBe('Thu,Sun');
    const { routes, meta } = decodeSchedules({
      version: 1,
      meta: { generatedAt: '2026-10-01T00:00:00Z' },
      routes: { 'YUL-CDG': [['2026-10-01', '2026-10-31', '-T---S-', 'AC870', '18:30', '07:45', '333']] },
    });
    expect(meta?.generatedAt).toBe('2026-10-01T00:00:00Z');
    expect(routes).toEqual([{ originCode: 'YUL', destinationCode: 'CDG', schedules: [
      { fromDate: '2026-10-01', toDate: '2026-10-31', days: 'Tue,Sat', flightNumber: 'AC870', departure: '18:30', arrival: '07:45', aircraft: '333' },
    ] }]);
    expect(() => decodeSchedules({ version: 2, routes: {} })).toThrow();
  });

  it('loads the file over fetch and keeps the old data when it cannot', async () => {
    const file = { version: 1, meta: {}, routes: { 'YUL-CDG': [['2026-10-01', '2026-10-31', 'MTWRFSU', 'AC870', '18:30', '07:45', '333']] } };
    const ok = vi.fn(async () => new Response(JSON.stringify(file)));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadSchedules('x.json', ok as typeof fetch)).toBe(true);
    expect(ok).toHaveBeenCalledWith('x.json');
    expect(getSchedulesForRoute('YUL', 'CDG')).toHaveLength(1);
    expect(await loadSchedules('x.json', (async () => new Response('', { status: 404 })) as typeof fetch)).toBe(false);
    expect(getSchedulesForRoute('YUL', 'CDG')).toHaveLength(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    // Restore the published data for the other specs.
    installSchedules(JSON.parse(readFileSync(`${process.cwd()}/public/data/schedules.json`, 'utf8')));
    expect(getRouteSchedules().length).toBeGreaterThan(100);
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
