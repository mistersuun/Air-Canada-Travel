import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import type { MissStep } from '../../../trips/engine/homeby';
import type { Trip } from '../../../trips/model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../../trips/testing/seville-fixture';
import { directItineraries } from '../../../utils/connections';
import { missRows, segmentText, spareText } from './miss-chain.component';
import {
  activeReturnLeg, buildReturnView, deadlineLabel, groundToGateway, joinFlights, otherAirportsHome, returnGateway, triesLabel,
} from './return-model';

const C120 = { minConnect: 120 };

function withoutReturn(): Trip {
  const t = sevilleTrip();
  t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.ret);
  return t;
}

describe('return model (g3)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('labels', () => {
    expect(deadlineLabel(sevilleTrip())).toBe('Home by Tue Oct 13, 22:00');
    expect(deadlineLabel(sevilleTrip(), '12h')).toBe('Home by Tue Oct 13, 10:00 PM');
    expect(triesLabel(1)).toBe('1 try');
    expect(triesLabel(0)).toBe('0 tries');
    expect(joinFlights(['AC813'])).toBe('AC813');
    expect(joinFlights(['AC813', 'AC811'])).toBe('AC813 and AC811');
    expect(joinFlights(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('Use as return adds the Estimated trip from the goal to the return airport, unless one is planned', () => {
    // Inbound through Madrid, no bus to Lisbon yet: flying home from Lisbon needs the trip there.
    const t = withoutReturn();
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.bus);
    const lis = directItineraries('LIS', 'YUL', '2026-10-13')[0];
    const g = groundToGateway(t, lis)!;
    expect(g).toMatchObject({ kind: 'ground', mode: 'bus', provenance: 'estimated', userTimes: null });
    expect(g.from.name).toBe('Seville');
    expect(g.to.code).toBe('LIS');
    expect(g.dateKey).toBe('2026-10-12');                 // a 6h45 bus can't make 11:25 leaving after 06:00
    const mad = directItineraries('MAD', 'YUL', '2026-10-12')[0];
    expect(groundToGateway(t, mad)!.dateKey).toBe('2026-10-12');
    // The saved bus already ends at LIS.
    expect(groundToGateway(withoutReturn(), lis)).toBeNull();
  });

  it('counts from another airport when asked (?retFrom=), and remembers the default', () => {
    const v = buildReturnView(sevilleTrip(), C120, '24h', 'MAD');
    expect(v.gateway).toBe('MAD');
    expect(v.defaultGateway).toBe('LIS');
    expect(v.context).toBe('Seville trip · from Madrid');
  });

  it('the return gateway is the return leg origin, else the inbound airport, else the shortest trip to the goal', () => {
    expect(returnGateway(sevilleTrip())).toBe('LIS');
    expect(activeReturnLeg(sevilleTrip())?.id).toBe(SEVILLE_IDS.ret);
    expect(returnGateway(withoutReturn())).toBe('LIS');            // the bus ends at LIS
    const toMad = withoutReturn();
    toMad.legs = toMad.legs.map(l => (l.kind === 'ground' && l.id === SEVILLE_IDS.bus ? { ...l, to: { ...l.to, code: 'MAD' } } : l));
    expect(returnGateway(toMad)).toBe('MAD');
    const bare = withoutReturn();
    bare.legs = bare.legs.filter(l => l.kind === 'flight');
    expect(returnGateway(bare)).toBe('MAD');                       // the airport the trip came in through
    const inbound = withoutReturn();
    inbound.legs = inbound.legs.filter(l => l.id !== SEVILLE_IDS.bus);
    expect(returnGateway(inbound)).toBe('MAD');                    // the train starts at MAD: not Lisbon, a 6h45 bus away
    const empty = withoutReturn();
    empty.legs = [];
    expect(returnGateway(empty)).toBe('MAD');                      // shortest estimated trip to Seville (train), not nearest
    const dropped = sevilleTrip();
    dropped.legs = dropped.legs.map(l => (l.id === SEVILLE_IDS.ret ? { ...l, status: 'abandoned' } : l));
    expect(activeReturnLeg(dropped)).toBeNull();
  });

  it('matches g3 for the Seville trip with minConnect 120', () => {
    const v = buildReturnView(sevilleTrip(), C120);
    expect(v.context).toBe('Seville trip · from Lisbon');
    expect(v.deadline).toBe('Home by Tue Oct 13, 22:00');
    expect(v.hasReturn).toBe(true);
    expect([v.flyKey, v.startKey]).toEqual(['2026-10-13', '2026-10-12']);
    expect([v.flyTries, v.startTries]).toEqual([2, 4]);
    expect(v.chainTitle).toBe('If you try Tuesday');
    expect(v.covered).toBe(true);
    expect(v.info).toBe('Being in Lisbon by Monday morning adds AC813 and AC811 on Oct 12: 4 tries before the deadline instead of 2.');
    expect(v.others).toEqual([{ code: 'MAD', city: 'Madrid', text: 'Mon: AC835 to YUL, AC825 to YYZ · Tue: AC825 only' }]);

    const rows = missRows(v.steps);
    expect(rows.map(r => r.title)).toEqual([
      'Try 1 · AC813 LIS 11:25 → YUL 13:50',
      'If you miss it · AC811 LIS 13:00 → YYZ 15:55',
      'If you miss both',
    ]);
    expect(rows.map(r => r.lines)).toEqual([
      ['Home with 8h to spare'],
      ['then AC422 YYZ 18:00 → YUL 19:21 · 2 standby legs'],
      ['Next is AC813 Wed Oct 14 · lands after your deadline'],
    ]);
    expect(rows.map(r => r.icon)).toEqual(['plane', 'retry', 'close']);
  });

  it('with minConnect 60 the fallback connects to AC894', () => {
    const rows = missRows(buildReturnView(sevilleTrip(), { minConnect: 60 }).steps);
    expect(rows[1].lines[0]).toBe('then AC894 YYZ 17:30 → YUL 18:52 · 2 standby legs');
  });

  it('a later deadline changes the counts', () => {
    const t = sevilleTrip();
    t.homeBy = { dateKey: '2026-10-13', hhmm: '19:00' };
    const v = buildReturnView(t, C120);
    expect(v.flyTries).toBe(1);
    expect(v.startTries).toBe(3);
    expect(missRows(v.steps).map(r => r.title)).toEqual(['Try 1 · AC813 LIS 11:25 → YUL 13:50', 'If you miss it']);
  });

  it('without a return leg the plan uses the deadline day and the nearest gateway', () => {
    const v = buildReturnView(withoutReturn(), C120);
    expect(v.hasReturn).toBe(false);
    expect(v.gateway).toBe('LIS');
    expect(v.flyKey).toBe('2026-10-13');
    expect([v.flyTries, v.startTries]).toEqual([2, 4]);
    expect(v.others.map(o => o.code)).toEqual(['MAD']);
  });

  it('a day outside coverage is reported as not covered', () => {
    const t = sevilleTrip();
    t.outboundDate = '2027-10-01';
    t.homeBy = { dateKey: '2027-10-05', hhmm: '22:00' };
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.ret);
    const v = buildReturnView(t, C120);
    expect(v.covered).toBe(false);
    expect(v.flyTries).toBe(0);
    expect(missRows(v.steps)).toEqual([expect.objectContaining({ title: 'No try found before your deadline' })]);
  });

  it('other airports skip gateways with unknown onward travel (CMN for Seville)', () => {
    expect(otherAirportsHome(sevilleTrip(), 'LIS', ['2026-10-12', '2026-10-13']).map(r => r.code)).not.toContain('CMN');
  });

  it('other airports skip the return gateway, home hubs and airports with nothing', () => {
    const rows = otherAirportsHome(sevilleTrip(), 'MAD', ['2026-10-13']);
    expect(rows.map(r => r.code)).toEqual(['LIS']);
    expect(rows[0].text).toBe('Tue: AC813 to YUL, AC811 to YYZ');
    // A lone flight names where it goes unless the row already did.
    expect(otherAirportsHome(sevilleTrip(), 'LIS', ['2026-10-13'])[0].text).toBe('Tue: AC825 to YYZ only');
  });
});

describe('missRows', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('renders any MissStep list', () => {
    const [ac813] = directItineraries('LIS', 'YUL', '2026-10-13');
    const [ac834] = directItineraries('YUL', 'MAD', '2026-10-08');
    const steps: MissStep[] = [
      { label: 'Try 1', itinerary: ac834, kind: 'try', slackMin: 45 },
      { label: 'If you miss it', itinerary: null, kind: 'late', slackMin: null },
    ];
    const rows = missRows(steps, { arrive: 'Madrid', lateNote: 'x' });
    expect(rows[0].title).toBe('Try 1 · AC834 YUL 17:55 → MAD 06:50⁺¹');
    expect(rows[0].lines).toEqual(['Madrid with 45 min to spare']);
    expect(rows[1].lines).toEqual(['Nothing later found in our schedule data']);
    expect(missRows([{ label: 'Try 1', itinerary: ac813, kind: 'try', slackMin: 0 }])[0].lines).toEqual(['Home right at your deadline']);
    expect(segmentText(ac813.legs[0], '12h')).toBe('AC813 LIS 11:25 AM → YUL 1:50 PM');
    expect(spareText(490)).toBe('8h');
    expect(missRows([])).toEqual([]);
  });
});
