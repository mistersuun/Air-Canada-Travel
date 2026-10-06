import { describe, expect, it } from 'vitest';
import type { FlightRef } from '../../trips/model';
import { refArrUtc, refDepUtc } from '../../trips/engine/legs';
import { inAirProgress } from './in-air';

/** Overnight, across time zones: YUL 17:55 (UTC-4) to MAD 07:20 next day (UTC+2). */
const REF: FlightRef = {
  flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', depLocal: '17:55',
  arrLocal: '07:20', arrDateKey: '2026-10-09', aircraft: '333',
};
const DEP = refDepUtc(REF);
const ARR = refArrUtc(REF);
const MIN = 60_000;

describe('inAirProgress', () => {
  it('uses the real elapsed duration across zones and midnight', () => {
    expect((ARR - DEP) / MIN).toBe(7 * 60 + 25);
  });
  it('is null before departure', () => {
    expect(inAirProgress(REF, DEP - MIN)).toBeNull();
  });
  it('starts at 0 on departure with the full distance', () => {
    const a = inAirProgress(REF, DEP)!;
    expect(a.progress).toBe(0);
    expect(a.kmLeft).toBeGreaterThan(5000);
  });
  it('is half way at the middle with about half the distance left', () => {
    const full = inAirProgress(REF, DEP)!.kmLeft;
    const mid = inAirProgress(REF, (DEP + ARR) / 2)!;
    expect(mid.progress).toBeCloseTo(0.5, 5);
    expect(Math.abs(mid.kmLeft - full / 2)).toBeLessThanOrEqual(10);
  });
  it('is null from arrival on', () => {
    expect(inAirProgress(REF, ARR)).toBeNull();
    expect(inAirProgress(REF, ARR + 60 * MIN)).toBeNull();
  });
  it('is null for unknown airports', () => {
    expect(inAirProgress({ ...REF, origin: 'ZZZ' }, (DEP + ARR) / 2)).toBeNull();
  });
  it('is null when the arrival is not after departure', () => {
    expect(inAirProgress({ ...REF, arrDateKey: '2026-10-08', arrLocal: '00:10' }, DEP + MIN)).toBeNull();
  });
});
