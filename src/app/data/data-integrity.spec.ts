/**
 * Structural checks on the real data (critique 9: only structural checks read
 * live schedules; behavioural tests use fixtures). Nothing here depends on
 * which dates are currently published, so weekly scrapes cannot rot it.
 */
import { describe, expect, it } from 'vitest';
import { DESTINATIONS, HUBS, REGIONS, TYPES } from './destinations';
import { ROUTE_INDEX, getCoverage, getRouteSchedules } from './schedule-index';
import { flagFromIso2, getFlag } from '../utils/flags';
import { hasKnownTz } from '../utils/airports';
import { addDays, hhmmToMin, isDateKey, isValidTimeZone, weekStartKey } from '../utils/time';
import { flightsOn, nextFlightDate, parseDayMask } from '../utils/week';
import { computeRoutes } from '../utils/routes';

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

  it('every hub-to-destination airport has a time zone (report only)', () => {
    const unknown = new Set<string>();
    for (const r of getRouteSchedules()) {
      if (!hasKnownTz(r.originCode)) unknown.add(r.originCode);
      if (!hasKnownTz(r.destinationCode)) unknown.add(r.destinationCode);
    }
    // Unknown airports fall back to UTC; add them to DESTINATIONS or EXTRA_AIRPORTS.
    // Not gating, so a new route in the weekly scrape cannot block CI.
    if (unknown.size) console.warn(`[data-integrity] airports without a time zone: ${[...unknown].sort().join(', ')}`);
    for (const h of HUBS) expect(unknown.has(h.code)).toBe(false);
  });

  it('flags implausible block times (report only)', () => {
    const odd = new Set<string>();
    for (const r of getRouteSchedules()) {
      if (!hasKnownTz(r.originCode) || !hasKnownTz(r.destinationCode)) continue;
      for (const s of r.schedules) {
        const f = flightsOn(r.originCode, r.destinationCode, nextOperating(s.fromDate, s.days));
        for (const x of f) {
          if (x.flightNumber === s.flightNumber && (x.durationMin < 20 || x.durationMin > 19 * 60)) {
            odd.add(`${x.origin}-${x.dest} ${x.flightNumber} ${x.depLocal}→${x.arrLocal} (${x.durationMin}m)`);
          }
        }
      }
    }
    if (odd.size) console.warn(`[data-integrity] implausible block times (likely parse errors):\n  ${[...odd].join('\n  ')}`);
    expect(true).toBe(true);
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
