import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { MIN_STAY_MIN } from '../../recs/engine';
import { RECS_META, RECS_ROUTES } from '../../recs/testing/recs-fixture';
import { toUtcMs } from '../../utils/time';
import {
  WeekendInput, WeekendOption, compareWeekend, presetWindow, upcomingFriday, weekendMeta, weekendOption, weekendOptions, windowOutbound,
  windowValid,
} from './weekend-model';

const TZ = 'America/Toronto';
const NOW = toUtcMs('2026-10-06', '09:00', TZ);   // Tuesday
const input = (over: Partial<WeekendInput> = {}): WeekendInput => ({
  hub: 'YUL', nowMs: NOW, window: presetWindow('this', '2026-10-06'), showConnections: true, connect: { minConnect: 60 }, ...over,
});
const codes = (list: WeekendOption[]) => list.map(o => o.code);

beforeEach(() => setScheduleSource(RECS_ROUTES, RECS_META));
afterEach(() => resetScheduleSource());

describe('weekend windows', () => {
  it('finds the Friday of the weekend to plan', () => {
    expect(upcomingFriday('2026-10-05')).toBe('2026-10-09');   // Mon
    expect(upcomingFriday('2026-10-09')).toBe('2026-10-09');   // Fri
    expect(upcomingFriday('2026-10-10')).toBe('2026-10-09');   // Sat: the weekend in progress
    expect(upcomingFriday('2026-10-11')).toBe('2026-10-16');   // Sun: next weekend
  });

  it('defaults to Fri 17:00 → Sun 22:00 of the upcoming weekend', () => {
    expect(presetWindow('this', '2026-10-06')).toEqual({ leaveKey: '2026-10-09', leaveHhmm: '17:00', homeKey: '2026-10-11', homeHhmm: '22:00' });
    expect(presetWindow('custom', '2026-10-06')).toEqual(presetWindow('this', '2026-10-06'));
  });

  it('shifts next weekend by a week and builds the shorter and longer presets', () => {
    expect(presetWindow('next', '2026-10-06')).toEqual({ leaveKey: '2026-10-16', leaveHhmm: '17:00', homeKey: '2026-10-18', homeHhmm: '22:00' });
    expect(presetWindow('fri-sun', '2026-10-06')).toEqual({ leaveKey: '2026-10-09', leaveHhmm: '17:00', homeKey: '2026-10-11', homeHhmm: '12:00' });
    expect(presetWindow('sat-mon', '2026-10-06')).toEqual({ leaveKey: '2026-10-10', leaveHhmm: '06:00', homeKey: '2026-10-12', homeHhmm: '22:00' });
  });

  it('rejects a window that ends before it starts', () => {
    expect(windowValid(presetWindow('this', '2026-10-06'), 'YUL')).toBe(true);
    expect(windowValid({ leaveKey: '2026-10-11', leaveHhmm: '22:00', homeKey: '2026-10-11', homeHhmm: '22:00' }, 'YUL')).toBe(false);
    expect(weekendOptions(input({ window: { leaveKey: '2026-10-11', leaveHhmm: '12:00', homeKey: '2026-10-09', homeHhmm: '12:00' } }))).toEqual([]);
  });
});

describe('weekend outbound', () => {
  it('only keeps flights leaving at or after the leave-after time', () => {
    const lga = windowOutbound(input(), 'LGA');
    expect(lga.length).toBeGreaterThan(0);
    const leave = toUtcMs('2026-10-09', '17:00', TZ);
    expect(lga.every(it => it.departUtc >= leave)).toBe(true);
    // The 08:20 and 13:10 Friday flights are gone; a later leave-after drops more.
    const later = windowOutbound(input({ window: { ...presetWindow('this', '2026-10-06'), leaveHhmm: '23:00' } }), 'LGA');
    expect(later.length).toBeLessThan(lga.length);
  });

  it('drops departed flights', () => {
    const w = { ...presetWindow('this', '2026-10-06'), leaveHhmm: '00:00' };
    const all = windowOutbound(input({ window: w }), 'LGA');
    const now = toUtcMs('2026-10-09', '14:00', TZ);
    const left = windowOutbound(input({ window: w, nowMs: now }), 'LGA');
    expect(left.length).toBeLessThan(all.length);
    expect(left.every(it => it.departUtc > now)).toBe(true);
  });

  it('leaves out one-stop outbounds when connections are off', () => {
    const w = { leaveKey: '2026-10-09', leaveHhmm: '00:00', homeKey: '2026-10-12', homeHhmm: '22:00' };
    for (const code of ['LGA', 'FLL', 'CDG']) {
      expect(windowOutbound(input({ window: w, showConnections: false }), code).every(it => it.legs.length === 1)).toBe(true);
    }
  });
});

describe('weekend ranking', () => {
  it('ranks by tries home, then hours there, and only lists destinations that pair', () => {
    const list = weekendOptions(input());
    expect(codes(list)).toEqual(['LGA', 'FLL', 'CDG', 'OPO', 'CUN']);
    for (let i = 1; i < list.length; i++) expect(compareWeekend(list[i - 1], list[i])).toBeLessThan(0);
    expect(list.map(o => o.tries.length)).toEqual([...list.map(o => o.tries.length)].sort((a, b) => b - a));
    // FLL and CDG tie on tries; more hours on the ground wins.
    const fll = list.find(o => o.code === 'FLL')!;
    const cdg = list.find(o => o.code === 'CDG')!;
    expect(fll.tries.length).toBe(cdg.tries.length);
    expect(fll.hoursThere).toBeGreaterThan(cdg.hoursThere);
  });

  it('breaks full ties by code', () => {
    const a = { code: 'AAA', out: [], tries: [], retKey: '', hoursThere: 5 } as WeekendOption;
    const b = { ...a, code: 'BBB' };
    expect(compareWeekend(a, b)).toBeLessThan(0);
    expect([b, a].sort(compareWeekend).map(o => o.code)).toEqual(['AAA', 'BBB']);
  });

  it('counts every return that gets home by the deadline, after the minimum stay', () => {
    const o = weekendOption(input(), 'FLL')!;
    const deadline = toUtcMs('2026-10-11', '22:00', TZ);
    const firstArrive = Math.min(...o.out.map(it => it.arriveUtc));
    expect(o.tries.length).toBe(3);
    expect(o.tries.every(it => it.arriveUtc <= deadline)).toBe(true);
    expect(o.tries.every(it => it.departUtc >= firstArrive + MIN_STAY_MIN * 60_000)).toBe(true);
    expect(o.tries.every(it => it.origin === 'FLL' && it.dest === 'YUL')).toBe(true);
    expect(o.out.every(it => it.origin === 'YUL' && it.dest === 'FLL')).toBe(true);
    expect(o.hoursThere).toBe(Math.round((Math.max(...o.tries.map(it => it.departUtc)) - firstArrive) / 3_600_000));
  });

  it('a tighter deadline removes tries and destinations', () => {
    const tight = weekendOptions(input({ window: presetWindow('fri-sun', '2026-10-06') }));
    const loose = weekendOptions(input());
    expect(codes(tight)).toEqual(['LGA', 'FLL', 'CDG', 'OPO']);
    expect(tight.find(o => o.code === 'LGA')!.tries.length).toBeLessThan(loose.find(o => o.code === 'LGA')!.tries.length);
    expect(codes(tight)).not.toContain('CUN');
  });

  it('picks the return day with the most tries (the later day on a tie)', () => {
    const lga = weekendOption(input(), 'LGA')!;
    const perDay = new Map<string, number>();
    for (const it of lga.tries) perDay.set(it.dateKey, (perDay.get(it.dateKey) ?? 0) + 1);
    const most = Math.max(...perDay.values());
    expect(perDay.get(lga.retKey)).toBe(most);
    expect(lga.retKey).toBe([...perDay].filter(([, n]) => n === most).map(([k]) => k).sort().pop());
  });

  it('computes only for the codes given and never for the hub', () => {
    expect(codes(weekendOptions(input({ codes: ['FLL', 'YUL', 'ZZZ'] })))).toEqual(['FLL']);
    expect(weekendOption(input(), 'YUL')).toBeNull();
  });

  it('is empty when every outbound has left', () => {
    expect(weekendOptions(input({ nowMs: toUtcMs('2026-10-11', '21:00', TZ) }))).toEqual([]);
  });

  it('is empty outside the schedule coverage', () => {
    const far = presetWindow('this', '2028-01-04');
    expect(weekendOptions(input({ window: far, nowMs: toUtcMs('2028-01-04', '09:00', TZ) }))).toEqual([]);
  });

  it('words the card meta line as facts and counts', () => {
    const o = weekendOption(input(), 'FLL')!;
    expect(weekendMeta(o)).toBe('3 out · 3 tries home · ~39h there');
    expect(weekendMeta({ ...o, out: [o.out[0]], tries: [o.tries[0]], hoursThere: 5 })).toBe('1 out · 1 try home · ~5h there');
  });
});
