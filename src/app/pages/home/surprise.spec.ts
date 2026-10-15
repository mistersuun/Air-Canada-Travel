import { describe, expect, it } from 'vitest';
import type { RouteEntry } from '../../utils/routes';
import type { WeekendOption } from '../weekend/weekend-model';
import { FLICK_COUNT, dareText, flickSequence, surprisePick, surpriseCandidates, weekendEntries } from './surprise';

function entry(code: string, n: number, type = 'City', dep = 1000): RouteEntry {
  return {
    destination: { code, city: code, type } as RouteEntry['destination'],
    isDirect: n > 0, weekDays: [], daysFlying: n, isFavourite: false,
    flights: Array.from({ length: n }, () => ({ depUtc: dep }) as RouteEntry['flights'][number]),
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

  it('with several candidates all recent, still avoids the last pick', () => {
    const two = [entry('LIS', 2), entry('AMS', 2)];
    const rng = seeded(9);
    for (let i = 0; i < 100; i++) expect(surprisePick(two, none, ['LIS', 'AMS'], rng)?.destination.code).toBe('LIS');
  });

  it('skips entries whose flights have all departed, and weights by upcoming ones', () => {
    const gone = entry('OLD', 5, 'City', 500);
    const now = entry('NEW', 1, 'City', 2000);
    const rng = seeded(4);
    for (let i = 0; i < 100; i++) expect(surprisePick([gone, now], none, [], rng, 1000)?.destination.code).toBe('NEW');
    const mixed = { ...now, flights: [...gone.flights, ...now.flights] };
    expect(surprisePick([mixed], none, [], rng, 1000)?.destination.code).toBe('NEW');
  });

  it('falls back to all flights when everything has departed', () => {
    expect(surprisePick([entry('OLD', 2, 'City', 500)], none, [], () => 0.1, 1000)?.destination.code).toBe('OLD');
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

describe('spin length', () => {
  it('sweeps 4 to 6 candidates', () => {
    expect(FLICK_COUNT).toBeGreaterThanOrEqual(4);
    expect(FLICK_COUNT).toBeLessThanOrEqual(6);
  });
});

describe('this weekend', () => {
  const opt = (code: string, tries: number, hoursThere = 40) =>
    ({ code, tries: new Array(tries).fill(null), hoursThere, out: [], retKey: '', directTries: tries }) as unknown as WeekendOption;
  const list = [entry('LIS', 3), entry('CUN', 3), entry('NRT', 3)];

  it('keeps only the destinations the weekend finder found', () => {
    expect(weekendEntries(list, [opt('LIS', 6), opt('NRT', 1)]).map(e => e.destination.code)).toEqual(['LIS', 'NRT']);
    expect(weekendEntries(list, [])).toEqual([]);
  });
  it('words the dare as facts', () => {
    expect(dareText(list[0], 0, '24h', opt('LIS', 6))).toBe(`Dare you: ${list[0].destination.city} this weekend? ~40h there, 6 tries home`);
    expect(dareText(list[0], 0, '24h', opt('LIS', 1))).toContain('1 try home');
    expect(dareText(entry('LIS', 0), 0, '24h', null)).toBe('Dare you: LIS?');
  });
});
