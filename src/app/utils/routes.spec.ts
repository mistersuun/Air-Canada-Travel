import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESTINATIONS } from '../data/destinations';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../data/testing/schedule-fixtures';
import {
  ComputeRoutesParams,
  EMPTY_FILTERS,
  RouteEntry,
  STARRED_REGION,
  activeFilterCount,
  computeRoutes,
  hubStats,
  matchesQuery,
  monthAvailability,
  normalizeText,
} from './routes';

const codes = (rs: RouteEntry[]) => rs.map(r => r.destination.code);
const base: ComputeRoutesParams = {
  home: 'YUL',
  weekStartKey: '2026-10-05',
  dateKey: null,
  region: 'All',
  showConnections: true,
};

beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
afterEach(() => resetScheduleSource());

describe('computeRoutes: week mode', () => {
  it('lists direct routes first, then connecting ones', () => {
    const rs = computeRoutes(base);
    expect(codes(rs)).toEqual(['ATH', 'LHR', 'SYD']);
    expect(rs.map(r => r.isDirect)).toEqual([true, true, false]);
  });

  it('carries every flight of the week and per-day segments', () => {
    const ath = computeRoutes(base)[0];
    expect(ath.weekDays.map(d => d.flights.length)).toEqual([2, 0, 2, 0, 2, 0, 0]);
    expect(ath.flights).toHaveLength(6);
    expect(ath.daysFlying).toBe(3);
  });

  it('gives connecting routes a week summary and a legacy bestConnection', () => {
    const syd = computeRoutes(base)[2];
    expect(syd.weekSummary?.connectDays).toBe(7);
    expect(syd.weekSummary?.hubs).toEqual(['YVR']);
    expect(syd.weekSummary?.estimated).toBe(true);
    expect(syd.bestConnection?.viaHub).toBe('YVR');
    expect(syd.daysFlying).toBe(7);
  });

  it('gives direct routes connection data for their non-direct days', () => {
    setScheduleSource([
      ...FIXTURE_ROUTES,
      route('YYZ', 'ATH', rec('AC872', '18:00', '11:00', '2026-10-01', '2026-10-31', 'Tue')),
    ]);
    const ath = computeRoutes(base).find(r => r.destination.code === 'ATH')!;
    expect(ath.isDirect).toBe(true);
    expect(ath.weekSummary?.days[1]).toMatchObject({ direct: 0, connections: 1 });
  });

  it('omits connections when they are hidden', () => {
    expect(codes(computeRoutes({ ...base, showConnections: false }))).toEqual(['ATH', 'LHR']);
    expect(computeRoutes({ ...base, showConnections: false })[0].weekSummary).toBeUndefined();
  });

  it('shows nothing for a week outside the data', () => {
    expect(computeRoutes({ ...base, weekStartKey: '2020-01-06' })).toEqual([]);
  });
});

describe('computeRoutes: day mode', () => {
  it('keeps only destinations served that day', () => {
    const rs = computeRoutes({ ...base, dateKey: '2026-10-06' });
    expect(codes(rs)).toEqual(['LHR', 'SYD']);
    const syd = rs[1];
    expect(syd.itinerary?.hubs).toEqual(['YVR']);
    expect(syd.itineraries?.length).toBeGreaterThan(0);
    expect(syd.bestConnection?.itinerary).toBe(syd.itinerary);
  });

  it('lists every flight of a double day', () => {
    const ath = computeRoutes({ ...base, dateKey: '2026-10-05' })[0];
    expect(ath.flights.map(f => f.flightNumber)).toEqual(['AC898', 'AC922']);
  });
});

describe('computeRoutes: filters, search and sort', () => {
  it('filters by region and starred', () => {
    expect(codes(computeRoutes({ ...base, region: 'Europe' }))).toEqual(['ATH', 'LHR']);
    expect(codes(computeRoutes({ ...base, region: STARRED_REGION, favourites: ['SYD'] }))).toEqual(['SYD']);
    expect(codes(computeRoutes({ ...base, favourites: ['LHR'], filters: { starredOnly: true } }))).toEqual(['LHR']);
  });

  it('sorts starred destinations first within each group', () => {
    const rs = computeRoutes({ ...base, favourites: ['LHR'] });
    expect(codes(rs)).toEqual(['LHR', 'ATH', 'SYD']);
    expect(rs[0].isFavourite).toBe(true);
  });

  it('searches accent-insensitively over city, country and code', () => {
    expect(codes(computeRoutes({ ...base, query: 'greece' }))).toEqual(['ATH']);
    expect(codes(computeRoutes({ ...base, query: 'lhr' }))).toEqual(['LHR']);
    expect(codes(computeRoutes({ ...base, query: '  ' }))).toEqual(['ATH', 'LHR', 'SYD']);
    const gru = DESTINATIONS.find(d => d.code === 'GRU')!;
    expect(matchesQuery(gru, 'sao paulo')).toBe(true);
    expect(matchesQuery(gru, 'São')).toBe(true);
    expect(matchesQuery(gru, 'paris')).toBe(false);
    expect(normalizeText(' Montréal ')).toBe('montreal');
  });

  it('finds destinations by state, airport, island and trip-type words', () => {
    const d = (c: string) => DESTINATIONS.find(x => x.code === c)!;
    expect(matchesQuery(d('HNL'), 'Hawaii')).toBe(true);
    expect(matchesQuery(d('OGG'), 'hawaii')).toBe(true);
    expect(matchesQuery(d('KOA'), 'HI')).toBe(true);
    expect(matchesQuery(d('MIA'), 'Florida')).toBe(true);
    expect(matchesQuery(d('MCO'), 'florida')).toBe(true);
    expect(matchesQuery(d('LAX'), 'Florida')).toBe(false);
    expect(matchesQuery(d('LHR'), 'Heathrow')).toBe(true);
    expect(matchesQuery(d('MAN'), 'Heathrow')).toBe(false);
    expect(matchesQuery(d('CUN'), 'Quintana Roo')).toBe(true);
    expect(matchesQuery(d('SXM'), 'saint martin')).toBe(true);
    expect(matchesQuery(d('PUJ'), 'beach')).toBe(true);
    expect(matchesQuery(d('LHR'), 'beach')).toBe(false);
    expect(matchesQuery(d('LHR'), 'city')).toBe(true);
    expect(matchesQuery(d('ANC'), 'adventure')).toBe(true);
    expect(matchesQuery(d('DEN'), 'ski')).toBe(true);
    expect(matchesQuery(d('MIA'), 'ski')).toBe(false);
    // Every word must match, mixing city and alias words.
    expect(matchesQuery(d('MIA'), 'miami florida')).toBe(true);
    expect(matchesQuery(d('MIA'), 'orlando florida')).toBe(false);
    // Alias words of up to two letters match whole: 'fl' is Florida, but 'w' is not Washington's 'wa'.
    expect(matchesQuery(d('MCO'), 'fl')).toBe(true);
    expect(matchesQuery(d('SEA'), 'wa')).toBe(true);
    expect(matchesQuery(d('SEA'), 'w')).toBe(false);
    // Punctuation reads as a space, in the query and the aliases.
    expect(matchesQuery(d('ORD'), "O'Hare")).toBe(true);
    expect(matchesQuery(d('SEA'), 'Sea-Tac')).toBe(true);
    expect(matchesQuery(d('SEA'), 'sea tac')).toBe(true);
    // Dropped as too generic.
    expect(matchesQuery(d('PEK'), 'capital')).toBe(false);
    expect(matchesQuery(d('MSY'), 'la')).toBe(false);
  });

  it('filters by departure window', () => {
    const day = { ...base, dateKey: '2026-10-05' };
    expect(codes(computeRoutes({ ...day, filters: { departWindows: ['evening'] } }))).toEqual(['ATH', 'SYD']);
    expect(codes(computeRoutes({ ...day, filters: { departWindows: ['redeye'] } }))).toEqual(['LHR']);
    // No direct flight leaves in the morning, but a morning YUL→YYZ feeder makes AC848 to LHR.
    expect(codes(computeRoutes({ ...day, filters: { departWindows: ['morning'] } }))).toEqual(['LHR']);
    expect(codes(computeRoutes({ ...day, showConnections: false, filters: { departWindows: ['morning'] } }))).toEqual([]);
  });

  it('applies the depart-window filter before choosing a feeder for a connection', () => {
    // YUL→YYZ is estimated hourly; the latest feeder into AC848 leaves 15:00,
    // but the 11:00 feeder (340 min layover) also makes it and is a morning departure.
    setScheduleSource([route('YYZ', 'LHR', rec('AC848', '18:00', '06:15', '2026-10-01', '2026-10-31', undefined, '789'))], FIXTURE_META);
    const rs = computeRoutes({ ...base, dateKey: '2026-10-06', filters: { departWindows: ['morning'] } });
    const lhr = rs.find(r => r.destination.code === 'LHR')!;
    expect(lhr).toBeDefined();
    expect(lhr.itinerary?.legs[0].depLocal).toBe('11:00');
    expect(lhr.itinerary?.layovers).toEqual([340]);
    // Unfiltered, the shortest (latest-feeder) option is still preferred.
    const plain = computeRoutes({ ...base, dateKey: '2026-10-06' }).find(r => r.destination.code === 'LHR')!;
    expect(plain.itinerary?.legs[0].depLocal).toBe('15:00');
    // Week mode sees the same filtered connections.
    const week = computeRoutes({ ...base, filters: { departWindows: ['morning'] } }).find(r => r.destination.code === 'LHR')!;
    expect(week.weekSummary?.connectDays).toBe(7);
  });

  it('counts connection days (not direct days) for connecting routes in day mode', () => {
    const syd = computeRoutes({ ...base, dateKey: '2026-10-06' }).find(r => r.destination.code === 'SYD')!;
    expect(syd.daysFlying).toBe(7);
  });

  it('filters to same-day arrivals', () => {
    expect(computeRoutes({ ...base, filters: { sameDayArrival: true } })).toEqual([]);
  });

  it('filters to widebodies', () => {
    setScheduleSource([...FIXTURE_ROUTES, route('YUL', 'BOS', rec('AC8', '10:00', '11:30', '2026-10-01', '2026-10-31', undefined, '223'))]);
    expect(codes(computeRoutes(base))).toContain('BOS');
    expect(codes(computeRoutes({ ...base, filters: { widebodyOnly: true } }))).not.toContain('BOS');
  });

  it('filters by max flight time, and counts it as an active filter', () => {
    expect(computeRoutes({ ...base, filters: { maxHours: 1 } })).toEqual([]);
    expect(codes(computeRoutes({ ...base, filters: { maxHours: 12 } }))).toEqual(expect.arrayContaining(['ATH', 'LHR']));
    expect(codes(computeRoutes({ ...base, dateKey: '2026-10-05', filters: { maxHours: 12 } }))).toEqual(expect.arrayContaining(['ATH', 'LHR']));
    expect(codes(computeRoutes({ ...base, dateKey: '2026-10-05', filters: { maxHours: 1 } }))).toEqual([]);
    expect(activeFilterCount({ maxHours: 5 })).toBe(1);
    expect(activeFilterCount({ maxHours: null })).toBe(0);
  });

  it('filters by type and via hub', () => {
    expect(computeRoutes({ ...base, filters: { types: ['Sun'] } })).toEqual([]);
    expect(codes(computeRoutes({ ...base, filters: { types: ['City'] } }))).toEqual(['ATH', 'LHR', 'SYD']);
    expect(codes(computeRoutes({ ...base, filters: { viaHubs: ['YYZ'] } }))).toEqual(['ATH', 'LHR']);
  });

  it('sorts by duration, days flying, departure and newest', () => {
    expect(codes(computeRoutes({ ...base, sort: 'duration' }))).toEqual(['LHR', 'ATH', 'SYD']);
    expect(codes(computeRoutes({ ...base, sort: 'days' }))).toEqual(['LHR', 'ATH', 'SYD']);
    expect(codes(computeRoutes({ ...base, dateKey: '2026-10-03', sort: 'departure' })).slice(0, 1)).toEqual(['LHR']);
    expect(codes(computeRoutes({ ...base, dateKey: '2026-10-05', sort: 'departure' }))).toEqual(['ATH', 'LHR', 'SYD']);
    expect(codes(computeRoutes({ ...base, sort: 'departure' }))).toEqual(['ATH', 'LHR', 'SYD']); // week: A–Z
    expect(codes(computeRoutes({ ...base, sort: 'newest' }))).toEqual(['ATH', 'LHR', 'SYD']);
  });

  it('counts active filters', () => {
    expect(activeFilterCount(null)).toBe(0);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ types: ['Sun'], widebodyOnly: true, viaHubs: ['YYZ'] })).toBe(3);
  });
});

describe('hubStats', () => {
  it('summarises the week for the passport tiles', () => {
    expect(hubStats('YUL', '2026-10-05')).toEqual({
      directDestinations: 2,
      connectingDestinations: 1,
      countries: 3,
      directCountries: 2,
      flightsThisWeek: 13,
      departuresByWeekday: [3, 1, 3, 1, 3, 1, 1],
    });
  });
});

describe('monthAvailability', () => {
  it('returns one cell per day with direct counts and coverage', () => {
    const cells = monthAvailability('YUL', 'ATH', '2026-10');
    expect(cells).toHaveLength(31);
    expect(cells[4]).toEqual({ dateKey: '2026-10-05', direct: 2, connect: false, covered: true });
    expect(cells[5]).toEqual({ dateKey: '2026-10-06', direct: 0, connect: false, covered: true });
  });

  it('marks connection-only days and days outside coverage', () => {
    const syd = monthAvailability('YUL', 'SYD', '2026-10');
    expect(syd.every(c => c.direct === 0 && c.connect)).toBe(true);
    const april = monthAvailability('YUL', 'LHR', '2027-04');
    expect(april.every(c => !c.covered && !c.connect && c.direct === 0)).toBe(true);
  });
});
