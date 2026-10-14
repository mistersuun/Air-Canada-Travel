import { afterEach, describe, expect, it } from 'vitest';
import type { BoardedFlight } from './logbook';
import { isTransatlantic, isTranspacific, milestones } from './milestones';
import { canStoreSeen, loadSeen, saveSeen, unseen } from './seen';

let n = 0;
function fl(origin: string, dest: string, dateKey = '2026-10-08', over: Partial<BoardedFlight> = {}): BoardedFlight {
  n++;
  return {
    key: `AC${n}|${origin}|${dateKey}`, flightNumber: `AC${n}`, origin, dest, dateKey,
    depLocal: '10:00', arrLocal: '14:00', arrDateKey: dateKey, aircraft: '333', km: 1000, ...over,
  };
}
const ids = (f: BoardedFlight[]) => milestones(f).map(m => m.id);

describe('ocean crossings', () => {
  it('detects transatlantic and transpacific, in both directions', () => {
    expect(isTransatlantic('YYZ', 'LIS')).toBe(true);
    expect(isTransatlantic('LIS', 'YUL')).toBe(true);
    expect(isTransatlantic('YYZ', 'YVR')).toBe(false);
    expect(isTransatlantic('YVR', 'HND')).toBe(false);
    expect(isTranspacific('YVR', 'HND')).toBe(true);
    expect(isTranspacific('SYD', 'YVR')).toBe(true);
    expect(isTranspacific('YYZ', 'LIS')).toBe(false);
    expect(isTranspacific('ZZZ', 'LIS')).toBe(false);
  });
});

describe('milestones', () => {
  it('is empty without flights or achievements', () => {
    expect(milestones([])).toEqual([]);
    expect(ids([fl('YYZ', 'YUL')])).toEqual([]);
  });
  it('earns first crossings with the date of that flight (red-eye is a Mark, not a milestone)', () => {
    const f = [
      fl('YYZ', 'LIS', '2026-03-01', { depLocal: '22:30', arrDateKey: '2026-03-02' }),
      fl('YVR', 'HND', '2026-05-01'),
    ];
    const m = milestones(f);
    expect(m.map(x => [x.id, x.dateKey])).toEqual([
      ['transatlantic', '2026-03-01'], ['transpacific', '2026-05-01'],
    ]);
    expect(m[0].flightKey).toBe(f[0].key);
  });
  it('counts km thresholds cumulatively and dates them by the crossing flight', () => {
    const f = [fl('YYZ', 'YUL', '2026-01-01', { km: 6000 }), fl('YUL', 'YYZ', '2026-02-01', { km: 6000 })];
    expect(milestones(f).map(x => [x.id, x.dateKey])).toEqual([['km10k', '2026-02-01']]);
    expect(ids([...f, fl('YYZ', 'YUL', '2026-03-01', { km: 90_000 })])).toEqual(['km10k', 'km50k', 'km100k']);
  });
  it('counts distinct airports and countries', () => {
    const codes = ['YUL', 'YOW', 'YHZ', 'YQB', 'YVR', 'YYC', 'YEG', 'YWG', 'LIS', 'CDG', 'LHR', 'FRA', 'MEX'];
    const f = codes.map((c, i) => fl('YYZ', c, `2026-01-${String(i + 1).padStart(2, '0')}`, { km: 10 }));
    const m = milestones(f);
    expect(m.find(x => x.id === 'airports10')).toBeDefined();
    expect(m.find(x => x.id === 'countries5')).toBeDefined();
    expect(m.find(x => x.id === 'airports25')).toBeUndefined();
  });
});

describe('same-day ordering', () => {
  it('breaks date ties by departure time', () => {
    const a = fl('YYZ', 'YUL', '2026-01-01', { km: 6000, depLocal: '18:00' });
    const b = fl('YUL', 'YYZ', '2026-01-01', { km: 6000, depLocal: '08:00' });
    expect(milestones([a, b])[0].flightKey).toBe(a.key);
  });
});

describe('seen tracking', () => {
  afterEach(() => localStorage.clear());
  it('round-trips and merges ids', () => {
    expect(loadSeen()).toBeNull();
    saveSeen(['a']);
    saveSeen(['b', 'a']);
    expect([...loadSeen()!].sort()).toEqual(['a', 'b']);
  });
  it('does not persist an empty list, and blocked storage stays calm', () => {
    saveSeen([]);
    expect(loadSeen()).toBeNull();
    expect(unseen(['a'], null, false).size).toBe(0);
    expect(canStoreSeen()).toBe(true);
  });
  it('animates only unseen ids; a first visit stays calm unless there is one', () => {
    expect([...unseen(['a', 'b'], new Set(['a']), true)]).toEqual(['b']);
    expect(unseen(['a', 'b'], null, true).size).toBe(0);
    expect([...unseen(['a'], null, true)]).toEqual(['a']);
  });
});
