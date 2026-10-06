import { describe, expect, it } from 'vitest';
import { toUtcMs } from '../../utils/time';
import {
  FactHub, FactPoint, dailyFact, dayNumber, daylightFact, daylightHours, distanceRankFact, extremeFact, timeDifferenceFact,
} from './fun-facts';

const YYZ: FactHub = { code: 'YYZ', lat: 43.68, lng: -79.62, tz: 'America/Toronto' };
const pt = (code: string, lat: number, lng: number, tz: string): FactPoint => ({ code, lat, lng, tz });
const LHR = pt('LHR', 51.47, -0.45, 'Europe/London');
const YVR = pt('YVR', 49.2, -123.18, 'America/Vancouver');
const MIA = pt('MIA', 25.8, -80.29, 'America/New_York');
const YFB = pt('YFB', 63.75, -68.56, 'America/Toronto');
const NRT = pt('NRT', 35.77, 140.39, 'Asia/Tokyo');
const SET = [LHR, YVR, MIA, YFB, NRT];
const JUN = Date.UTC(2026, 5, 21, 12);
const DEC = Date.UTC(2026, 11, 21, 12);

describe('timeDifferenceFact', () => {
  it('says ahead, behind and same', () => {
    expect(timeDifferenceFact(LHR, YYZ, 'Toronto', JUN)).toBe('5 hours ahead of Toronto');
    expect(timeDifferenceFact(YVR, YYZ, 'Toronto', JUN)).toBe('3 hours behind Toronto');
    expect(timeDifferenceFact(MIA, YYZ, 'Toronto', JUN)).toBe('Same time as Toronto');
  });
  it('handles half hours and singular', () => {
    expect(timeDifferenceFact(pt('DEL', 28.5, 77.1, 'Asia/Kolkata'), YYZ, 'Toronto', JUN)).toBe('9h 30m ahead of Toronto');
    expect(timeDifferenceFact(pt('X', 0, 0, 'America/Chicago'), YYZ, 'Toronto', JUN)).toBe('1 hour behind Toronto');
  });
  it('is null for the hub itself', () => {
    expect(timeDifferenceFact({ ...YYZ }, YYZ, 'Toronto', JUN)).toBeNull();
  });
});

describe('distanceRankFact', () => {
  it('ranks by distance from the hub', () => {
    expect(distanceRankFact(NRT, YYZ, SET)).toBe('The longest nonstop from YYZ');
    expect(distanceRankFact(MIA, YYZ, SET)).toBe('The shortest nonstop from YYZ');
    expect(distanceRankFact(LHR, YYZ, SET)).toBe('2nd-longest nonstop from YYZ');
    expect(distanceRankFact(YVR, YYZ, SET)).toBe('3rd-longest nonstop from YYZ');
  });
  it('uses 11th-13th suffixes', () => {
    const many = Array.from({ length: 15 }, (_, i) => pt(`D${String(i).padStart(2, '0')}`, 10, -60 - i * 5, 'UTC'));
    const facts = many.map(p => distanceRankFact(p, YYZ, many));
    expect(facts.some(f => f?.startsWith('11th-'))).toBe(true);
    expect(facts.some(f => f?.startsWith('12th-'))).toBe(true);
    expect(facts.some(f => f?.startsWith('13th-'))).toBe(true);
  });
  it('counts the destination even when the list omits it, and needs 3 airports', () => {
    expect(distanceRankFact(NRT, YYZ, [LHR, MIA])).toBe('The longest nonstop from YYZ');
    expect(distanceRankFact(NRT, YYZ, [LHR])).toBeNull();
  });
});

describe('daylight', () => {
  it('is about 12 hours at the equator all year', () => {
    expect(daylightHours(0, JUN)).toBeCloseTo(12.1, 0);
    expect(daylightHours(0, DEC)).toBeCloseTo(12.1, 0);
  });
  it('matches known values at 43.7N: ~15.3h in June, ~9.0h in December', () => {
    expect(daylightHours(43.68, JUN)).toBeGreaterThan(15.1);
    expect(daylightHours(43.68, JUN)).toBeLessThan(15.6);
    expect(daylightHours(43.68, DEC)).toBeGreaterThan(8.7);
    expect(daylightHours(43.68, DEC)).toBeLessThan(9.3);
  });
  it('flips with the hemisphere', () => {
    expect(daylightHours(-34, JUN)!).toBeLessThan(11);
    expect(daylightHours(-34, DEC)!).toBeGreaterThan(14);
  });
  it('is null in polar day and night', () => {
    expect(daylightHours(80, JUN)).toBeNull();
    expect(daylightHours(80, DEC)).toBeNull();
    expect(daylightFact(pt('X', 80, 0, 'UTC'), JUN)).toBeNull();
  });
  it('words the fact', () => {
    expect(daylightFact(pt('X', 0, 0, 'UTC'), JUN)).toBe('About 12 hours of daylight today');
  });
});

describe('extremeFact', () => {
  it('finds the northernmost and southernmost', () => {
    expect(extremeFact(YFB, YYZ, SET)).toBe('The northernmost destination from YYZ');
    expect(extremeFact(MIA, YYZ, SET)).toBe('The southernmost destination from YYZ');
    expect(extremeFact(LHR, YYZ, SET)).toBeNull();
  });
  it('needs 3 airports', () => {
    expect(extremeFact(YFB, YYZ, [MIA])).toBeNull();
  });
});

describe('dailyFact', () => {
  it('is stable within a day and varies across days', () => {
    const a = dailyFact(LHR, YYZ, 'Toronto', SET, JUN);
    expect(dailyFact(LHR, YYZ, 'Toronto', SET, JUN + 3 * 3_600_000)).toBe(a);
    const seen = new Set<string | null>();
    for (let i = 0; i < 12; i++) seen.add(dailyFact(LHR, YYZ, 'Toronto', SET, JUN + i * 86_400_000));
    expect(seen.size).toBeGreaterThan(1);
    expect(a).toBeTruthy();
  });
  it('changes at the hub-local midnight', () => {
    const before = toUtcMs('2026-06-21', '23:59', 'America/Toronto');
    const after = toUtcMs('2026-06-22', '00:01', 'America/Toronto');
    expect(dayNumber(after, 'America/Toronto') - dayNumber(before, 'America/Toronto')).toBe(1);
    expect(dayNumber(before, 'America/Toronto')).toBe(dayNumber(toUtcMs('2026-06-21', '00:01', 'America/Toronto'), 'America/Toronto'));
  });
  it('returns null when nothing applies', () => {
    expect(dailyFact({ ...YYZ }, YYZ, 'Toronto', [], DEC)).toBe(daylightFact(YYZ, DEC));
    expect(dailyFact(pt('X', 80, 0, 'UTC'), { ...YYZ, code: 'X' }, 'X', [], DEC)).toBeNull();
  });
});
