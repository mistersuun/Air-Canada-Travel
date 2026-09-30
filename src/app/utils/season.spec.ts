import { afterEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { rec, route } from '../data/testing/schedule-fixtures';
import { routeSeason } from './season';

afterEach(() => resetScheduleSource());

const YEAR = { coverageFrom: '2026-09-29', coverageTo: '2027-09-26' };

describe('routeSeason', () => {
  it('is null for a route that flies every month (PUJ was labelled Oct – Apr)', () => {
    setScheduleSource([route('YYZ', 'PUJ', rec('AC1', '08:00', '12:00', '2026-09-29', '2027-09-26', 'Sat'))], YEAR);
    expect(routeSeason('YYZ', 'PUJ')).toBeNull();
  });

  it('wraps a winter season around December', () => {
    setScheduleSource([route('YWG', 'CUN',
      rec('AC1', '08:00', '12:00', '2026-11-01', '2027-01-31', 'Sun'),
      rec('AC1', '08:00', '12:00', '2027-02-01', '2027-04-22', 'Sun'),
    )], YEAR);
    expect(routeSeason('YWG', 'CUN')).toBe('Nov – Apr');
  });

  it('lists separate runs and single months', () => {
    setScheduleSource([route('YUL', 'X',
      rec('AC1', '08:00', '12:00', '2026-12-15', '2027-01-10'),
      rec('AC2', '08:00', '12:00', '2027-06-01', '2027-08-31'),
      rec('AC3', '08:00', '12:00', '2027-04-10', '2027-04-12'),
    )], YEAR);
    expect(routeSeason('YUL', 'X')).toBe('Apr, Jun – Aug, Dec – Jan');
  });

  it('ignores a month whose only dates never match the weekdays', () => {
    // 2027-03-01..03-03 is Mon–Wed: a Sunday-only row does not fly in March.
    setScheduleSource([route('YUL', 'X',
      rec('AC1', '08:00', '12:00', '2027-01-01', '2027-03-03', 'Sun'),
    )], YEAR);
    expect(routeSeason('YUL', 'X')).toBe('Jan – Feb');
  });

  it('describes only the published window when it is shorter than a year', () => {
    setScheduleSource([route('YUL', 'X',
      rec('AC1', '08:00', '12:00', '2026-12-01', '2027-02-28'),
      rec('AC2', '08:00', '12:00', '2026-10-01', '2027-03-31'),
    )], { coverageFrom: '2026-10-01', coverageTo: '2027-03-31' });
    expect(routeSeason('YUL', 'X')).toBeNull(); // flies every published month
    setScheduleSource([route('YUL', 'X', rec('AC1', '08:00', '12:00', '2026-12-01', '2027-02-28'))],
      { coverageFrom: '2026-10-01', coverageTo: '2027-03-31' });
    expect(routeSeason('YUL', 'X')).toBe('Dec – Feb');
  });

  it('is null for a route with no flights', () => {
    setScheduleSource([], YEAR);
    expect(routeSeason('YUL', 'ZZZ')).toBeNull();
  });
});
