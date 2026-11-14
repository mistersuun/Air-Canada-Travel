import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Coverage, SchedulesMeta } from '../data/schedule-index';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { rec, route } from '../data/testing/schedule-fixtures';
import { setLocale } from '../i18n/locale';
import type { TripsService } from '../trips/trips.service';
import type { Trip } from '../trips/model';
import { NO_OPTS, type ConnectOptions, type Itinerary } from '../utils/connections';
import { addDays } from '../utils/time';
import { flightSlug } from '../ui/links';
import {
  NIGHT_PRESETS, type CountCtx, carryPick, countDay, countWords, dayCountAria, earliestArrival, homeAfterUtc, homeByFor,
  homeCounts, itinerariesMemoStats, itinerariesOn, landingLabel, minuteOf, nearestHomeDays, nightsBetween, outCounts,
  outboundsOn, pickable, planParams, readPlan, resetItinerariesMemo, retDeadline, retFrom, shiftRet, staleBack, startRoundTrip,
  stayOptions, stripKeys, waysHome,
} from './round-trip';

const plain = (s: string) => s.replace(/[  ]/g, ' ');

/**
 * A Lisbon world, autumn 2026:
 * - YUL→LIS AC834 22:10→08:15⁺¹ Mon/Wed/Fri/Sun, AC832 21:55→08:00⁺¹ Tue/Thu,
 *   AC830 18:05→04:05⁺¹ Fri only; no nonstop on Saturdays.
 * - YYZ→LIS AC876 19:00→06:30⁺¹ Sat only: with the estimated YUL→YYZ legs,
 *   Saturday is a connections-only day out.
 * - LIS→YUL AC835 07:10, AC837 10:40, AC839 13:00 daily; AC831 08:45 and
 *   AC833 09:15 on Sat Nov 21 only (30 and 60 min after AC834 lands).
 */
const ROUTES = [
  route('YUL', 'LIS',
    rec('AC834', '22:10', '08:15', '2026-09-01', '2027-03-28', 'Mon,Wed,Fri,Sun', '333'),
    rec('AC832', '21:55', '08:00', '2026-09-01', '2027-03-28', 'Tue,Thu', '333'),
    rec('AC830', '18:05', '04:05', '2026-09-01', '2027-03-28', 'Fri', '789'),
  ),
  route('YYZ', 'LIS', rec('AC876', '19:00', '06:30', '2026-09-01', '2027-03-28', 'Sat', '789')),
  route('LIS', 'YUL',
    rec('AC835', '07:10', '09:10', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', '333'),
    rec('AC837', '10:40', '12:40', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', '333'),
    rec('AC839', '13:00', '15:00', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', '333'),
    rec('AC831', '08:45', '10:45', '2026-11-21', '2026-11-21', 'Sat', '333'),
    rec('AC833', '09:15', '11:15', '2026-11-21', '2026-11-21', 'Sat', '333'),
  ),
];
const META: SchedulesMeta = { generatedAt: '2026-11-01T06:00:00Z', coverageFrom: '2026-09-01', coverageTo: '2027-03-28' };
const COVERAGE: Coverage = { from: '2026-09-01', to: '2027-03-28', generatedAt: META.generatedAt, hub: 'YUL' };
/** Sat Nov 14 2026, 10:00 in Montréal. */
const NOW = Date.parse('2026-11-14T15:00:00Z');
const CONNECT: ConnectOptions = Object.freeze({ minConnect: 60 });

function ctx(over: Partial<CountCtx> = {}): CountCtx {
  return {
    today: '2026-11-14', nowMinute: minuteOf(NOW), coverage: COVERAGE, showConnections: false, connect: CONNECT, ...over,
  };
}

const slugs = (its: readonly Itinerary[]) => its.map(flightSlug);
const DEP = '2026-11-20';
const byNum = (its: readonly Itinerary[], n: string) => its.find(i => flightSlug(i) === n)!;

describe('planner/round-trip', () => {
  beforeEach(() => {
    setScheduleSource(ROUTES, META);
    resetItinerariesMemo();
  });
  afterEach(() => {
    resetScheduleSource();
    setLocale('en');
  });

  it('counts nights between departure dates, and reads ?nights= from the departure (1)', () => {
    const out = byNum(outboundsOn('YUL', 'LIS', DEP, ctx()), 'AC834');
    expect(out.arrDateKey).toBe('2026-11-21');
    expect(nightsBetween(DEP, '2026-11-28')).toBe(8);
    expect(retFrom(DEP, null, '4')).toBe('2026-11-24');
    expect(retFrom(DEP, '2026-11-28', '4')).toBe('2026-11-28');
    expect(retFrom(DEP, '2026-11-19', null)).toBeNull();
    expect(retFrom(DEP, 'nope', null)).toBeNull();
    expect(landingLabel(out, '2026-11-14', '24h')).toBe('Sat, Nov 21 08:15');
  });

  it('applies the minimum connection time after landing (2)', () => {
    const c = ctx();
    const out = byNum(outboundsOn('YUL', 'LIS', DEP, c), 'AC834');
    const sat = '2026-11-21';
    const after60 = homeAfterUtc(out, [], CONNECT)!;
    expect(slugs(waysHome('LIS', 'YUL', sat, c, after60))).toEqual(['AC833', 'AC837', 'AC839']);
    const loose: ConnectOptions = { minConnect: 20 };
    const after20 = homeAfterUtc(out, [], loose)!;
    expect(slugs(waysHome('LIS', 'YUL', sat, { ...c, connect: loose }, after20))).toEqual(['AC831', 'AC833', 'AC837', 'AC839']);
    expect(homeAfterUtc(null, [], CONNECT)).toBeNull();
    expect(homeAfterUtc(out, [], NO_OPTS)).toBe(out.arriveUtc + 60 * 60_000);
  });

  it('uses the earliest arrival with no pick; a later pick lowers the count (3)', () => {
    const c = ctx();
    const outs = outboundsOn('YUL', 'LIS', DEP, c);
    expect(slugs(outs).sort()).toEqual(['AC830', 'AC834']);
    expect(flightSlug(earliestArrival(outs)!)).toBe('AC830');
    const best = homeCounts('LIS', 'YUL', ['2026-11-21'], DEP, c, homeAfterUtc(null, outs, CONNECT), '24h')[0];
    const picked = homeCounts('LIS', 'YUL', ['2026-11-21'], DEP, c, homeAfterUtc(byNum(outs, 'AC834'), outs, CONNECT), '24h')[0];
    expect(best.total).toBe(5);
    expect(picked.total).toBe(3);
    expect(picked).toMatchObject({ state: 'ok', nights: 1, first: '09:15', last: '13:00', direct: 3, connecting: 0 });
  });

  it('a connections-only day counts 0 with connections off, and the rest as hidden (4)', () => {
    const sat = '2026-11-21';
    const off = outCounts('YUL', 'LIS', [sat], ctx(), '24h')[0];
    expect(off).toMatchObject({ total: 0, state: 'none', direct: 0 });
    expect(off.hidden).toBeGreaterThan(0);
    expect(countWords(off, 'out')).toBe(`no flights, ${off.hidden} with a connection hidden`);
    const on = outCounts('YUL', 'LIS', [sat], ctx({ showConnections: true }), '24h')[0];
    expect(on).toMatchObject({ state: 'ok', direct: 0, hidden: 0 });
    expect(on.connecting).toBe(on.total);
    expect(outboundsOn('YUL', 'LIS', sat, ctx())).toEqual([]);
    expect(outboundsOn('YUL', 'LIS', sat, ctx({ showConnections: true }))).toHaveLength(on.total);
  });

  it('states: coverage edge is unpublished, past is past, loading is loading, before dep (5)', () => {
    const keys = ['2026-11-13', '2026-11-20', '2027-03-28', '2027-03-29'];
    expect(outCounts('YUL', 'LIS', keys, ctx(), '24h').map(c => c.state)).toEqual(['past', 'ok', 'ok', 'unpublished']);
    expect(outCounts('YUL', 'LIS', keys, ctx({ loading: true }), '24h').map(c => c.state)).toEqual(['loading', 'loading', 'loading', 'loading']);
    const home = homeCounts('LIS', 'YUL', ['2026-11-19', '2026-11-20', '2026-11-28'], DEP, ctx(), null, '24h');
    expect(home.map(c => c.state)).toEqual(['before-dep', 'ok', 'ok']);
    expect(home.map(c => c.nights)).toEqual([undefined, 0, 8]);
    expect(home[0].total).toBe(0);
    // Today: only what is still to come.
    const today = outCounts('YUL', 'LIS', ['2026-11-15'], ctx({ today: '2026-11-15', nowMinute: Date.parse('2026-11-16T03:30:00Z') }), '24h')[0];
    expect(today.state).toBe('none');
  });

  it('property: every count equals the rows of its list, over 50 days (6)', () => {
    for (const showConnections of [false, true]) {
      const c = ctx({ showConnections });
      for (let i = -2; i < 48; i++) {
        const k = addDays('2026-11-14', i);
        const outs = outboundsOn('YUL', 'LIS', k, c);
        expect(outCounts('YUL', 'LIS', [k], c, '24h')[0].total, `out ${k}`).toBe(outs.length);
        const after = homeAfterUtc(null, outboundsOn('YUL', 'LIS', DEP, c), CONNECT);
        const r = addDays(DEP, i);
        expect(homeCounts('LIS', 'YUL', [r], DEP, c, after, '24h')[0].total, `home ${r}`)
          .toBe(r < DEP ? 0 : waysHome('LIS', 'YUL', r, c, after).length);
        const all = itinerariesOn('LIS', 'YUL', r, CONNECT);
        expect(countDay(r, waysHome('LIS', 'YUL', r, c, null), all, c, '24h').total).toBe(waysHome('LIS', 'YUL', r, c, null).length);
      }
    }
  });

  it('carryPick keeps the same flight number, else suggests the same kind and picks nothing (7)', () => {
    const wed = outboundsOn('YUL', 'LIS', '2026-11-18', ctx());
    const kept = carryPick('AC834', wed, true);
    expect(kept.kept).toBe(true);
    expect(flightSlug(kept.it!)).toBe('AC834');
    expect(kept.it!.dateKey).toBe('2026-11-18');
    const thu = outboundsOn('YUL', 'LIS', '2026-11-19', ctx());
    const missing = carryPick('ac834', thu, true);
    expect(missing).toMatchObject({ it: null, kept: false });
    expect(flightSlug(missing.suggestion!)).toBe('AC832');
    expect(carryPick('AC834', thu, false).suggestion).toBeNull();     // no connection that day
    expect(carryPick(null, thu, true)).toEqual({ it: null, kept: false, suggestion: null });
  });

  it('staleBack reports a return that leaves before landing, or no longer flies (8)', () => {
    const c = ctx();
    const out = byNum(outboundsOn('YUL', 'LIS', DEP, c), 'AC834');
    const after = homeAfterUtc(out, [], CONNECT);
    const all = itinerariesOn('LIS', 'YUL', '2026-11-21', CONNECT);
    expect(staleBack('AC831', all, after)).toMatchObject({ stale: 'beforeLanding' });
    expect(flightSlug(staleBack('AC831', all, after).it!)).toBe('AC831');
    expect(staleBack('AC999', all, after)).toEqual({ it: null, stale: 'gone' });
    expect(staleBack('AC837', all, after).stale).toBeNull();
    expect(staleBack(null, all, after)).toEqual({ it: null, stale: null });
  });

  it('shiftRet keeps the nights when the departure moves to or past the return (9)', () => {
    expect(shiftRet('2026-11-29', DEP, '2026-11-28')).toEqual({ ret: '2026-12-07', moved: true });
    expect(shiftRet('2026-11-28', DEP, '2026-11-28')).toEqual({ ret: '2026-12-06', moved: true });
    expect(shiftRet('2026-11-22', DEP, '2026-11-28')).toEqual({ ret: '2026-11-28', moved: false });
    expect(shiftRet('2026-11-22', DEP, null)).toEqual({ ret: null, moved: false });
  });

  it('readPlan drops invalid values, keeps a valid day trip and stale slugs (10)', () => {
    const today = '2026-11-14';
    expect(readPlan({ dep: DEP, ret: '2026-11-28', out: 'AC834', back: 'AC835' }, today, COVERAGE))
      .toEqual({ dep: DEP, ret: '2026-11-28', out: 'AC834', back: 'AC835' });
    expect(readPlan({ dep: '2026-11-10', ret: '2026-11-28' }, today, COVERAGE)).toEqual({ dep: null, ret: null, out: null, back: null });
    expect(readPlan({ dep: 'junk' }, today, COVERAGE).dep).toBeNull();
    expect(readPlan({ dep: DEP, ret: '2026-11-19', back: 'AC835' }, today, COVERAGE)).toEqual({ dep: DEP, ret: null, out: null, back: null });
    expect(readPlan({ dep: DEP, ret: '2027-04-02' }, today, COVERAGE).ret).toBeNull();
    expect(readPlan({ dep: DEP, nights: '4' }, today, COVERAGE).ret).toBe('2026-11-24');
    expect(readPlan({ dep: DEP, ret: DEP }, today, COVERAGE).ret).toBe(DEP);
    expect(readPlan({ dep: DEP, ret: DEP }, today, COVERAGE, () => false).ret).toBeNull();
    // A slug that no longer matches is kept (the page shows a notice); junk is not.
    expect(readPlan({ dep: DEP, out: 'AC999', back: 'AC300+AC1', ret: '2026-11-28' }, today, COVERAGE))
      .toMatchObject({ out: 'AC999', back: 'AC300+AC1' });
    expect(readPlan({ dep: DEP, out: '<script>', ret: '2026-11-28', back: ['AC835'] }, today, COVERAGE))
      .toMatchObject({ out: null, back: 'AC835' });
    expect(planParams({ dep: DEP, ret: null, out: 'AC834', back: null })).toEqual({ dep: DEP, out: 'AC834' });
    expect(pickable(DEP, today, COVERAGE)).toBe(true);
    expect(pickable('2027-03-29', today, COVERAGE)).toBe(false);
  });

  it('stayOptions offers exactly 2, 3, 4, 5 and 7 nights (11)', () => {
    const c = ctx();
    const after = homeAfterUtc(null, outboundsOn('YUL', 'LIS', DEP, c), CONNECT);
    const opts = stayOptions(DEP, 'LIS', 'YUL', c, after, '24h');
    expect(NIGHT_PRESETS).toEqual([2, 3, 4, 5, 7]);
    expect(opts.map(o => o.nights)).toEqual([2, 3, 4, 5, 7]);
    expect(opts.map(o => o.key)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27']);
    expect(opts.every(o => o.count.total === 3 && o.count.nights === o.nights)).toBe(true);
    expect(stayOptions(DEP, 'LIS', 'YUL', c, after, '24h', [9])[0]).toMatchObject({ nights: 9, key: '2026-11-29' });
  });

  it('perf: 3 months of ways home with connections on stay under 50 ms; re-renders hit the memo (12)', () => {
    const c = ctx({ showConnections: true });
    const keys = Array.from({ length: 93 }, (_, i) => addDays('2026-11-14', i));
    const after = homeAfterUtc(null, outboundsOn('YUL', 'LIS', DEP, c), CONNECT);
    const t0 = performance.now();
    homeCounts('LIS', 'YUL', keys, '2026-11-14', c, after, '24h');
    expect(performance.now() - t0).toBeLessThan(50);
    const before = itinerariesMemoStats();
    homeCounts('LIS', 'YUL', keys, '2026-11-14', c, after, '24h');
    const s = itinerariesMemoStats();
    const hits = s.hits - before.hits;
    const misses = s.misses - before.misses;
    expect(hits / (hits + misses)).toBeGreaterThan(0.9);
  });

  it('a 30 s tick does not change or recompute counts for other days (13)', () => {
    const keys = ['2026-11-20', '2026-11-21', '2026-11-28'];
    const a = homeCounts('LIS', 'YUL', keys, DEP, ctx(), null, '24h');
    const misses = itinerariesMemoStats().misses;
    const b = homeCounts('LIS', 'YUL', keys, DEP, ctx({ nowMinute: minuteOf(NOW + 30_000) }), null, '24h');
    expect(b).toEqual(a);
    expect(itinerariesMemoStats().misses).toBe(misses);
    expect(minuteOf(NOW + 30_000)).toBe(minuteOf(NOW));
  });

  it('nearestHomeDays lists the nearest days with ways home, in date order', () => {
    const c = ctx();
    // Two days each side have 3 ways home; the nearest (one day away) are kept.
    const near = nearestHomeDays('LIS', 'YUL', '2026-11-23', DEP, c, null);
    expect(near).toEqual([{ key: '2026-11-22', n: 3 }, { key: '2026-11-24', n: 3 }]);
    expect(nearestHomeDays('LIS', 'YUL', DEP, DEP, c, null, 3, 1)).toEqual([{ key: '2026-11-21', n: 5 }]);
  });

  it('stripKeys spans the window and never starts before min', () => {
    expect(stripKeys(DEP, 3, 3)).toEqual(['2026-11-17', '2026-11-18', '2026-11-19', DEP, '2026-11-21', '2026-11-22', '2026-11-23']);
    expect(stripKeys('2026-11-15', 3, 1, '2026-11-14')).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
  });

  it('labels a day count for screen readers, in English and French', () => {
    const c = ctx({ showConnections: true });
    const home = homeCounts('LIS', 'YUL', ['2026-11-28'], DEP, c, null, '24h')[0];
    expect(dayCountAria(home, 'home')).toBe('Saturday, November 28, 2026, 3 ways home, 8 nights');
    const split = { ...home, total: 3, direct: 2, connecting: 1 };
    expect(dayCountAria(split, 'home')).toBe('Saturday, November 28, 2026, 3 ways home, 2 nonstop and 1 with a connection, 8 nights');
    expect(dayCountAria(outCounts('YUL', 'LIS', [DEP], c, '24h')[0], 'out')).toBe('Friday, November 20, 2026, 2 flights out');
    setLocale('fr');
    expect(plain(dayCountAria(split, 'home'))).toBe('samedi 28 novembre 2026, 3 retours, 2 sans escale et 1 avec correspondance, 8 nuits');
    expect(plain(landingLabel(byNum(outboundsOn('YUL', 'LIS', DEP, c), 'AC834'), '2026-11-14', '24h'))).toBe('sam. 21 nov. 08:15');
  });

  it('homeByFor and startRoundTrip build a two-leg trip', () => {
    const c = ctx();
    const out = byNum(outboundsOn('YUL', 'LIS', DEP, c), 'AC834');
    const back = byNum(waysHome('LIS', 'YUL', '2026-11-28', c, null), 'AC837');
    expect(homeByFor(back)).toEqual({ dateKey: '2026-11-28', hhmm: '22:00' });
    const calls: unknown[][] = [];
    const trip = { id: 't1', legs: [] } as unknown as Trip;
    const fake = {
      create: (x: unknown) => (calls.push(['create', x]), trip),
      addFlightLeg: (id: string, it: Itinerary, role: string) => (calls.push(['leg', id, flightSlug(it), role]), 'l'),
      trip: () => trip,
    } as unknown as TripsService;
    expect(startRoundTrip(fake, { hub: 'YUL', code: 'LIS', out, back, ret: '2026-11-28' })).toBe(trip);
    expect(calls[0][1]).toMatchObject({ fromHub: 'YUL', outboundDate: DEP, homeBy: { dateKey: '2026-11-28', hhmm: '22:00' } });
    expect((calls[0][1] as { goal: { acCode: string } }).goal.acCode).toBe('LIS');
    expect(calls.slice(1)).toEqual([['leg', 't1', 'AC834', 'outbound'], ['leg', 't1', 'AC837', 'return']]);
    calls.length = 0;
    startRoundTrip(fake, { hub: 'YUL', code: 'LIS', out, back: null, ret: '2026-11-27' });
    expect(calls[0][1]).toMatchObject({ homeBy: { dateKey: '2026-11-27', hhmm: '22:00' } });
    expect(calls).toHaveLength(2);
  });
  it('startRoundTrip never sets a home-by before the outbound lands', () => {
    const c = ctx();
    const out = byNum(outboundsOn('YUL', 'LIS', DEP, c), 'AC834'); // lands Sat Nov 21 08:15
    expect(out.arrDateKey).toBe('2026-11-21');
    // A same-day return (ret = dep) with an overnight outbound: the deadline moves to the arrival day.
    expect(retDeadline(out, DEP)).toEqual({ dateKey: '2026-11-21', hhmm: '22:00' });
    expect(retDeadline(out, '2026-11-25')).toEqual({ dateKey: '2026-11-25', hhmm: '22:00' });
    expect(retDeadline(out, null)).toEqual({ dateKey: addDays('2026-11-21', 4), hhmm: '22:00' });
    const calls: unknown[][] = [];
    const trip = { id: 't1', legs: [] } as unknown as Trip;
    const fake = {
      create: (x: unknown) => (calls.push(['create', x]), trip),
      addFlightLeg: () => 'l',
      trip: () => trip,
    } as unknown as TripsService;
    startRoundTrip(fake, { hub: 'YUL', code: 'LIS', out, back: null, ret: DEP });
    expect(calls[0][1]).toMatchObject({ homeBy: { dateKey: '2026-11-21', hhmm: '22:00' } });
  });

  it('counts one kind when a page lists one kind (Nonstop / Via seg)', () => {
    const on = ctx({ showConnections: true });
    const sat = '2026-11-21'; // connections only out of YUL
    expect(outCounts('YUL', 'LIS', [sat], on, '24h')[0].total).toBeGreaterThan(0);
    expect(outCounts('YUL', 'LIS', [sat], on, '24h', 'direct')[0]).toMatchObject({ total: 0, state: 'none' });
    const via = outCounts('YUL', 'LIS', [sat], on, '24h', 'via')[0];
    expect(via.total).toBe(via.connecting);
    const fri = outCounts('YUL', 'LIS', [DEP], on, '24h', 'direct')[0];
    expect(fri.total).toBe(outboundsOn('YUL', 'LIS', DEP, ctx()).length);
    const stays = stayOptions(DEP, 'LIS', 'YUL', on, null, '24h', [2], 'direct');
    expect(stays[0].count.total).toBe(waysHome('LIS', 'YUL', addDays(DEP, 2), ctx(), null).length);
  });
});
