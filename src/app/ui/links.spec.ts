import { describe, it, expect } from 'vitest';
import type { Itinerary } from '../utils/connections';
import { calendarPath, destPath, flightPath, flightSlug, matchSlug } from './links';

const leg = (fn: string | null, estimated = false) => ({ flightNumber: fn, estimated });
const direct = { legs: [leg('AC812')] } as unknown as Itinerary;
const conn = { legs: [leg('AC300'), leg('AC1')] } as unknown as Itinerary;
const est = { legs: [leg(null, true), leg('AC1')] } as unknown as Itinerary;

describe('ui/links', () => {
  it('builds paths', () => {
    expect(destPath('lis')).toEqual(['/to', 'LIS']);
    expect(flightPath('LIS', '2026-10-01')).toEqual(['/flight', 'LIS', '2026-10-01']);
    expect(flightPath('LIS', '2026-10-01', direct)).toEqual(['/flight', 'LIS', '2026-10-01', 'AC812']);
    expect(calendarPath()).toEqual(['/calendar']);
    expect(calendarPath('cun')).toEqual(['/calendar', 'CUN']);
  });

  it('slugs itineraries', () => {
    expect(flightSlug(direct)).toBe('AC812');
    expect(flightSlug(conn)).toBe('AC300+AC1');
    expect(flightSlug(est)).toBe('EST+AC1');
  });

  it('matches slugs case-insensitively, or returns null', () => {
    expect(matchSlug('ac300+ac1', [direct, conn])).toBe(conn);
    expect(matchSlug('AC812', [direct, conn])).toBe(direct);
    expect(matchSlug('AC9', [direct])).toBeNull();
    expect(matchSlug(null, [direct])).toBeNull();
  });
});
