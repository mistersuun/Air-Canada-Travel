import { afterEach, describe, expect, it, vi } from 'vitest';
import { success, tap, warn } from './haptics';
import { makeParticles, particleAt } from './celebrate';
import { clearedMessage } from '../trips/cleared';

afterEach(() => vi.unstubAllGlobals());

describe('haptics', () => {
  it('vibrates with the documented patterns', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    tap(); success(); warn();
    expect(vibrate.mock.calls.map(c => c[0])).toEqual([8, [12, 60, 18], [30, 40, 30]]);
  });
  it('is silent under reduced motion and without the API', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    tap();
    expect(vibrate).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', {});
    expect(() => success()).not.toThrow();
  });
});

describe('confetti particles', () => {
  it('makes n particles that rise first then fall', () => {
    const ps = makeParticles(10, () => 0.5);
    expect(ps).toHaveLength(10);
    expect(particleAt(ps[0], 0.1).y).toBeLessThan(0);
    expect(particleAt(ps[0], 0.7).y).toBeGreaterThan(particleAt(ps[0], 0.3).y);
  });
});

describe('clearedMessage', () => {
  it('reads Cleared · route · distance', () => {
    expect(clearedMessage('YUL', 'LHR')).toMatch(/^Cleared · YUL → LHR · [\d,]+ km$/);
  });
  it('says some of you when only some boarded', () => {
    expect(clearedMessage('YUL', 'ZZZ', true)).toBe('Cleared · some of you · YUL → ZZZ');
  });
  it('leaves the distance out for unknown airports', () => {
    expect(clearedMessage('YUL', 'ZZZ')).toBe('Cleared · YUL → ZZZ');
  });
});
