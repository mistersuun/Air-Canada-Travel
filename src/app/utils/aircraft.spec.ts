import { afterEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { rec, route } from '../data/testing/schedule-fixtures';
import { WIDEBODY, aircraftName, aircraftCompact, aircraftSeats, aircraftWithSeats, isWidebody, seatsLabel, widebodyCodes } from './aircraft';

afterEach(() => resetScheduleSource());

describe('aircraft', () => {
  it('recognises widebody families', () => {
    for (const c of ['77W', '77L', '788', '789', '333', '359']) expect(isWidebody(c)).toBe(true);
    for (const c of ['223', '320', '32Q', '7M8', 'CR9', 'DH4', 'E75', '', null]) expect(isWidebody(c)).toBe(false);
  });

  it('derives the widebody list from the data', () => {
    setScheduleSource([route('YUL', 'LHR',
      rec('AC1', '10:00', '22:00', '2026-10-01', '2026-10-31', undefined, '77L'),
      rec('AC2', '11:00', '23:00', '2026-10-01', '2026-10-31', undefined, '223'),
      rec('AC3', '12:00', '23:30', '2026-10-01', '2026-10-31', undefined, '333'))]);
    expect(widebodyCodes()).toEqual(['333', '77L']);
    expect(WIDEBODY.every(isWidebody)).toBe(true);
  });

  it('names equipment', () => {
    expect(aircraftName('789')).toBe('Boeing 787-9');
    expect(aircraftName('XYZ')).toBe('XYZ');
    expect(aircraftName(null)).toBe('');
  });

  it('gives typical seat counts for known types only', () => {
    expect(aircraftSeats('789')).toBe(298);
    expect(aircraftSeats('223')).toBe(137);
    expect(aircraftSeats('32Q')).toBe(182);
    expect(aircraftSeats('XYZ')).toBeNull();
    expect(aircraftSeats(null)).toBeNull();
    expect(seatsLabel('77W')).toBe('about 400 seats');
    expect(seatsLabel('XYZ')).toBe('');
  });

  it('joins name and seats', () => {
    expect(aircraftWithSeats('789')).toBe('787-9 · about 298 seats');
    expect(aircraftWithSeats('32Q')).toBe('A321XLR · about 182 seats');
    expect(aircraftCompact('223')).toBe('A220-300 · 137 seats');
    expect(aircraftCompact('XYZ')).toBe('XYZ');
    expect(aircraftWithSeats(undefined)).toBe('');
  });
});
