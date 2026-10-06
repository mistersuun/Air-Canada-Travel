import { describe, expect, it } from 'vitest';
import type { RouteEntry } from '../../utils/routes';
import { flickSequence, surprisePick, surpriseCandidates } from './surprise';

function entry(code: string, n: number, type = 'City'): RouteEntry {
  return {
    destination: { code, city: code, type } as RouteEntry['destination'],
    isDirect: n > 0, weekDays: [], daysFlying: n, isFavourite: false,
    flights: Array.from({ length: n }, () => ({}) as RouteEntry['flights'][number]),
  };
}

/** mulberry32 */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const none = { styles: [] as ('Sun' | 'City' | 'Adventure')[] };

describe('surprisePick', () => {
  const list = [entry('LIS', 6), entry('CUN', 3, 'Sun'), entry('NRT', 0), entry('AMS', 7)];

  it('returns null for empty input or when nothing has flights', () => {
    expect(surprisePick([], none, [], Math.random)).toBeNull();
    expect(surprisePick([entry('NRT', 0)], none, [], Math.random)).toBeNull();
  });

  it('never picks a destination without flights', () => {
    const rng = seeded(1);
    for (let i = 0; i < 300; i++) expect(surprisePick(list, none, [], rng)?.destination.code).not.toBe('NRT');
  });

  it('only picks from the entries it is given (the filtered list)', () => {
    const filtered = list.filter(e => e.destination.type === 'Sun');
    const rng = seeded(2);
    for (let i = 0; i < 50; i++) expect(surprisePick(filtered, none, [], rng)?.destination.code).toBe('CUN');
  });

  it('excludes recent picks', () => {
    const rng = seeded(3);
    for (let i = 0; i < 200; i++) expect(['LIS', 'AMS']).not.toContain(surprisePick(list, none, ['LIS', 'AMS'], rng)?.destination.code);
  });

  it('falls back to everything when all are recent', () => {
    expect(surprisePick([entry('LIS', 2)], none, ['LIS'], () => 0.5)?.destination.code).toBe('LIS');
  });

  it('is deterministic with a seeded rng', () => {
    const run = (s: number) => { const r = seeded(s); return Array.from({ length: 10 }, () => surprisePick(list, none, [], r)?.destination.code); };
    expect(run(42)).toEqual(run(42));
  });

  it('weights by departures and nudges by style', () => {
    const count = (styles: ('Sun' | 'City' | 'Adventure')[]) => {
      const r = seeded(7); let sun = 0;
      for (let i = 0; i < 4000; i++) if (surprisePick([entry('A', 4, 'Sun'), entry('B', 4)], { styles }, [], r)?.destination.code === 'A') sun++;
      return sun;
    };
    expect(count([])).toBeGreaterThan(1800);
    expect(count([])).toBeLessThan(2200);
    expect(count(['Sun'])).toBeGreaterThan(2250);
  });
});

describe('flickSequence', () => {
  it('ends on the pick, has distinct codes and skips flightless entries', () => {
    const list = [entry('A', 1), entry('B', 2), entry('C', 1), entry('D', 0), entry('E', 3)];
    const seq = flickSequence(list, 'E', 7, seeded(5));
    expect(seq[seq.length - 1]).toBe('E');
    expect(new Set(seq).size).toBe(seq.length);
    expect(seq).not.toContain('D');
    expect(surpriseCandidates(list)).toHaveLength(4);
  });
});
