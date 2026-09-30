import { describe, it, expect } from 'vitest';
import { MAX_QUERY_LENGTH, parseUrlState, serializeUrlState } from './url-state';

describe('parseUrlState', () => {
  it('reads every field', () => {
    expect(parseUrlState('?from=YYZ&week=2026-10-05&day=2026-10-07&region=Europe&dest=LHR&q=lis')).toEqual({
      from: 'YYZ', week: '2026-10-05', day: '2026-10-07', region: 'Europe', dest: 'LHR', q: 'lis',
    });
  });

  it('works without the leading ?', () => {
    expect(parseUrlState('from=YVR')).toEqual({ from: 'YVR' });
  });

  it('ignores invalid values field by field', () => {
    expect(parseUrlState('?from=XXX&week=soon&day=2026-02-30&region=Mars&dest=ZZZ&q=%20%20')).toEqual({});
  });

  it('upper-cases codes', () => {
    expect(parseUrlState('?from=yyz&dest=lhr')).toEqual({ from: 'YYZ', dest: 'LHR' });
    // Palm Beach's old code in saved links opens its current code.
    expect(parseUrlState('?from=ytz&dest=pbi')).toEqual({ from: 'YTZ', dest: 'DJT' });
  });

  it('normalises week to its Monday', () => {
    expect(parseUrlState('?week=2026-10-08').week).toBe('2026-10-05');
  });

  it('derives the week from the day, overriding a conflicting week', () => {
    expect(parseUrlState('?day=2026-10-07')).toEqual({ day: '2026-10-07', week: '2026-10-05' });
    expect(parseUrlState('?week=2026-12-07&day=2026-10-07').week).toBe('2026-10-05');
  });

  it('accepts the Starred region and caps the query length', () => {
    const s = parseUrlState(`?region=Starred&q=${'a'.repeat(200)}`);
    expect(s.region).toBe('Starred');
    expect(s.q).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('serializeUrlState', () => {
  it('writes fields in a stable order and skips empty ones', () => {
    expect(serializeUrlState({ q: 'lis', dest: 'LHR', from: 'YUL', day: '2026-10-07' })).toBe(
      '?from=YUL&day=2026-10-07&dest=LHR&q=lis',
    );
    expect(serializeUrlState({})).toBe('');
  });

  it('round-trips', () => {
    const s = { from: 'YYZ', day: '2026-10-07', week: '2026-10-05', region: 'Asia & Pacific', dest: 'LHR', q: 'são' };
    expect(parseUrlState(serializeUrlState(s))).toEqual(s);
  });
});
