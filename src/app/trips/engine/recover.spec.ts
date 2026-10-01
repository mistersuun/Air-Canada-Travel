import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { toUtcMs } from '../../utils/time';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../testing/seville-fixture';
import { CLOSED_REASON, currentGateway, missOneOutbound, stillReachable } from './recover';

const AT_1805 = toUtcMs('2026-10-08', '18:05', 'America/Toronto');
const flights = (o: { itinerary: { legs: { flightNumber: string | null }[] } }) => o.itinerary.legs.map(l => l.flightNumber).join('+');

describe('stillReachable (Seville fixture, YUL at 18:05 Thu Oct 8)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  const run = () => stillReachable({ trip: sevilleTrip(), at: 'YUL', nowMs: AT_1805, connect: { minConnect: 60 } });

  it('knows the trip flies into Madrid', () => {
    expect(currentGateway(sevilleTrip())).toBe('MAD');
  });

  it('tonight: Lisbon usable, Barcelona closed, Madrid via Toronto a missed connection', () => {
    const { tonight } = run();
    const lis = tonight.find(o => o.gateway === 'LIS' && o.itinerary.legs.length === 1)!;
    expect(flights(lis)).toBe('AC812');
    expect(lis.status).toBe('usable');
    expect(lis.reason).toBeNull();
    expect(lis.day).toBe('tonight');

    const bcn = tonight.find(o => o.gateway === 'BCN')!;
    expect(flights(bcn)).toBe('AC822');
    expect(bcn.status).toBe('closed');
    expect(bcn.reason).toBe(CLOSED_REASON);
    expect(bcn.reason).toBe('boarding has likely closed');

    const mad = tonight.find(o => o.gateway === 'MAD')!;
    expect(mad.status).toBe('missedConnection');
    expect(flights(mad)).toBe('AC489+AC824');
    expect(mad.reason).toBe('AC489 lands 19:53, after AC824 leaves at 19:15');

    // AC834 has left: it is not listed at all. A Lisbon one-stop landing after AC812 adds nothing.
    expect(tonight.some(o => o.itinerary.legs[0].flightNumber === 'AC834')).toBe(false);
    expect(tonight.filter(o => o.gateway === 'LIS')).toHaveLength(1);
    // Usable first, then closed, then missed.
    expect(tonight.map(o => o.status)).toEqual(['usable', 'closed', 'missedConnection']);
  });

  it('tomorrow: Madrid AC834 on Fri Oct 9', () => {
    const { tomorrow } = run();
    const mad = tomorrow.find(o => o.gateway === 'MAD')!;
    expect(flights(mad)).toBe('AC834');
    expect(mad.itinerary.dateKey).toBe('2026-10-09');
    expect(mad.status).toBe('usable');
    expect(mad.day).toBe('tomorrow');
    expect(tomorrow[0].gateway).toBe('MAD');
    expect(tomorrow.every(o => o.itinerary.dateKey === '2026-10-09')).toBe(true);
  });

  it('counts nights in Seville and checks the return', () => {
    const { tonight, tomorrow } = run();
    const lis = tonight.find(o => o.gateway === 'LIS')!;
    const mad = tomorrow.find(o => o.gateway === 'MAD')!;
    expect(lis.nightsAtGoal).toBe(3);
    expect(mad.nightsAtGoal).toBe(2);
    expect(lis.returnStillWorks).toBe(true);
    expect(mad.returnStillWorks).toBe(true);
    expect(lis.ground.provenance).toBe('estimated');
    expect(lis.arriveGoalUtc).not.toBeNull();
    // Seville on Friday evening via Lisbon; Saturday around midday via Madrid tomorrow.
    expect(new Date(lis.arriveGoalUtc!).toISOString().slice(0, 10)).toBe('2026-10-09');
    expect(new Date(mad.arriveGoalUtc!).toISOString().slice(0, 10)).toBe('2026-10-10');
  });

  it('says when the return no longer fits', () => {
    const trip = sevilleTrip();
    const ret = trip.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    if (ret.kind === 'flight') ret.refs[0] = { ...ret.refs[0], dateKey: '2026-10-09', arrDateKey: '2026-10-09' };
    const { tomorrow } = stillReachable({ trip, at: 'YUL', nowMs: AT_1805, connect: {} });
    expect(tomorrow.find(o => o.gateway === 'MAD')!.returnStillWorks).toBe(false);
  });

  it('respects an explicit gateway list', () => {
    const { tonight, tomorrow } = stillReachable({
      trip: sevilleTrip(), at: 'YUL', nowMs: AT_1805, connect: {}, gateways: ['LIS'],
    });
    expect([...tonight, ...tomorrow].every(o => o.gateway === 'LIS')).toBe(true);
  });
});

describe('missOneOutbound', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('lists what is left if AC834 leaves without you: AC812 to Lisbon first', () => {
    const r = missOneOutbound(sevilleTrip(), SEVILLE_IDS.outbound, { minConnect: 60 });
    const usable = r.tonight.filter(o => o.status === 'usable');
    expect(flights(usable[0])).toBe('AC812');
    expect(usable[0].gateway).toBe('LIS');
    // AC822 leaves exactly 40 min after AC834: boarding has likely closed.
    expect(r.tonight.find(o => o.gateway === 'BCN')!.status).toBe('closed');
    expect(r.tonight.some(o => o.itinerary.legs[0].flightNumber === 'AC834')).toBe(false);
    expect(r.tomorrow.find(o => o.gateway === 'MAD')!.itinerary.dateKey).toBe('2026-10-09');
  });

  it('is empty for an unknown or ground leg', () => {
    expect(missOneOutbound(sevilleTrip(), 'nope', {})).toEqual({ tonight: [], tomorrow: [] });
    expect(missOneOutbound(sevilleTrip(), SEVILLE_IDS.train, {})).toEqual({ tonight: [], tomorrow: [] });
  });
});
