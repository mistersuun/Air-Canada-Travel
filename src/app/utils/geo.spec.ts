import { describe, it, expect } from 'vitest';
import { greatCircleKm, formatKm } from './geo';

const YUL = { lat: 45.47, lng: -73.74 };
const NRT = { lat: 35.77, lng: 140.39 };
const LIS = { lat: 38.77, lng: -9.13 };

describe('geo', () => {
  it('is zero for the same point and symmetric', () => {
    expect(greatCircleKm(YUL, YUL)).toBe(0);
    expect(greatCircleKm(YUL, LIS)).toBeCloseTo(greatCircleKm(LIS, YUL), 6);
  });

  it('matches known great-circle distances within 1%', () => {
    expect(greatCircleKm(YUL, LIS)).toBeGreaterThan(5200);
    expect(greatCircleKm(YUL, LIS)).toBeLessThan(5300);
    expect(Math.abs(greatCircleKm(YUL, NRT) - 10354) / 10354).toBeLessThan(0.01);
  });

  it('handles antipodes without NaN', () => {
    const d = greatCircleKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(d).toBeCloseTo(Math.PI * 6371, 0);
  });

  it('formats kilometres with grouping', () => {
    expect(formatKm(10354.4)).toBe('10,354 km');
    expect(formatKm(409)).toBe('409 km');
  });
});
