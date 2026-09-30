/**
 * Synthetic schedule fixtures for behavioural tests (critique 9).
 *
 * Specs inject them with setScheduleSource(...) and restore the generated data
 * with resetScheduleSource() in afterEach, so tests never depend on live
 * schedules that expire. Times are local at each airport, like the PDFs.
 */
import type { ScheduleRecord, ScheduleRoute, SchedulesMeta } from '../schedule-index';

export const ALL_DAYS = 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';

/** One schedule row. */
export function rec(
  flightNumber: string,
  departure: string,
  arrival: string,
  fromDate: string,
  toDate: string,
  days: string = ALL_DAYS,
  aircraft = '789',
  extra: Partial<ScheduleRecord> = {},
): ScheduleRecord {
  return { fromDate, toDate, days, flightNumber, departure, arrival, aircraft, ...extra };
}

export function route(originCode: string, destinationCode: string, ...schedules: ScheduleRecord[]): ScheduleRoute {
  return { originCode, destinationCode, schedules };
}

export const FIXTURE_META: SchedulesMeta = {
  generatedAt: '2026-09-28T06:00:00Z',
  coverageFrom: '2026-09-01',
  coverageTo: '2027-03-31',
};

/**
 * A small world, autumn 2026 to spring 2027:
 * - YUL→LHR AC864 22:10→10:00 daily (+1), plus a one-day override AC868 on Sat 2026-10-03.
 * - YUL→ATH AC898 and AC922 on Mon/Wed/Fri in October (two flights a day), with
 *   a duplicate AC898 row (different aircraft) that must be de-duplicated.
 * - AKL→YVR AC40 14:00→07:05: same calendar date across the date line (offset 0).
 * - YVR→SYD AC33 23:40→09:10: arrives two calendar days later (+2).
 * - YYZ→LHR AC848 and YHZ→YYZ AC603 (a real domestic hub leg).
 * - LHR→YUL AC865 daily, for return trips.
 * - YYZ→DEL AC42 00:30 daily, for overnight layovers.
 */
export const FIXTURE_ROUTES: ScheduleRoute[] = [
  route('YUL', 'LHR',
    rec('AC864', '22:10', '10:00', '2026-09-01', '2027-03-31', ALL_DAYS, '333'),
    rec('AC868', '12:00', '23:55', '2026-10-03', '2026-10-03', 'Sat', '77W'),
  ),
  route('YUL', 'ATH',
    rec('AC898', '17:25', '10:35', '2026-10-01', '2026-10-31', 'Mon,Wed,Fri', '788'),
    rec('AC922', '21:30', '14:40', '2026-10-01', '2026-10-31', 'Mon,Wed,Fri', '789'),
    rec('AC898', '17:25', '10:35', '2026-10-05', '2026-10-09', 'Mon,Wed', '789'),
  ),
  route('AKL', 'YVR', rec('AC40', '14:00', '07:05', '2026-12-04', '2027-02-28', 'Mon,Wed,Fri,Sun', '789')),
  route('YVR', 'SYD', rec('AC33', '23:40', '09:10', '2026-09-01', '2027-03-31', ALL_DAYS, '789')),
  route('YYZ', 'LHR', rec('AC848', '18:00', '06:15', '2026-09-01', '2027-03-31', ALL_DAYS, '77W')),
  route('YHZ', 'YYZ', rec('AC603', '14:00', '15:30', '2026-09-01', '2027-03-31', ALL_DAYS, '223')),
  route('LHR', 'YUL', rec('AC865', '12:10', '14:35', '2026-09-01', '2027-03-31', ALL_DAYS, '333')),
  route('YYZ', 'DEL', rec('AC42', '00:30', '23:55', '2026-09-01', '2027-03-31', ALL_DAYS, '77L')),
];
