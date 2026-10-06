import { describe, it, expect } from 'vitest';
import { greatCircleKm, formatKm, nearestTo } from './geo';

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

describe('nearestTo', () => {
  const places = [
    { code: 'YYZ', lat: 43.68, lng: -79.62 },
    { code: 'YUL', lat: 45.47, lng: -73.74 },
    { code: 'YVR', lat: 49.2, lng: -123.18 },
  ];
  it('picks the closest by great-circle distance', () => {
    const r = nearestTo({ lat: 45.5, lng: -73.6 }, places)!;
    expect(r.place.code).toBe('YUL');
    expect(r.km).toBeLessThan(15);
    expect(nearestTo({ lat: 49.28, lng: -123.12 }, places)!.place.code).toBe('YVR');
  });
  it('is null with no places', () => {
    expect(nearestTo({ lat: 0, lng: 0 }, [])).toBeNull();
  });
});
