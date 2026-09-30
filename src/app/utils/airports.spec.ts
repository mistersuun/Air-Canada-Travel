import { afterEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { rec, route } from '../data/testing/schedule-fixtures';
import { airportName, airportTz, findDestination, findHub, getOrigins, hasKnownTz, isHub } from './airports';

afterEach(() => resetScheduleSource());

describe('airports', () => {
  it('resolves zones for hubs, destinations and extra airports', () => {
    expect(airportTz('YVR')).toBe('America/Vancouver');
    expect(airportTz('LHR')).toBe('Europe/London');
    expect(airportTz('YTZ')).toBe('America/Toronto');
    expect(airportTz('ZZZ')).toBe('UTC');
    expect(hasKnownTz('YTZ')).toBe(true);
    expect(hasKnownTz('ZZZ')).toBe(false);
  });

  it('names airports', () => {
    expect(airportName('YUL')).toBe('Montreal');
    expect(airportName('LIS')).toBe('Lisbon');
    expect(airportName('YTZ')).toBe('Toronto Billy Bishop');
    expect(airportName('ZZZ')).toBe('ZZZ');
    expect(findDestination('LIS')?.country).toBe('Portugal');
    expect(findDestination(null)).toBeNull();
    expect(findHub('YYC')?.name).toBe('Calgary');
    expect(findHub('LIS')).toBeNull();
    expect(isHub('YHZ')).toBe(true);
  });

  it('derives origins from the schedules, hubs first, with names (critique 18)', () => {
    setScheduleSource([
      route('YTZ', 'BOS', rec('AC1', '09:00', '10:30', '2026-10-01', '2026-10-31')),
      route('YUL', 'BOS', rec('AC2', '09:00', '10:30', '2026-10-01', '2026-10-31')),
      route('YYZ', 'BOS', rec('AC3', '09:00', '10:30', '2026-10-01', '2026-10-31')),
      route('YOW', 'BOS'),
    ]);
    expect(getOrigins('BOS')).toEqual([
      { code: 'YYZ', name: 'Toronto', isHub: true },
      { code: 'YUL', name: 'Montreal', isHub: true },
      { code: 'YTZ', name: 'Toronto Billy Bishop', isHub: false },
    ]);
    expect(getOrigins('ZZZ')).toEqual([]);
  });
});
