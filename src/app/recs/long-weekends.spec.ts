import { describe, expect, it } from 'vitest';
import { holidaysIn } from '../trips/engine/holidays';
import { HUB_PROVINCE, NOT_WIDELY_OFF, holidayAppliesAt, longWeekends, pickDays } from './long-weekends';
import { EMPTY_PROFILE } from './profile';
import { RECS_PROFILE } from './testing/recs-fixture';

describe('longWeekends', () => {
  it('finds Thanksgiving 2026 from Oct 1 at YUL, and no Remembrance Day', () => {
    const lws = longWeekends('2026-10-01', 60, 'YUL');
    expect(lws.map(l => `${l.name} ${l.holiday.dateKey}`)).toEqual(['Thanksgiving 2026-10-12']);
    const t = lws[0];
    expect(t.id).toBe('lw:2026-10-12');
    expect(t.outKeys).toEqual(['2026-10-09', '2026-10-10']);
    expect(t.backKeys).toEqual(['2026-10-12', '2026-10-11']);
    expect([t.startKey, t.endKey]).toEqual(['2026-10-09', '2026-10-12']);
  });

  it('is strict after fromKey and bounded by the horizon', () => {
    expect(longWeekends('2026-10-12', 80, 'YUL').map(l => l.holiday.dateKey)).toEqual(['2026-12-25']);
    expect(longWeekends('2026-10-01', 10, 'YUL')).toEqual([]);
  });

  it('uses the hub province: Family Day in Ontario, not in Quebec; Fête nationale only in Quebec', () => {
    const on = longWeekends('2027-02-01', 30, 'YYZ').map(l => l.name);
    const qc = longWeekends('2027-02-01', 30, 'YUL').map(l => l.name);
    expect(on).toContain('Family Day');
    expect(qc).not.toContain('Family Day');
    expect(longWeekends('2027-06-01', 30, 'YUL').map(l => l.name)).toContain('Fête nationale');
    expect(longWeekends('2027-06-01', 30, 'YYZ').map(l => l.name)).not.toContain('Fête nationale');
  });

  it('skips the holidays most people still work, and US holidays', () => {
    const all = [...longWeekends('2026-01-01', 366, 'YYZ'), ...longWeekends('2027-01-01', 366, 'YUL')].map(l => l.name);
    for (const n of NOT_WIDELY_OFF) expect(all).not.toContain(n);
    expect(all).not.toContain('Memorial Day');
    expect(all).toContain('Good Friday');
  });

  it('names in NOT_WIDELY_OFF and province codes match the holiday data exactly', () => {
    const names = new Set(holidaysIn(2027).map(h => h.name));
    for (const n of NOT_WIDELY_OFF) expect(names.has(n)).toBe(true);
    const qc = holidaysIn(2027).find(h => h.name === 'Fête nationale')!;
    expect(holidayAppliesAt(qc, 'YUL')).toBe(true);
    expect(holidayAppliesAt(qc, 'YYZ')).toBe(false);
    expect(Object.values(HUB_PROVINCE).every(p => /^CA-[A-Z]{2}$/.test(p))).toBe(true);
  });

  it('builds windows for Friday, Tuesday and Thursday holidays', () => {
    const goodFriday = longWeekends('2027-03-20', 20, 'YUL').find(l => l.name === 'Good Friday')!;
    expect(goodFriday.holiday.dateKey).toBe('2027-03-26');
    expect(goodFriday.outKeys).toEqual(['2027-03-25', '2027-03-26']);
    expect(goodFriday.backKeys).toEqual(['2027-03-28', '2027-03-29']);
    // Canada Day 2025 was a Tuesday; Christmas 2025 a Thursday.
    const canada = longWeekends('2025-06-20', 20, 'YUL').find(l => l.name === 'Canada Day')!;
    expect([canada.outKeys, canada.backKeys]).toEqual([['2025-06-28'], ['2025-07-01']]);
    const xmas = longWeekends('2025-12-10', 20, 'YUL').find(l => l.name === 'Christmas Day')!;
    expect([xmas.outKeys, xmas.backKeys]).toEqual([['2025-12-25'], ['2025-12-28']]);
  });
});

describe('pickDays', () => {
  const [thanksgiving] = longWeekends('2026-10-01', 60, 'YUL');

  it('Thu..Mon → out Fri Oct 9, back Mon Oct 12', () => {
    expect(pickDays(thanksgiving, RECS_PROFILE)).toEqual({ outKey: '2026-10-09', backKey: '2026-10-12' });
  });

  it('Saturday only → out Sat, back on the holiday Monday (a holiday always counts)', () => {
    expect(pickDays(thanksgiving, { ...RECS_PROFILE, days: [6] })).toEqual({ outKey: '2026-10-10', backKey: '2026-10-12' });
  });

  it('day and week lengths', () => {
    expect(pickDays(thanksgiving, { ...RECS_PROFILE, length: 'day' })).toEqual({ outKey: '2026-10-12', backKey: '2026-10-12' });
    expect(pickDays(thanksgiving, { ...RECS_PROFILE, length: 'week' })).toEqual({ outKey: '2026-10-10', backKey: '2026-10-17' });
  });

  it('any day with an empty profile; null when no out day fits', () => {
    expect(pickDays(thanksgiving, EMPTY_PROFILE)).toEqual({ outKey: '2026-10-09', backKey: '2026-10-12' });
    expect(pickDays(thanksgiving, { ...RECS_PROFILE, days: [2, 3] })).toBeNull();
  });
});
