import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { toUtcMs } from '../../utils/time';
import { SEVILLE_META, SEVILLE_ROUTES } from '../testing/seville-fixture';
import { deadlineUtc, homeByPlan, missOneChain, spareLabel, triesFrom, triesOnDay } from './homeby';

const HOME_BY = { dateKey: '2026-10-13', hhmm: '22:00' };
const flights = (it: { legs: { flightNumber: string | null }[] }) => it.legs.map(l => l.flightNumber).join('+');

describe('home-by and the miss-one chain (Seville fixture)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('puts the deadline at 22:00 Montréal time', () => {
    expect(deadlineUtc(HOME_BY, 'YUL')).toBe(toUtcMs('2026-10-13', '22:00', 'America/Toronto'));
    expect(new Date(deadlineUtc(HOME_BY, 'YUL')).toISOString()).toBe('2026-10-14T02:00:00.000Z');
  });

  it('finds 2 tries on Tue and 4 from Mon (minConnect 120)', () => {
    const plan = homeByPlan('LIS', 'YUL', HOME_BY, '2026-10-12', { minConnect: 120 });
    expect(plan.covered).toBe(true);
    expect(plan.days.map(d => d.dateKey)).toEqual(['2026-10-12', '2026-10-13']);

    const tue = plan.days[1].tries;
    expect(tue.map(t => flights(t.itinerary))).toEqual(['AC813', 'AC811+AC422']);
    expect(tue.map(t => t.index)).toEqual([1, 2]);
    expect(tue[0].slackMin).toBe(490);
    expect(spareLabel(tue[0].slackMin)).toBe('8h10');
    expect(Math.floor(tue[0].slackMin / 60)).toBe(8);
    expect(tue[0].standbyLegs).toBe(1);
    expect(tue[1].standbyLegs).toBe(2);
    expect(tue[1].itinerary.legs[1].arrLocal).toBe('19:21');
    expect(tue[1].itinerary.legs[1].depLocal).toBe('18:00');

    expect(triesFrom(plan, '2026-10-13')).toBe(2);
    expect(triesFrom(plan, '2026-10-12')).toBe(4);
    expect(plan.days[0].tries.map(t => flights(t.itinerary))).toEqual(['AC813', 'AC811+AC422']);
  });

  it('finds AC813 on Wed Oct 14 as the next option after the deadline', () => {
    const plan = homeByPlan('LIS', 'YUL', HOME_BY, '2026-10-12', { minConnect: 120 });
    expect(plan.nextAfterDeadline && flights(plan.nextAfterDeadline)).toBe('AC813');
    expect(plan.nextAfterDeadline!.dateKey).toBe('2026-10-14');
  });

  it('builds the chain: try, fallback, late', () => {
    const plan = homeByPlan('LIS', 'YUL', HOME_BY, '2026-10-12', { minConnect: 120 });
    const steps = missOneChain(plan, '2026-10-13');
    expect(steps.map(s => s.kind)).toEqual(['try', 'fallback', 'late']);
    expect(steps.map(s => s.label)).toEqual(['Try 1', 'If you miss it', 'If you miss both']);
    expect(flights(steps[0].itinerary!)).toBe('AC813');
    expect(steps[0].slackMin).toBe(490);
    expect(flights(steps[1].itinerary!)).toBe('AC811+AC422');
    expect(flights(steps[2].itinerary!)).toBe('AC813');
    expect(steps[2].itinerary!.dateKey).toBe('2026-10-14');
    expect(steps[2].slackMin).toBeNull();
  });

  it('documents minConnect 60: the second try connects to AC894 17:30', () => {
    const plan = homeByPlan('LIS', 'YUL', HOME_BY, '2026-10-13', { minConnect: 60 });
    const tue = plan.days[0].tries;
    expect(tue.map(t => flights(t.itinerary))).toEqual(['AC813', 'AC811+AC894']);
    expect(tue[1].itinerary.legs[1].depLocal).toBe('17:30');
  });

  it('drops a one-stop whose earliest onward lands after the deadline', () => {
    const early = { dateKey: '2026-10-13', hhmm: '19:00' };
    const tries = triesOnDay('LIS', 'YUL', '2026-10-13', deadlineUtc(early, 'YUL'), { minConnect: 120 });
    expect(tries.map(t => flights(t.itinerary))).toEqual(['AC813']);
  });

  it('gives one late step when there are no tries', () => {
    const plan = homeByPlan('LIS', 'YUL', { dateKey: '2026-10-13', hhmm: '12:00' }, '2026-10-13', { minConnect: 120 });
    const steps = missOneChain(plan, '2026-10-13');
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('late');
    expect(flights(steps[0].itinerary!)).toBe('AC813');
    expect(steps[0].itinerary!.dateKey).toBe('2026-10-13');
  });

  it('skips a later try that leaves within 30 min of the previous one', () => {
    const plan = homeByPlan('YYZ', 'YUL', HOME_BY, '2026-10-13', {});
    // YYZ→YUL: AC894 17:30, AC422 18:00 (30 min later: kept), AC424 19:00, AC426 20:30.
    const steps = missOneChain(plan, '2026-10-13');
    expect(steps.filter(s => s.kind !== 'late').map(s => flights(s.itinerary!))).toEqual(['AC894', 'AC422', 'AC424', 'AC426']);
    expect(steps[steps.length - 1].label).toBe('If you miss them all');
    const tight = { ...plan, days: [{ dateKey: '2026-10-13', tries: plan.days[0].tries.map(t => t) }] };
    // Move AC422 to 17:50 (20 min after AC894) in a copy: it is skipped.
    tight.days[0].tries[1] = {
      ...tight.days[0].tries[1],
      itinerary: { ...tight.days[0].tries[1].itinerary, departUtc: tight.days[0].tries[0].itinerary.departUtc + 20 * 60_000 },
    };
    expect(missOneChain(tight, '2026-10-13').filter(s => s.kind === 'fallback')).toHaveLength(2);
  });

  it('marks a plan outside coverage as not covered', () => {
    const plan = homeByPlan('LIS', 'YUL', { dateKey: '2027-10-05', hhmm: '22:00' }, '2027-10-04', {});
    expect(plan.covered).toBe(false);
    expect(triesFrom(plan, '2027-10-04')).toBe(0);
  });
});
