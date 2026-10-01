import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { ALL_DAYS, FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { computeRoutes } from '../../utils/routes';
import type { RouteEntry } from '../../utils/routes';
import { toUtcMs } from '../../utils/time';
import {
  coverageStatus, departsToday, editorsPicks, entryHasFlight, flightNumberQuery, focusDayIndex, nonstopByFrequency,
  placeRows, reachDep, rowMeta, seasonEnd, seasonEvents, seasonMeta, withFlightMatches,
} from './home-model';
import type { CityHit } from '../../places/city-index';
import { SEVILLE_PLACE } from '../../trips/testing/seville-fixture';

const WEEK = '2026-10-05';

function routes(home: string, dateKey: string | null = null, showConnections = true): RouteEntry[] {
  return computeRoutes({ home, weekStartKey: WEEK, dateKey, region: 'All', showConnections });
}

/**
 * YUL routes with seasons: CUN daily, LIS Mon–Sat, KEF ends Oct 22, PUJ starts Oct 12,
 * NCE pauses Oct 10–Nov 20, OPO ends Oct 23 and is back only in March (a seasonal end).
 */
const SEASON_ROUTES = [
  route('YUL', 'CUN', rec('AC1882', '08:40', '12:10', '2026-09-01', '2027-03-31', ALL_DAYS, '7M8')),
  route('YUL', 'LIS', rec('AC812', '21:45', '09:20', '2026-09-01', '2027-03-31', 'Mon,Tue,Wed,Thu,Fri,Sat', '333')),
  route('YUL', 'KEF', rec('AC912', '22:55', '07:55', '2026-09-01', '2026-10-22', 'Tue,Thu,Sat', '7M8')),
  route('YUL', 'PUJ', rec('AC1792', '11:40', '16:05', '2026-10-12', '2027-03-31', 'Mon,Fri', '7M8')),
  route('YUL', 'NCE',
    rec('AC814', '21:35', '10:55', '2026-09-01', '2026-10-10', ALL_DAYS, '333'),
    rec('AC814', '21:35', '10:55', '2026-11-20', '2027-03-31', ALL_DAYS, '333'),
  ),
  route('YUL', 'OPO',
    rec('AC928', '19:30', '07:10', '2026-09-01', '2026-10-23', ALL_DAYS, '333'),
    rec('AC928', '19:30', '07:10', '2027-03-01', '2027-03-31', ALL_DAYS, '333'),
  ),
  route('LHR', 'YUL', rec('AC865', '12:10', '14:35', '2026-09-01', '2027-03-31', ALL_DAYS, '333')),
];

describe('home-model', () => {
  afterEach(() => resetScheduleSource());

  describe('with the shared fixtures', () => {
    beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));

    it('nonstopByFrequency: direct only, by days flying then city', () => {
      expect(nonstopByFrequency(routes('YUL')).map(e => e.destination.code)).toEqual(['LHR', 'ATH']);
    });

    it('rowMeta: first flight in scope, with and without the flight number', () => {
      const lhr = routes('YUL').find(e => e.destination.code === 'LHR')!;
      expect(rowMeta(lhr)).toBe('22:10 → 10:00⁺¹ · 6h50 · AC864');
      expect(rowMeta(lhr, '24h', true)).toBe('22:10 → 10:00⁺¹ · 6h50');
      expect(rowMeta(lhr, '12h', true)).toContain('PM');
    });

    it('rowMeta: a connection reads via its hub', () => {
      const yhz = routes('YHZ', '2026-10-07').find(e => !e.isDirect && e.destination.code === 'LHR');
      expect(yhz).toBeTruthy();
      expect(rowMeta(yhz!)).toMatch(/^via YYZ · 14:00 → 06:15⁺¹ · /);
      expect(rowMeta(yhz!, '24h', true)).toMatch(/^via YYZ · \d+h/);
    });

    it('editorsPicks: photos only, "today" first, badges and metas', () => {
      const entries = routes('YUL');
      const today = '2026-10-07';
      const picks = editorsPicks(entries, { hasPhoto: c => c === 'LHR' || c === 'ATH', todayKey: today, minPhotos: 1 });
      // Both depart today; LHR flies more days.
      expect(picks.map(p => p.code)).toEqual(['LHR', 'ATH']);
      expect(picks[0].badge).toBe('Tonight 22:10');
      // ATH flies Wed Oct 7 at 17:25 (and 21:30): "Tonight".
      expect(picks[1].badge).toBe('Tonight 17:25');
      expect(picks[1].badgeShort).toBe('Tonight');
      expect(picks[1].meta).toBe('Greece · 10h10 · 3× wk');
      expect(picks[1].metaShort).toBe('10h10 · 3× wk');
      expect(picks[0].meta).toBe('United Kingdom · 6h50 · Daily');
    });

    it('editorsPicks: past departures today do not count; Daily otherwise', () => {
      const entries = routes('YUL');
      const after = toUtcMs('2026-10-07', '23:00', 'America/Toronto');
      const picks = editorsPicks(entries, { hasPhoto: () => true, todayKey: '2026-10-07', nowMs: after });
      const lhr = picks.find(p => p.code === 'LHR')!;
      expect(lhr.badge).toBe('Daily');
      expect(picks[0].code).toBe('LHR'); // 7 days beats 3
    });

    it('editorsPicks: at most perRegion per region and limit cards', () => {
      const picks = editorsPicks(routes('YUL'), { hasPhoto: () => true, todayKey: '2026-10-01', perRegion: 1 });
      expect(picks.length).toBe(1);
      expect(editorsPicks(routes('YUL'), { hasPhoto: () => true, todayKey: '2026-10-01', limit: 1 }).length).toBe(1);
    });

    it('editorsPicks: fills with monogram destinations when too few have photos', () => {
      const picks = editorsPicks(routes('YUL'), { hasPhoto: c => c === 'ATH', todayKey: '2026-10-01' });
      expect(picks.map(p => p.code)).toEqual(['ATH', 'LHR']);
      expect(editorsPicks(routes('YUL'), { hasPhoto: c => c === 'ATH', todayKey: '2026-10-01', minPhotos: 1 }).map(p => p.code))
        .toEqual(['ATH']);
    });

    it('departsToday finds the first departure today after now', () => {
      const ath = routes('YUL').find(e => e.destination.code === 'ATH')!;
      expect(departsToday(ath, '2026-10-07')?.flightNumber).toBe('AC898');
      const late = toUtcMs('2026-10-07', '18:00', 'America/Toronto');
      expect(departsToday(ath, '2026-10-07', late)?.flightNumber).toBe('AC922');
      expect(departsToday(ath, '2026-10-06')).toBeNull();
    });

    it('flight number search', () => {
      expect(flightNumberQuery('ac 864')).toBe('AC864');
      expect(flightNumberQuery('864')).toBe('AC864');
      expect(flightNumberQuery('AC0864')).toBe('AC864');
      expect(flightNumberQuery('London')).toBeNull();
      const all = routes('YUL');
      const lhr = all.find(e => e.destination.code === 'LHR')!;
      expect(entryHasFlight(lhr, 'AC864')).toBe(true);
      expect(entryHasFlight(lhr, 'AC898')).toBe(false);
      expect(withFlightMatches([], all, 'AC898').map(e => e.destination.code)).toEqual(['ATH']);
      expect(withFlightMatches([lhr], all, 'london').map(e => e.destination.code)).toEqual(['LHR']);
      expect(withFlightMatches([lhr], all, 'AC864').length).toBe(1);
    });

    it('flight number search also matches connection legs', () => {
      const all = routes('YHZ', '2026-10-07');
      expect(withFlightMatches([], all, 'AC848').map(e => e.destination.code)).toContain('LHR');
    });
  });

  describe('seasonEvents', () => {
    beforeEach(() => setScheduleSource(SEASON_ROUTES, FIXTURE_META));

    it('finds ends, pauses and starts within the horizon, sorted by date', () => {
      const ev = seasonEvents('YUL', '2026-10-01');
      expect(ev.map(e => `${e.code} ${e.label}`)).toEqual([
        'NCE Pauses Oct 10',
        'PUJ Starts Oct 12',
        'KEF Ends Oct 22',
        'OPO Ends Oct 23',
      ]);
      expect(ev.find(e => e.code === 'KEF')!.kind).toBe('ends');
      expect(ev.find(e => e.code === 'PUJ')!.next?.dateKey).toBe('2026-10-12');
    });

    it('ignores starts beyond the horizon and ends past it', () => {
      expect(seasonEvents('YUL', '2026-10-01', 10).map(e => e.code)).toEqual(['NCE']);
    });

    it('a route still flying at the end of the window is not "ending"', () => {
      setScheduleSource([route('YUL', 'CUN', rec('AC1882', '08:40', '12:10', '2026-09-01', '2026-10-20'))], {
        ...FIXTURE_META, coverageTo: '2026-10-20',
      });
      expect(seasonEvents('YUL', '2026-10-01')).toEqual([]);
    });

    it('seasonMeta shows the next departure', () => {
      const kef = seasonEvents('YUL', '2026-10-01').find(e => e.code === 'KEF')!;
      expect(seasonMeta(kef)).toBe('22:55 → 07:55⁺¹ · 5h · AC912');
      expect(seasonMeta(kef, '24h', true)).not.toContain('AC912');
      expect(seasonMeta({ ...kef, next: null })).toBe('');
    });
  });

  it('seasonEnd', () => {
    expect(seasonEnd('Mar – Nov')).toBe('Nov');
    expect(seasonEnd('Nov – Apr, Jul')).toBe('Jul');
    expect(seasonEnd(null)).toBeNull();
  });

  it('coverageStatus', () => {
    const c = { from: '2026-09-01', to: '2027-03-31', generatedAt: null, hub: 'YUL' };
    expect(coverageStatus(null, WEEK, null)).toBe('covered');
    expect(coverageStatus({ ...c, from: null, to: null }, WEEK, null)).toBe('none');
    expect(coverageStatus(c, WEEK, null)).toBe('covered');
    expect(coverageStatus(c, '2027-04-05', null)).toBe('after');
    expect(coverageStatus(c, '2026-08-10', null)).toBe('before');
    expect(coverageStatus(c, '2027-03-29', null)).toBe('partial');
    expect(coverageStatus(c, '2027-03-29', '2027-03-30')).toBe('covered');
    expect(coverageStatus(c, '2027-03-29', '2027-04-02')).toBe('after');
  });

  it('focusDayIndex', () => {
    expect(focusDayIndex(WEEK, '2026-10-07', '2026-10-05')).toBe(2);
    expect(focusDayIndex(WEEK, null, '2026-10-06')).toBe(1);
    expect(focusDayIndex(WEEK, null, '2026-10-20')).toBeNull();
  });
});

describe('placeRows / reachDep', () => {
  const hit = (over: Partial<CityHit['place']>, servedBy: string | null = null): CityHit =>
    ({ place: { ...SEVILLE_PLACE, ...over }, population: 1000, servedBy });

  it('drops cities AC serves and labels the rest "Not on AC\'s network"', () => {
    const rows = placeRows([hit({}), hit({ id: 'gn-2267057', name: 'Lisbon', country: 'Portugal' }, 'LIS')], 'sev');
    expect(rows).toEqual([{ id: 'gn-2510911', name: 'Seville', sub: "Spain · Not in our schedule data" }]);
  });

  it('adds the region when two places share a name, and needs 3 characters', () => {
    const rows = placeRows([
      hit({ id: 'gn-1', name: 'Roseville', country: 'United States', admin1: 'California' }),
      hit({ id: 'gn-2', name: 'Roseville', country: 'United States', admin1: 'Michigan' }),
    ], 'rose');
    expect(rows.map(r => r.sub)).toEqual(["California, United States · Not in our schedule data", "Michigan, United States · Not in our schedule data"]);
    expect(placeRows([hit({})], 'se')).toEqual([]);
  });

  it('dep is the selected day, else a week from today', () => {
    expect(reachDep('2026-10-09', '2026-10-01')).toBe('2026-10-09');
    expect(reachDep(null, '2026-10-01')).toBe('2026-10-08');
  });
});
