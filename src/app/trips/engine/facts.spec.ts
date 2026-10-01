import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { SEVILLE_META, SEVILLE_ROUTES } from '../testing/seville-fixture';
import { scheduleFacts, shortAircraftName } from './facts';
import { easterSunday, holidayDisplayName, holidayNote, holidaysIn, holidaysNear, nthWeekday } from './holidays';

describe('scheduleFacts (Seville fixture)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('YUL → LHR on Fri Oct 9: 2 departures, last AC864, A330-300 ×2, next day 2', () => {
    const f = scheduleFacts('YUL', 'LHR', '2026-10-09');
    expect(f.covered).toBe(true);
    expect(f.departures.map(d => d.depLocal)).toEqual(['18:40', '22:10']);
    expect(f.departures.map(d => d.flightNumber)).toEqual(['AC866', 'AC864']);
    expect(f.last?.flightNumber).toBe('AC864');
    expect(f.aircraft).toEqual([{ code: '333', name: 'A330-300', count: 2 }]);
    expect(f.nextDay).toEqual({ dateKey: '2026-10-10', count: 2, covered: true });
    expect(f.holidays.map(h => `${h.region} ${h.name} ${h.dateKey}`)).toContain('CA Thanksgiving 2026-10-12');
    expect(holidayNote('2026-10-09')).toBe('Canadian Thanksgiving weekend (Mon Oct 12). Often busy, check loads.');
  });

  it('a Monday has only AC864', () => {
    const f = scheduleFacts('YUL', 'LHR', '2026-10-12');
    expect(f.departures.map(d => d.flightNumber)).toEqual(['AC864']);
    expect(f.nextDay.count).toBe(2);
  });

  it('outside coverage is unknown, not "no flights"', () => {
    const f = scheduleFacts('YUL', 'LHR', '2027-12-01');
    expect(f.covered).toBe(false);
    expect(f.departures).toEqual([]);
    expect(f.last).toBeNull();
    expect(f.nextDay.covered).toBe(false);
  });

  it('shortens aircraft names', () => {
    expect(shortAircraftName('77W')).toBe('777-300ER');
    expect(shortAircraftName('ZZZ')).toBe('ZZZ');
  });
});

describe('holidays', () => {
  it('computes Easter', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2028)).toBe('2028-04-16');
  });

  it('computes nth and last weekdays', () => {
    expect(nthWeekday(2026, 10, 0, 2)).toBe('2026-10-12'); // Thanksgiving
    expect(nthWeekday(2026, 5, 0, -1)).toBe('2026-05-25'); // Memorial Day
    expect(nthWeekday(2026, 11, 3, 4)).toBe('2026-11-26'); // US Thanksgiving
  });

  it('generates the 2026–2028 calendars from rules', () => {
    const byName = (y: number, region: string, name: string) =>
      holidaysIn(y).find(h => h.region === region && h.name === name)?.dateKey;
    expect(byName(2026, 'CA', 'Thanksgiving')).toBe('2026-10-12');
    expect(byName(2027, 'CA', 'Thanksgiving')).toBe('2027-10-11');
    expect(byName(2028, 'CA', 'Thanksgiving')).toBe('2028-10-09');
    expect(byName(2026, 'CA', 'Victoria Day')).toBe('2026-05-18');
    expect(byName(2027, 'CA', 'Victoria Day')).toBe('2027-05-24');
    expect(byName(2028, 'CA', 'Victoria Day')).toBe('2028-05-22');
    expect(byName(2026, 'CA-QC', 'Journée nationale des patriotes')).toBe('2026-05-18');
    expect(byName(2026, 'CA', 'Good Friday')).toBe('2026-04-03');
    expect(byName(2026, 'CA', 'Easter Monday')).toBe('2026-04-06');
    expect(byName(2026, 'CA', 'Labour Day')).toBe('2026-09-07');
    expect(byName(2026, 'CA', 'Civic Holiday')).toBe('2026-08-03');
    expect(byName(2026, 'CA', 'National Day for Truth and Reconciliation')).toBe('2026-09-30');
    expect(byName(2027, 'CA-ON,BC,AB,SK,NB', 'Family Day')).toBe('2027-02-15');
    expect(byName(2026, 'CA-MB', 'Louis Riel Day')).toBe('2026-02-16');
    expect(byName(2026, 'CA-QC', 'Fête nationale')).toBe('2026-06-24');
    expect(byName(2026, 'US', 'Martin Luther King Jr. Day')).toBe('2026-01-19');
    expect(byName(2026, 'US', 'Thanksgiving')).toBe('2026-11-26');
    expect(byName(2028, 'US', 'Thanksgiving')).toBe('2028-11-23');
    expect(byName(2026, 'US', 'Columbus Day')).toBe('2026-10-12');
    expect(byName(2026, 'US', 'Juneteenth')).toBe('2026-06-19');
    for (const y of [2026, 2027, 2028]) {
      const list = holidaysIn(y);
      expect(list.length).toBe(28);
      expect([...list].map(h => h.dateKey)).toEqual([...list].map(h => h.dateKey).sort());
    }
  });

  it('finds holidays near a date, across the year end', () => {
    expect(holidaysNear('2026-12-30', 3).map(h => h.dateKey)).toEqual(['2027-01-01', '2027-01-01']);
    expect(holidaysNear('2026-10-20', 3)).toEqual([]);
    expect(holidayNote('2026-10-20')).toBeNull();
  });

  it('writes neutral notes, Canadian first', () => {
    expect(holidayNote('2026-11-25')).toBe('US Thanksgiving weekend (Thu Nov 26). Often busy, check loads.');
    expect(holidayNote('2026-12-24')).toBe('Canadian Christmas Day (Fri Dec 25). Often busy, check loads.');
    expect(holidayNote('2026-06-23')).toBe('Fête nationale in QC (Wed Jun 24). Often busy, check loads.');
    for (const k of ['2026-10-09', '2026-11-25', '2026-07-01']) {
      expect(holidayNote(k)).not.toMatch(/%|risk|easy|chance/i);
    }
    expect(holidayDisplayName({ dateKey: '2026-02-16', name: 'Family Day', region: 'CA-ON,BC,AB,SK,NB' }))
      .toBe('Family Day (ON, BC, AB, SK, NB)');
  });
});
