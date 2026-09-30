import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../data/testing/schedule-fixtures';
import {
  HUB_PAIR_MINUTES,
  allItineraries,
  bestItinerary,
  directItineraries,
  estimatedInstance,
  estimatesAllowed,
  findAlternatives,
  findConnections,
  findConnectionsForWeek,
  findItineraries,
  findReturnOptions,
  formatLayover,
  getBestConnection,
  hasSegment,
  isLayoverAlert,
  segmentFlights,
  summarizeWeek,
  toConnectionOption,
} from './connections';

beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
afterEach(() => resetScheduleSource());

describe('findItineraries: layovers in UTC', () => {
  it('YVR→YUL→LHR: rejects the 20-minute connection the old local-time math called 3h20', () => {
    const viaYul = findItineraries('YVR', 'LHR', '2026-10-01').filter(i => i.hubs[0] === 'YUL');
    expect(viaYul).toHaveLength(1);
    // 10:00 PDT + 4h50 = 17:50 EDT; AC864 leaves 22:10 EDT → 4h20.
    expect(viaYul[0].legs[0].depLocal).toBe('10:00');
    expect(viaYul[0].layovers).toEqual([260]);
    // The 14:00 PDT leg lands 21:50 EDT: only a 20-minute connection.
    const loose = findItineraries('YVR', 'LHR', '2026-10-01', { minConnect: 15 }).filter(i => i.hubs[0] === 'YUL');
    expect(loose[0].legs[0].depLocal).toBe('14:00');
    expect(loose[0].layovers).toEqual([20]);
  });

  it('marks invented legs as estimated with no flight number or aircraft', () => {
    const it0 = findItineraries('YVR', 'LHR', '2026-10-01')[0];
    expect(it0.estimated).toBe(true);
    expect(it0.legs[0]).toMatchObject({ estimated: true, flightNumber: null, aircraft: null });
    expect(it0.legs[1]).toMatchObject({ estimated: false, flightNumber: 'AC848' });
  });

  it('ranks by arrival, not by shortest layover', () => {
    const its = findItineraries('YVR', 'LHR', '2026-10-01');
    expect(its.map(i => i.hubs[0])).toEqual(['YYZ', 'YUL']);
    expect(its[0].layovers[0]).toBe(85);
    expect(its[0].arriveUtc).toBeLessThan(its[1].arriveUtc);
    expect(bestItinerary('YVR', 'LHR', '2026-10-01')).toBe(its[0]);
  });

  it('YYZ→YVR→SYD across three zones and the date line', () => {
    const [it0] = findItineraries('YYZ', 'SYD', '2026-12-01');
    expect(it0.hubs).toEqual(['YVR']);
    // 19:00 EST + 5h05 = 22:05 at YVR (UTC−7 all winter from Nov 2026); AC33 at
    // 23:40 → 1h35. The 21:00 leg would land after AC33 leaves.
    expect(it0.legs[0].depLocal).toBe('19:00');
    expect(it0.legs[0].arrLocal).toBe('22:05');
    expect(it0.layovers).toEqual([95]);
    expect(it0.arrDayOffset).toBe(2);
    expect(it0.totalMin).toBe(305 + 95 + 930);
  });

  it('uses real hub-to-hub schedules before estimated ones', () => {
    const its = findItineraries('YHZ', 'LHR', '2026-10-05');
    expect(its[0].hubs).toEqual(['YYZ']);
    expect(its[0].estimated).toBe(false);
    expect(its[0].legs.map(l => l.flightNumber)).toEqual(['AC603', 'AC848']);
    expect(its[0].layovers).toEqual([150]);
    // Via YUL has the shorter layover (80m) but arrives later, so it ranks second.
    expect(its[1].hubs).toEqual(['YUL']);
    expect(its[1].layovers).toEqual([80]);
  });

  it('does not fall back to estimated legs when a real hub pair exists but not that day', () => {
    setScheduleSource([
      route('YHZ', 'YYZ', rec('AC603', '14:00', '15:30', '2026-10-01', '2026-10-31', 'Mon')),
      route('YYZ', 'LHR', rec('AC848', '18:00', '06:15', '2026-10-01', '2026-10-31')),
    ]);
    expect(segmentFlights('YHZ', 'YYZ', '2026-10-06')).toEqual([]);
    expect(findItineraries('YHZ', 'LHR', '2026-10-06')).toEqual([]);
    expect(findItineraries('YHZ', 'LHR', '2026-10-05')).toHaveLength(1);
  });

  it('never invents a hub leg once the data publishes hub-to-hub legs (meta.hubToHub)', () => {
    const world = [
      route('YHZ', 'YYZ', rec('AC603', '14:00', '15:30', '2026-10-01', '2026-10-31')),
      route('YYZ', 'LHR', rec('AC848', '18:00', '06:15', '2026-10-01', '2026-10-31')),
      route('YOW', 'LHR', rec('AC5', '18:00', '06:15', '2026-10-01', '2026-10-31')),
    ];
    // Without the domestic PDFs, YHZ→YOW (no real nonstop) is estimated.
    setScheduleSource(world, { coverageFrom: '2026-10-01', coverageTo: '2026-10-31' });
    expect(estimatesAllowed()).toBe(true);
    expect(findItineraries('YHZ', 'LHR', '2026-10-05').some(i => i.hubs[0] === 'YOW' && i.estimated)).toBe(true);
    // With them, a missing pair is simply not flown.
    setScheduleSource(world, { coverageFrom: '2026-10-01', coverageTo: '2026-10-31', hubToHub: true });
    expect(estimatesAllowed()).toBe(false);
    expect(hasSegment('YHZ', 'YOW')).toBe(false);
    expect(segmentFlights('YHZ', 'YOW', '2026-10-05')).toEqual([]);
    const its = findItineraries('YHZ', 'LHR', '2026-10-05');
    expect(its.map(i => i.hubs[0])).toEqual(['YYZ']);
    expect(its.some(i => i.estimated)).toBe(false);
  });

  it('offers no connections outside the home hub published window (as the modal)', () => {
    // YWG's only records start 11-01, so October is "not yet published" for YWG;
    // the estimated YWG→YYZ leg must not produce October cards there.
    setScheduleSource([
      route('YWG', 'CUN', rec('AC1480', '08:00', '13:00', '2026-11-01', '2026-11-30')),
      route('YYZ', 'LHR', rec('AC848', '18:00', '06:15', '2026-10-01', '2026-11-30')),
    ]);
    expect(summarizeWeek('YWG', 'LHR', '2026-10-05').connectDays).toBe(0);
    expect(summarizeWeek('YWG', 'LHR', '2026-11-02').connectDays).toBe(7);
  });

  describe('layover edges', () => {
    const world = (leg2Dep: string) => setScheduleSource([
      route('YHZ', 'YYZ', rec('AC603', '14:00', '15:30', '2026-10-01', '2026-10-31')),
      route('YYZ', 'LHR', rec('AC999', leg2Dep, '09:00', '2026-10-01', '2026-10-31')),
    ]);

    it('accepts exactly the minimum connection and rejects a minute less', () => {
      world('16:30');
      expect(findItineraries('YHZ', 'LHR', '2026-10-05')[0].layovers).toEqual([60]);
      world('16:29');
      expect(findItineraries('YHZ', 'LHR', '2026-10-05')).toEqual([]);
    });

    it('accepts exactly the maximum layover and rejects a minute more', () => {
      world('21:30');
      expect(findItineraries('YHZ', 'LHR', '2026-10-05')[0].layovers).toEqual([360]);
      world('21:31');
      expect(findItineraries('YHZ', 'LHR', '2026-10-05')).toEqual([]);
      expect(findItineraries('YHZ', 'LHR', '2026-10-05', { maxLayover: 400 })[0].layovers).toEqual([361]);
    });
  });

  it('only crosses midnight at the hub when overnight layovers are allowed', () => {
    expect(findItineraries('YWG', 'DEL', '2026-10-05')).toEqual([]);
    const [it0] = findItineraries('YWG', 'DEL', '2026-10-05', { allowOvernight: true });
    // 18:00 CDT + 2h40 = 21:40 EDT; AC42 leaves 00:30 EDT the next day.
    expect(it0.legs[0].depLocal).toBe('18:00');
    expect(it0.legs[1].dateKey).toBe('2026-10-06');
    expect(it0.layovers).toEqual([170]);
    expect(it0.dateKey).toBe('2026-10-05');
  });

  it('keeps an overnight second leg that lands the next day', () => {
    const its = findItineraries('YHZ', 'LHR', '2026-10-05');
    expect(its.every(i => i.arrDayOffset === 1)).toBe(true);
    expect(its[0].arrDateKey).toBe('2026-10-06');
  });

  it('returns nothing for an unknown home, home == dest, or dest == hub', () => {
    expect(findItineraries('XXX', 'LHR', '2026-10-05')).toEqual([]);
    expect(findItineraries('YUL', 'YUL', '2026-10-05')).toEqual([]);
    // YHZ→YYZ would need two invented legs (via YUL or YOW): never offered.
    expect(findItineraries('YHZ', 'YYZ', '2026-10-05')).toEqual([]);
  });

  it('honours avoidHubs and viaHubs', () => {
    expect(findItineraries('YHZ', 'LHR', '2026-10-05', { avoidHubs: ['YYZ'] }).map(i => i.hubs[0])).toEqual(['YUL']);
    expect(findItineraries('YHZ', 'LHR', '2026-10-05', { viaHubs: ['YYZ'] }).map(i => i.hubs[0])).toEqual(['YYZ']);
  });

  it('keeps every reachable onward flight as a separate option', () => {
    setScheduleSource([
      route('YHZ', 'YYZ', rec('AC603', '14:00', '15:30', '2026-10-01', '2026-10-31')),
      route('YYZ', 'LHR',
        rec('AC848', '18:00', '06:15', '2026-10-01', '2026-10-31'),
        rec('AC858', '20:00', '08:15', '2026-10-01', '2026-10-31')),
    ]);
    const its = findItineraries('YHZ', 'LHR', '2026-10-05');
    expect(its.map(i => i.legs[1].flightNumber)).toEqual(['AC848', 'AC858']);
  });
});

describe('segments and helpers', () => {
  it('builds estimated legs in both zones', () => {
    const leg = estimatedInstance('YVR', 'YUL', '2026-10-01', '14:00', 290);
    expect(leg).toMatchObject({ arrLocal: '21:50', arrDateKey: '2026-10-01', arrDayOffset: 0, estimated: true });
    const late = estimatedInstance('YVR', 'YUL', '2026-10-01', '20:00', 290);
    expect(late).toMatchObject({ arrLocal: '03:50', arrDayOffset: 1 });
  });

  it('exposes hub pair minutes and segments', () => {
    expect(HUB_PAIR_MINUTES['YUL-YYZ']).toBe(80);
    expect(hasSegment('YUL', 'YYZ')).toBe(true);
    expect(hasSegment('YUL', 'LHR')).toBe(true);
    expect(hasSegment('YUL', 'ZZZ')).toBe(false);
    const seg = segmentFlights('YUL', 'YYZ', '2026-10-05');
    expect(seg).toHaveLength(16);
    expect(seg.every(s => s.estimated)).toBe(true);
    expect(segmentFlights('YUL', 'YYZ', '2026-10-05')).toBe(seg); // cached
  });

  it('wraps direct flights and merges them with connections', () => {
    expect(directItineraries('YUL', 'ATH', '2026-10-05').map(i => i.legs[0].flightNumber)).toEqual(['AC898', 'AC922']);
    const all = allItineraries('YHZ', 'LHR', '2026-10-05');
    expect(all.length).toBe(2);
  });

  it('flags layovers under the minimum or over six hours', () => {
    expect(isLayoverAlert(45)).toBe(true);
    expect(isLayoverAlert(90)).toBe(false);
    expect(isLayoverAlert(361)).toBe(true);
    expect(isLayoverAlert(50, 45)).toBe(false);
    expect(formatLayover(105)).toBe('1h 45m');
  });
});

describe('summarizeWeek', () => {
  it('counts direct and connection days and the hubs used', () => {
    const s = summarizeWeek('YHZ', 'LHR', '2026-10-05');
    expect(s.days).toHaveLength(7);
    expect(s.directDays).toBe(0);
    expect(s.connectDays).toBe(7);
    expect(s.connectOnlyDays).toBe(7);
    expect(s.hubs).toEqual(['YYZ']);
    expect(s.estimated).toBe(false);
    expect(s.days[0].best?.hubs).toEqual(['YYZ']);
  });

  it('applies optional predicates', () => {
    const s = summarizeWeek('YHZ', 'LHR', '2026-10-05', {}, () => true, { key: 'est', keep: it => it.estimated });
    expect(s.hubs).toEqual(['YUL']);
    expect(s.estimated).toBe(true);
  });
});

describe('findReturnOptions', () => {
  it('counts nights from the outbound arrival date', () => {
    // AC864 leaves Mon Oct 5 22:10 and lands Tue Oct 6: 4 nights → Sat Oct 10.
    const [opt] = findReturnOptions('LHR', 'YUL', '2026-10-05', [4]);
    expect(opt.dateKey).toBe('2026-10-10');
    expect(opt.nights).toBe(4);
    expect(opt.itineraries[0].legs[0].flightNumber).toBe('AC865');
  });

  it('accepts a chosen outbound itinerary', () => {
    const out = directItineraries('YUL', 'LHR', '2026-10-05')[0];
    const opts = findReturnOptions('LHR', 'YUL', out, [2, 3]);
    expect(opts.map(o => o.dateKey)).toEqual(['2026-10-08', '2026-10-09']);
  });

  it('connects home through a hub with an estimated domestic leg', () => {
    const [opt] = findReturnOptions('LHR', 'YHZ', '2026-10-05', [3]);
    expect(opt.dateKey).toBe('2026-10-09');
    const first = opt.itineraries[0];
    expect(first.hubs).toEqual(['YUL']);
    expect(first.legs[0].flightNumber).toBe('AC865');
    expect(first.legs[1].estimated).toBe(true);
    // AC865 lands 14:35 EDT; the 17:00 YUL→YHZ leg gives 2h25.
    expect(first.layovers).toEqual([145]);
  });

  it('falls back to the given date when there is no outbound', () => {
    const [opt] = findReturnOptions('ATH', 'YUL', '2026-10-06', [1]);
    expect(opt.dateKey).toBe('2026-10-07');
    expect(opt.itineraries).toEqual([]);
  });
});

describe('findAlternatives', () => {
  it('lists later options through other hubs and the next day', () => {
    const [viaYyz] = findItineraries('YHZ', 'LHR', '2026-10-05');
    const alt = findAlternatives('YHZ', 'LHR', viaYyz);
    expect(alt.laterSameRoute).toEqual([]);
    expect(alt.otherHubsSameDay.map(i => i.hubs)).toEqual([['YUL']]);
    expect(alt.nextDayFirst?.dateKey).toBe('2026-10-06');
    expect(alt.nextDayFirst?.hubs).toEqual(['YYZ']);
  });

  it('lists later direct flights on the same route', () => {
    const [ac898] = directItineraries('YUL', 'ATH', '2026-10-05');
    const alt = findAlternatives('YUL', 'ATH', ac898);
    expect(alt.laterSameRoute.map(i => i.legs[0].flightNumber)).toEqual(['AC922']);
    expect(alt.nextDayFirst).toBeNull(); // no Tuesday flights
  });
});

describe('deprecated adapters', () => {
  it('maps itineraries to the old ConnectionOption shape', () => {
    const [c] = findConnections('YHZ', 'LHR', new Date(2026, 9, 5));
    expect(c.viaHub).toBe('YYZ');
    expect(c.viaHubName).toBe('Toronto');
    expect(c.leg1.flightNumber).toBe('AC603');
    expect(c.layoverMinutes).toBe(150);
    expect(c.destination.code).toBe('LHR');
    expect(c.date.getDate()).toBe(5);
    const est = findConnections('YHZ', 'LHR', '2026-10-05')[1];
    expect(est.leg1.flightNumber).toBe('');
    expect(est.leg1.aircraft).toBe('');
  });

  it('keeps the week and best-connection helpers', () => {
    expect(findConnectionsForWeek('YHZ', 'LHR', '2026-10-05')).toBe(true);
    expect(findConnectionsForWeek('YHZ', 'SYD', '2026-10-05')).toBe(false);
    expect(getBestConnection('YHZ', 'LHR', '2026-10-05')?.viaHub).toBe('YYZ');
    expect(getBestConnection('YHZ', 'SYD', '2026-10-05')).toBeNull();
  });

  it('returns null for direct or unknown-destination itineraries', () => {
    expect(toConnectionOption(directItineraries('YUL', 'ATH', '2026-10-05')[0])).toBeNull();
  });
});
