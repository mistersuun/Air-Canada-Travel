/**
 * Structural checks on the real data (critique 9: only structural checks read
 * live schedules; behavioural tests use fixtures). Nothing here depends on
 * which dates are currently published, so weekly scrapes cannot rot it.
 */
import { describe, expect, it } from 'vitest';
import { DESTINATIONS, HUBS, REGIONS, TYPES } from './destinations';
import { ROUTE_INDEX, getCoverage, getRouteSchedules, getSchedulesMeta } from './schedule-index';
import { flagFromIso2, getFlag } from '../utils/flags';
import { hasKnownTz } from '../utils/airports';
import { addDays, hhmmToMin, isDateKey, isValidTimeZone, weekStartKey } from '../utils/time';
import { MAX_BLOCK_MIN, MIN_BLOCK_MIN, buildInstance, flightsOn, nextFlightDate, parseDayMask } from '../utils/week';
import { computeRoutes } from '../utils/routes';
import { estimatesAllowed } from '../utils/connections';

describe('destinations and hubs', () => {
  it('every destination has a valid tz, iso2 and flag', () => {
    for (const d of DESTINATIONS) {
      expect(isValidTimeZone(d.tz), `${d.code} tz ${d.tz}`).toBe(true);
      expect(d.iso2, d.code).toMatch(/^[A-Z]{2}$/);
      expect(flagFromIso2(d.iso2), d.code).not.toBe('');
      expect(getFlag(d), d.code).not.toBe('');
    }
  });

  it('every hub has a valid tz', () => {
    for (const h of HUBS) expect(isValidTimeZone(h.tz), h.code).toBe(true);
  });

  it('codes are unique IATA codes and never collide with hubs', () => {
    const codes = DESTINATIONS.map(d => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{3}$/);
    const hubCodes = new Set(HUBS.map(h => h.code));
    expect(codes.filter(c => hubCodes.has(c))).toEqual([]);
  });

  it('regions and types are consistent', () => {
    const regions = new Set(REGIONS);
    const types = new Set<string>(TYPES);
    for (const d of DESTINATIONS) {
      expect(regions.has(d.region), `${d.code} region ${d.region}`).toBe(true);
      expect(types.has(d.type), `${d.code} type ${d.type}`).toBe(true);
    }
    for (const r of REGIONS.filter(r => r !== 'All')) {
      expect(DESTINATIONS.some(d => d.region === r), `region ${r} has destinations`).toBe(true);
    }
  });
});

describe('schedules', () => {
  it('every row is well formed', () => {
    const bad: string[] = [];
    for (const r of getRouteSchedules()) {
      for (const s of r.schedules) {
        const ok = isDateKey(s.fromDate) && isDateKey(s.toDate) && s.fromDate <= s.toDate
          && !Number.isNaN(hhmmToMin(s.departure)) && !Number.isNaN(hhmmToMin(s.arrival))
          && parseDayMask(s.days) !== 0 && !!s.flightNumber;
        if (!ok) bad.push(`${r.originCode}-${r.destinationCode} ${s.flightNumber} ${s.fromDate}..${s.toDate} ${s.days}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the index covers every route', () => {
    for (const r of getRouteSchedules()) {
      expect(ROUTE_INDEX.get(`${r.originCode}-${r.destinationCode}`)?.length ?? 0).toBeGreaterThanOrEqual(r.schedules.length);
    }
  });

  it('every schedule airport is a hub, a destination or an extra airport', () => {
    // An unknown code falls back to UTC (every duration wrong) and never shows
    // in the list: add it to DESTINATIONS, HUBS or EXTRA_AIRPORTS (as DJT, the
    // renamed Palm Beach, and YTZ, Billy Bishop, needed).
    const unknown = new Set<string>();
    for (const r of getRouteSchedules()) {
      if (!hasKnownTz(r.originCode)) unknown.add(r.originCode);
      if (!hasKnownTz(r.destinationCode)) unknown.add(r.destinationCode);
    }
    expect([...unknown].sort()).toEqual([]);
  });

  it('every route touches a hub', () => {
    const hubs = new Set(HUBS.map(h => h.code));
    const orphans = getRouteSchedules()
      .filter(r => !hubs.has(r.originCode) && !hubs.has(r.destinationCode))
      .map(r => `${r.originCode}-${r.destinationCode}`);
    expect(orphans).toEqual([]);
  });

  it('no published record has an implausible block time', () => {
    // flightsOn drops such instances as parse errors. With every airport's zone
    // right none should exist; one here means a time-zone rule or airport code
    // is wrong (YVR-SEA at 7 minutes was BC's 2026 permanent daylight time).
    const odd: string[] = [];
    for (const r of getRouteSchedules()) {
      for (const s of r.schedules) {
        const x = buildInstance(s, r.originCode, r.destinationCode, nextOperating(s.fromDate, s.days));
        if (x.durationMin < MIN_BLOCK_MIN || x.durationMin > MAX_BLOCK_MIN) {
          odd.push(`${x.origin}-${x.dest} ${x.flightNumber} ${x.dateKey} ${x.depLocal}→${x.arrLocal} (${x.durationMin}m)`);
        }
      }
    }
    expect(odd).toEqual([]);
  });

  it('the same flight keeps its block time across the clock changes', () => {
    // A zone the runtime reads differently from the PDFs shows up as a flight
    // whose block time jumps by an hour at a DST boundary (YWG-YYZ AC256 was
    // 155 min in October and 95 in November). Compare each flight's median
    // block time in October and in January.
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
    const jumps: string[] = [];
    for (const r of getRouteSchedules()) {
      const oct: number[] = [], jan: number[] = [];
      for (let i = 0; i < 28; i++) {
        for (const f of flightsOn(r.originCode, r.destinationCode, addDays('2026-10-01', i))) oct.push(f.durationMin);
        for (const f of flightsOn(r.originCode, r.destinationCode, addDays('2027-01-11', i))) jan.push(f.durationMin);
      }
      if (oct.length < 4 || jan.length < 4) continue;
      const d = median(jan) - median(oct);
      if (Math.abs(d) >= 45) jumps.push(`${r.originCode}-${r.destinationCode} Oct ${median(oct)} Jan ${median(jan)}`);
    }
    // Long-haul winds move a few routes by up to ~40 min; a whole-hour jump on
    // many routes of one airport is a zone problem.
    expect(jumps.length, jumps.join('\n')).toBeLessThanOrEqual(3);
  });

  it('destinations without any published flight (report only)', () => {
    const served = new Set(getRouteSchedules().flatMap(r => [r.originCode, r.destinationCode]));
    const none = DESTINATIONS.filter(d => !served.has(d.code)).map(d => d.code);
    // Not gating: a seasonal destination can drop out of one weekly scrape.
    if (none.length) console.warn(`[data-integrity] destinations with no published flights: ${none.join(', ')}`);
    expect(none.length).toBeLessThan(DESTINATIONS.length / 10);
  });

  it('publishes the domestic hub-to-hub legs, so no connection uses an invented leg', () => {
    expect(getSchedulesMeta()?.hubToHub).toBe(true);
    expect(estimatesAllowed()).toBe(false);
    const hubs = HUBS.map(h => h.code);
    const pairs = getRouteSchedules().filter(r => hubs.includes(r.originCode) && hubs.includes(r.destinationCode));
    expect(pairs.length).toBeGreaterThan(40);
  });

  it('has a coverage window', () => {
    const c = getCoverage();
    expect(isDateKey(c.from)).toBe(true);
    expect(isDateKey(c.to)).toBe(true);
    for (const h of ['YUL', 'YYZ', 'YVR']) expect(isDateKey(getCoverage(h).to), h).toBe(true);
  });
});

describe('route drift fixes', () => {
  it('DCA and LGA appear in computeRoutes wherever they are scheduled', () => {
    const from = getCoverage().from!;
    for (const [hub, dest] of [['YUL', 'DCA'], ['YYZ', 'DCA'], ['YUL', 'LGA'], ['YYZ', 'LGA']]) {
      const day = nextFlightDate(hub, dest, from);
      if (!day) continue; // not published this season
      const rs = computeRoutes({ home: hub, weekStartKey: weekStartKey(day), dateKey: day, region: 'All', showConnections: false });
      expect(rs.some(r => r.destination.code === dest), `${hub}→${dest} on ${day}`).toBe(true);
    }
  });

  it('computeRoutes for YUL in a published week (timing is logged, not asserted: critique 16)', () => {
    const week = weekStartKey(addDays(getCoverage('YUL').from!, 14));
    const params = { home: 'YUL', weekStartKey: week, dateKey: null, region: 'All', showConnections: true };
    const t0 = performance.now();
    const cold = computeRoutes(params);
    const t1 = performance.now();
    computeRoutes({ ...params });
    const t2 = performance.now();
    console.info(`[perf] computeRoutes YUL ${week}: cold ${(t1 - t0).toFixed(1)} ms, warm ${(t2 - t1).toFixed(1)} ms, ${cold.length} routes`);
    expect(cold.length).toBeGreaterThan(0);
  });
});

function nextOperating(fromDate: string, days: string): string {
  const mask = parseDayMask(days);
  let k = fromDate;
  for (let i = 0; i < 7; i++) {
    const wd = (new Date(`${k}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (mask & (1 << wd)) return k;
    const t = new Date(`${k}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    k = t.toISOString().slice(0, 10);
  }
  return fromDate;
}
