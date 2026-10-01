import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { SEVILLE_META, SEVILLE_PLACE, SEVILLE_ROUTES } from '../trips/testing/seville-fixture';
import type { ConnectOptions } from '../utils/connections';
import { utcToLocal } from '../utils/time';
import { ReachQuery, gatewaysNear, homeOptionsByAirport, reachGateways } from './reach';
import { placeFromDestination } from './place';

const CONNECT: ConnectOptions = Object.freeze({ minConnect: 60 });
const q = (over: Partial<ReachQuery> = {}): ReachQuery => ({
  place: SEVILLE_PLACE, hub: 'YUL', dateKey: '2026-10-08', includeOtherHubs: false, sort: 'onward', connect: CONNECT, ...over,
});
const flightNos = (its: { legs: { flightNumber: string | null }[] }[]) => its.map(i => i.legs.map(l => l.flightNumber).join('+'));

beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
afterEach(() => resetScheduleSource());

describe('gatewaysNear', () => {
  it('lists AC airports within 900 km of Seville, nearest first', () => {
    const near = gatewaysNear(SEVILLE_PLACE);
    const codes = near.map(n => n.code);
    for (const c of ['LIS', 'MAD', 'OPO', 'CMN', 'BCN']) expect(codes).toContain(c);
    expect(codes.indexOf('LIS')).toBeLessThan(codes.indexOf('BCN'));
    expect(near.find(n => n.code === 'BCN')!.km).toBeGreaterThan(780);
    expect(near.every(n => n.km <= 900)).toBe(true);
    expect(codes).not.toContain('LHR');
    expect(gatewaysNear(SEVILLE_PLACE, 400).map(n => n.code)).not.toContain('BCN');
  });

  it("excludes the place's own airport", () => {
    expect(gatewaysNear(placeFromDestination('LIS'), 50).map(n => n.code)).toEqual([]);
  });
});

describe('reachGateways (Seville from YUL, Thu Oct 8)', () => {
  it('orders gateways with a flight by arrival in Seville, then the idle ones', () => {
    const { gateways, unknownOnward } = reachGateways(q());
    expect(gateways.map(g => g.code)).toEqual(['MAD', 'BCN', 'LIS', 'OPO']);

    const [mad, bcn, lis, opo] = gateways;
    expect(mad.city).toBe('Madrid');
    expect(flightNos(mad.itineraries)).toEqual(['AC834']);
    expect(mad.itineraries[0].legs[0].depLocal).toBe('17:55');
    expect(mad.directCount).toBe(1);
    expect(mad.standbyLegs).toBe(1);
    expect(mad.covered).toBe(true);
    expect(mad.ground.label).toBe('Train about 2h40');
    expect(mad.ground.exitLabel).toBe('Passport, exit, get to Atocha');
    expect(mad.ground.exitMin).toBe(90);
    expect(mad.ground.provenance).toBe('estimated');
    expect(utcToLocal(mad.arriveGoalUtc!, 'Europe/Madrid')).toEqual({ dateKey: '2026-10-09', hhmm: '11:00' });
    expect(mad.overnightLikely).toBe(false);

    expect(flightNos(lis.itineraries)).toEqual(['AC812']);
    expect(lis.itineraries[0].legs[0].depLocal).toBe('21:45');
    expect(lis.ground.label).toBe('Bus about 6h45');
    expect(flightNos(bcn.itineraries)).toEqual(['AC822']);
    expect(bcn.ground.label).toBe('Train about 6h20, or a short flight');
    expect(bcn.arriveGoalUtc!).toBeLessThan(lis.arriveGoalUtc!);

    expect(opo.itineraries).toEqual([]);
    expect(opo.nextDateKey).toBe('2026-10-09');
    expect(opo.standbyLegs).toBe(0);
    expect(opo.arriveGoalUtc).toBeNull();

    expect(unknownOnward.map(g => g.code)).toContain('CMN');
    expect(unknownOnward.every(g => g.ground.mode === 'unknown')).toBe(true);
  });

  it("'flights' sort ranks by number of itineraries, then arrival", () => {
    const { gateways } = reachGateways(q({ sort: 'flights', includeOtherHubs: true }));
    const counts = gateways.filter(g => g.itineraries.length).map(g => g.itineraries.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(gateways[0].code).toBe('LIS'); // AC812 plus the via-Toronto options
    expect(gateways[gateways.length - 1].code).toBe('OPO');
  });

  it('includes one-stop itineraries via another Canadian hub with 2 standby legs', () => {
    const { gateways } = reachGateways(q({ includeOtherHubs: true }));
    const lis = gateways.find(g => g.code === 'LIS')!;
    const via = lis.itineraries.filter(i => i.legs.length === 2);
    expect(via.length).toBeGreaterThan(0);
    expect(via.every(i => i.hubs[0] === 'YYZ')).toBe(true);
    expect(flightNos(via)).toContain('AC427+AC810');
    // Nonstops stay first.
    expect(lis.itineraries[0].legs.length).toBe(1);
    expect(lis.standbyLegs).toBe(1);
    expect(lis.directCount).toBe(1);
    // AC824 leaves YYZ at 19:15: no YUL feeder makes it on the 8th with a 60 min connection.
    const mad = gateways.find(g => g.code === 'MAD')!;
    expect(flightNos(mad.itineraries)).toEqual(['AC834']);
  });

  it('a gateway reached only via a hub has standbyLegs 2', () => {
    // From YYZ there is no nonstop to OPO in the fixture; via YUL there is (Fri, 38 min connection).
    const { gateways } = reachGateways(q({
      hub: 'YYZ', dateKey: '2026-10-09', includeOtherHubs: true, connect: { minConnect: 30 },
    }));
    const opo = gateways.find(g => g.code === 'OPO')!;
    expect(flightNos(opo.itineraries)).toEqual(['AC894+AC928']);
    expect(opo.standbyLegs).toBe(2);
    expect(opo.directCount).toBe(0);
    expect(opo.ground.label).toBe('Bus about 9h');
    // Without other hubs, OPO has no flight from YYZ at all.
    const direct = reachGateways(q({ hub: 'YYZ', dateKey: '2026-10-09' })).gateways.find(g => g.code === 'OPO')!;
    expect(direct.itineraries).toEqual([]);
    expect(direct.nextDateKey).toBeNull();
  });

  it('respects maxGateways and outside-coverage dates', () => {
    expect(reachGateways(q({ maxGateways: 2 })).gateways.map(g => g.code)).toEqual(['MAD', 'BCN']);
    const far = reachGateways(q({ dateKey: '2028-01-05' }));
    expect(far.gateways.every(g => !g.covered && g.itineraries.length === 0)).toBe(true);
  });

  it('never offers the hub itself', () => {
    const yul = { ...SEVILLE_PLACE, lat: 45.5, lng: -73.6, iso2: 'CA', id: 'gn-6077243' };
    expect(reachGateways(q({ place: yul })).gateways.map(g => g.code)).not.toContain('YUL');
  });
});

describe('homeOptionsByAirport', () => {
  it('lists direct flights home per airport and day', () => {
    const r = homeOptionsByAirport(['MAD', 'LIS'], ['YUL', 'YYZ'], ['2026-10-12', '2026-10-13']);
    const mad = r.find(x => x.code === 'MAD')!;
    expect(mad.days.map(d => d.flights.map(f => `${f.flightNumber}>${f.dest}`))).toEqual([
      ['AC835>YUL', 'AC825>YYZ'],
      ['AC825>YYZ'],
    ]);
    const lis = r.find(x => x.code === 'LIS')!;
    expect(lis.days[1].flights.map(f => f.flightNumber)).toEqual(['AC813', 'AC811']);
  });
});
