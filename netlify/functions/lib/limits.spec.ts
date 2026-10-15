import { describe, expect, it } from 'vitest';
import { isRec, json } from './http';
import { BUDGET_KEEP_DAYS, budgetKey, dailyLimit, makeBudget, makeLimiter, sweepBudgetKeys } from './limits';

const NOW = Date.parse('2026-10-06T15:00:00Z');
const H = 3_600_000;
const DAY = 24 * H;

describe('makeLimiter', () => {
  it('blocks after max in the window and resets', () => {
    const allow = makeLimiter(2, 1000);
    expect([allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2)]).toEqual([true, true, false, true]);
    expect(allow('a', 1001)).toBe(true);
  });
  it('drops expired windows once the table is large', () => {
    const allow = makeLimiter(1, 10);
    for (let i = 0; i < 5001; i++) allow(`k${i}`, 0);
    expect(allow('fresh', 100)).toBe(true);
    // k0's window ended at 10: it starts a new one instead of counting the old hit.
    expect(allow('k0', 101)).toBe(true);
  });
});

describe('dailyLimit', () => {
  it('parses a whole number >= 0 and falls back for anything else', () => {
    expect([dailyLimit(undefined, 40), dailyLimit('15', 40), dailyLimit('x', 40), dailyLimit('', 40), dailyLimit('  ', 40), dailyLimit('-3', 40), dailyLimit('1.5', 40), dailyLimit('0', 40)])
      .toEqual([40, 15, 40, 40, 40, 40, 40, 0]);
    expect([dailyLimit(undefined, 500), dailyLimit('120', 500), dailyLimit('x', 50)]).toEqual([500, 120, 50]);
  });
});

/** In-memory store with ETag semantics; awaits make concurrent callers interleave. */
const memory = () => {
  const m = new Map<string, { v: string; e: number }>();
  let seq = 0;
  return {
    m,
    getWithMetadata: async (k: string) => { await Promise.resolve(); const x = m.get(k); return x ? { data: x.v, etag: String(x.e) } : null; },
    set: async (k: string, v: string, o: { onlyIfNew?: true; onlyIfMatch?: string }) => {
      await Promise.resolve();
      const x = m.get(k);
      if (o.onlyIfNew && x) return { modified: false };
      if (o.onlyIfMatch !== undefined && (!x || String(x.e) !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { v, e: ++seq });
      return { modified: true };
    },
    list: async () => ({ blobs: [...m.keys()].map(key => ({ key })) }),
    delete: async (k: string) => { m.delete(k); },
  };
};

describe('daily budget', () => {
  it('keys by UTC date', () => expect(budgetKey(NOW)).toBe('calls-2026-10-06'));
  it('spends up to the limit, then refuses; a new UTC day starts again', async () => {
    const spend = makeBudget(memory(), 3);
    expect([await spend(NOW), await spend(NOW), await spend(NOW), await spend(NOW)]).toEqual([true, true, true, false]);
    expect(await spend(NOW + DAY)).toBe(true);
  });
  it('can spend several calls at once, all or nothing', async () => {
    const spend = makeBudget(memory(), 3);
    expect([await spend(NOW, 2), await spend(NOW, 2), await spend(NOW, 1)]).toEqual([true, false, true]);
  });
  it('treats a corrupt counter as zero', async () => {
    const store = memory();
    await store.set(budgetKey(NOW), 'junk', { onlyIfNew: true });
    expect(await makeBudget(store, 1)(NOW)).toBe(true);
  });
  it('is race-free: concurrent callers never exceed the limit and the counter matches the grants', async () => {
    const store = memory();
    const spend = makeBudget(store, 3);
    const results = await Promise.all([spend(NOW), spend(NOW), spend(NOW), spend(NOW), spend(NOW)]);
    const granted = results.filter(Boolean).length;
    expect(granted).toBeLessThanOrEqual(3);
    expect(Number(store.m.get(budgetKey(NOW))!.v)).toBe(granted);
  });
  it('fails closed when the store throws', async () => {
    const spend = makeBudget({ getWithMetadata: async () => { throw new Error('down'); }, set: async () => ({ modified: true }) }, 10);
    expect(await spend(NOW)).toBe(false);
  });
  it('fails closed when every conditional write loses the race', async () => {
    const spend = makeBudget({ getWithMetadata: async () => null, set: async () => ({ modified: false }) }, 10);
    expect(await spend(NOW)).toBe(false);
  });
});

describe('sweepBudgetKeys', () => {
  it('removes counters older than 7 days and leaves recent days and other keys', async () => {
    const store = memory();
    const day = (ago: number) => budgetKey(NOW - ago * DAY);
    for (const k of [day(0), day(3), day(BUDGET_KEEP_DAYS - 1), day(BUDGET_KEEP_DAYS + 1), day(30), 'calls-garbage', 'other']) await store.set(k, '1', { onlyIfNew: true });
    expect(await sweepBudgetKeys(store, NOW)).toBe(2);
    expect([...store.m.keys()].sort()).toEqual([day(0), day(3), day(BUDGET_KEEP_DAYS - 1), 'calls-garbage', 'other'].sort());
  });
  it('keeps going when a delete fails', async () => {
    const store = memory();
    for (const n of [20, 21]) await store.set(budgetKey(NOW - n * DAY), '1', { onlyIfNew: true });
    let first = true;
    const del = store.delete;
    store.delete = async k => { if (first) { first = false; throw new Error('x'); } return del(k); };
    expect(await sweepBudgetKeys(store, NOW)).toBe(1);
  });
});

describe('http helpers', () => {
  it('isRec accepts plain objects only', () => {
    expect([isRec({}), isRec([]), isRec(null), isRec('x'), isRec(undefined)]).toEqual([true, false, false, false, false]);
  });
  it('json defaults to no-store and lets extra headers win', async () => {
    const a = json({ a: 1 }, 201);
    expect(a.status).toBe(201);
    expect(a.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(a.headers.get('Cache-Control')).toBe('no-store');
    expect(await a.json()).toEqual({ a: 1 });
    expect(json({}, 200, { 'Cache-Control': 'public, max-age=60', 'X-A': 'b' }).headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});
