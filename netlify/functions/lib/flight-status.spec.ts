import { describe, expect, it } from 'vitest';
import {
  budgetKey, cacheSeconds, dailyLimit, displayIdent, inboundIdToFetch, makeBudget, makeLimiter, normalizeFlight, normalizeInbound, pickFlight,
  queryWindow, validateDep, validateIdent, validateOrigin,
} from './flight-status';

const NOW = Date.parse('2026-10-06T15:00:00Z');
const H = 3_600_000;

describe('validateIdent (Air Canada only)', () => {
  it('maps AC to ACA and upper-cases', () => {
    expect(validateIdent('AC834')).toBe('ACA834');
    expect(validateIdent('ac834')).toBe('ACA834');
    expect(validateIdent('ACA834')).toBe('ACA834');
  });
  it('rejects other airlines and malformed idents', () => {
    for (const bad of [null, '', 'QK8900', 'DL1', 'AA100', 'A834', 'AC', 'AC12345', 'AC83 4', 'AC834/../x', '834', 'AC834?x=1', 12]) expect(validateIdent(bad)).toBeNull();
  });
});

describe('validateOrigin', () => {
  it('takes a 3-letter code', () => {
    expect(validateOrigin('yvr')).toBe('YVR');
    for (const bad of [null, 'CYVR', 'YV', 'Y1R', '', 5]) expect(validateOrigin(bad)).toBeNull();
  });
});

describe('validateDep', () => {
  it('accepts a minute-precision UTC time within now-14h..now+38h', () => {
    expect(validateDep('2026-10-07T06:45Z', NOW)).toBe(Date.parse('2026-10-07T06:45:00Z'));
    expect(validateDep('2026-10-06T01:00Z', NOW)).not.toBeNull();
    expect(validateDep('2026-10-05T00:59Z', NOW)).toBeNull();
    expect(validateDep('2026-10-08T05:01Z', NOW)).toBeNull();
    expect(validateDep('2026-10-08T04:59Z', NOW)).not.toBeNull();
  });
  it('rejects other shapes and impossible times', () => {
    for (const bad of [null, '2026-10-07', '2026-10-07T06:45:00Z', '2026-10-07T06:45', '2026-10-07T25:00Z', '2026-02-30T06:45Z', 5]) expect(validateDep(bad, NOW)).toBeNull();
  });
});

describe('queryWindow / cacheSeconds', () => {
  it('is dep +/- 3h', () => {
    expect(queryWindow(Date.parse('2026-10-07T06:45:00Z'))).toEqual({ start: '2026-10-07T03:45:00Z', end: '2026-10-07T09:45:00Z' });
  });
  it('caches up to 30 min, never past the 6h mark, and 5 min within 6h', () => {
    expect(cacheSeconds(NOW + 12 * H, NOW)).toBe(1800);
    expect(cacheSeconds(NOW + 6.2 * H, NOW)).toBe(720);
    expect(cacheSeconds(NOW + 6 * H + 60_000, NOW)).toBe(300);
    expect(cacheSeconds(NOW + 6 * H, NOW)).toBe(300);
    expect(cacheSeconds(NOW - H, NOW)).toBe(300);
  });
});

const flight = (over: Record<string, unknown> = {}) => ({
  ident: 'ACA834', ident_iata: 'AC834', fa_flight_id: 'ACA834-1', status: 'Scheduled / Delayed', cancelled: false, diverted: false,
  origin: { code: 'CYVR', code_icao: 'CYVR', code_iata: 'YVR' },
  scheduled_out: '2026-10-07T06:45:00Z', estimated_out: '2026-10-07T07:25:00Z', actual_out: null,
  scheduled_in: '2026-10-07T14:30:00Z', estimated_in: '2026-10-07T15:10:00Z', actual_in: null,
  gate_origin: 'D32', terminal_origin: '1', gate_destination: null, terminal_destination: 'T4',
  inbound_fa_flight_id: 'ACA811-9', aircraft_type: 'A333', registration: 'C-GXYZ', ...over,
});

describe('pickFlight', () => {
  it('YVR 23:45 PDT (06:45Z next UTC day) picks that leg, not the previous night', () => {
    const prev = flight({ fa_flight_id: 'prev', scheduled_out: '2026-10-06T06:45:00Z' });
    const day = flight({ fa_flight_id: 'day' });
    expect(pickFlight({ flights: [prev, day] }, 'YVR', Date.parse('2026-10-07T06:45:00Z'))?.['fa_flight_id']).toBe('day');
    expect(pickFlight({ flights: [prev] }, 'YVR', Date.parse('2026-10-07T06:45:00Z'))).toBeNull();
  });
  it('NRT 10:00 JST (01:00Z) picks the right day', () => {
    const o = { code_iata: 'NRT' };
    const a = flight({ fa_flight_id: 'a', origin: o, scheduled_out: '2026-10-06T01:00:00Z' });
    const b = flight({ fa_flight_id: 'b', origin: o, scheduled_out: '2026-10-07T01:00:00Z' });
    expect(pickFlight({ flights: [a, b] }, 'NRT', Date.parse('2026-10-07T01:00:00Z'))?.['fa_flight_id']).toBe('b');
  });
  it('two legs of one flight number: the origin decides', () => {
    const l1 = flight({ fa_flight_id: 'yul', origin: { code_iata: 'YUL' }, scheduled_out: '2026-10-06T12:00:00Z' });
    const l2 = flight({ fa_flight_id: 'yyz', origin: { code_iata: 'YYZ' }, scheduled_out: '2026-10-06T13:30:00Z' });
    const body = { flights: [l1, l2] };
    expect(pickFlight(body, 'YYZ', Date.parse('2026-10-06T13:30:00Z'))?.['fa_flight_id']).toBe('yyz');
    expect(pickFlight(body, 'YUL', Date.parse('2026-10-06T12:00:00Z'))?.['fa_flight_id']).toBe('yul');
    expect(pickFlight(body, 'YOW', Date.parse('2026-10-06T12:00:00Z'))).toBeNull();
  });
  it('is null when nothing is within 3h, and for malformed bodies', () => {
    expect(pickFlight({ flights: [flight()] }, 'YVR', Date.parse('2026-10-07T10:00:00Z'))).toBeNull();
    for (const b of [null, {}, { flights: [3, null] }, 'x']) expect(pickFlight(b, 'YVR', NOW)).toBeNull();
  });
  it('falls back to origin.code when there is no code_iata', () => {
    expect(pickFlight({ flights: [flight({ origin: { code: 'YVR' } })] }, 'YVR', Date.parse('2026-10-07T06:45:00Z'))).not.toBeNull();
  });
});

describe('normalizeFlight', () => {
  it('produces the minimal shape', () => {
    const out = normalizeFlight(flight(), { ident: 'ACA834' }, null, NOW);
    expect(out).toEqual({
      ident: 'AC834', status: 'Scheduled / Delayed', cancelled: false, diverted: false,
      dep: { scheduled: '2026-10-07T06:45:00Z', estimated: '2026-10-07T07:25:00Z', actual: null, gate: 'D32', terminal: '1' },
      arr: { scheduled: '2026-10-07T14:30:00Z', estimated: '2026-10-07T15:10:00Z', actual: null, gate: null, terminal: 'T4' },
      inbound: null, aircraft: 'A333', fetchedAt: '2026-10-06T15:00:00.000Z', source: 'FlightAware',
    });
    expect(JSON.stringify(out)).not.toContain('registration');
  });
  it('is defensive about missing, null and malformed fields', () => {
    const out = normalizeFlight({ scheduled_out: 'garbage', cancelled: 'yes', gate_origin: 5, status: null }, { ident: 'ACA1' }, null, NOW);
    expect(out.dep).toEqual({ scheduled: null, estimated: null, actual: null, gate: null, terminal: null });
    expect(out.cancelled).toBe(false);
    expect(out.status).toBe('');
    expect(out.aircraft).toBeNull();
  });
  it('falls back to runway times and keeps cancelled', () => {
    const out = normalizeFlight({ cancelled: true, scheduled_off: '2026-10-06T22:05:00Z' }, { ident: 'ACA1' }, null, NOW);
    expect(out.cancelled).toBe(true);
    expect(out.dep.scheduled).toBe('2026-10-06T22:05:00Z');
  });
});

describe('normalizeInbound / inboundIdToFetch', () => {
  it('landed is actual_on, else actual_in', () => {
    expect(normalizeInbound({ flights: [{ ident: 'ACA811', actual_on: '2026-10-06T17:50:00Z', actual_in: '2026-10-06T17:52:00Z' }] }))
      .toEqual({ ident: 'AC811', landed: '2026-10-06T17:50:00Z', estimatedIn: null });
    expect(normalizeInbound({ flights: [{ ident: 'ACA811', actual_in: '2026-10-06T17:52:00Z' }] })?.landed).toBe('2026-10-06T17:52:00Z');
    expect(normalizeInbound({ flights: [] })).toBeNull();
  });
  it('only asks for the inbound within 6h of departure', () => {
    const f = flight({ scheduled_out: '2026-10-06T21:55:00Z', estimated_out: null });
    expect(inboundIdToFetch(f, Date.parse('2026-10-06T18:00:00Z'))).toBe('ACA811-9');
    expect(inboundIdToFetch(f, Date.parse('2026-10-06T10:00:00Z'))).toBeNull();
    expect(inboundIdToFetch({ ...f, inbound_fa_flight_id: '../x' }, Date.parse('2026-10-06T18:00:00Z'))).toBeNull();
  });
  it('displayIdent', () => expect(displayIdent('ACA7')).toBe('AC7'));
});

describe('makeLimiter', () => {
  it('blocks after max in the window and resets', () => {
    const allow = makeLimiter(2, 1000);
    expect([allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2)]).toEqual([true, true, false, true]);
    expect(allow('a', 1001)).toBe(true);
  });
});

describe('daily budget', () => {
  /** In-memory store with ETag semantics; awaits make concurrent callers interleave. */
  const memory = () => {
    const m = new Map<string, { v: string; e: number }>();
    let seq = 0;
    return {
      m,
      getWithMetadata: async (k: string) => { await Promise.resolve(); const x = m.get(k); return x ? { data: x.v, etag: String(x.e) } : null; },
      set: async (k: string, v: string, o: { onlyIfNew?: true; onlyIfMatch?: string }) => {
        await Promise.resolve();
        const x = m.get(k);
        if (o.onlyIfNew && x) return { modified: false };
        if (o.onlyIfMatch !== undefined && (!x || String(x.e) !== o.onlyIfMatch)) return { modified: false };
        m.set(k, { v, e: ++seq });
        return { modified: true };
      },
    };
  };
  it('keys by UTC date and parses the limit with a default of 40', () => {
    expect(budgetKey(NOW)).toBe('calls-2026-10-06');
    expect([dailyLimit(undefined), dailyLimit('15'), dailyLimit('x'), dailyLimit(''), dailyLimit('-3'), dailyLimit('0')]).toEqual([40, 15, 40, 40, 40, 0]);
  });
  it('spends up to the limit, then refuses; a new UTC day starts again', async () => {
    const spend = makeBudget(memory(), 3);
    expect([await spend(NOW), await spend(NOW), await spend(NOW), await spend(NOW)]).toEqual([true, true, true, false]);
    expect(await spend(NOW + 24 * H)).toBe(true);
  });
  it('is race-free: concurrent callers never exceed the limit and the counter matches the grants', async () => {
    const store = memory();
    const spend = makeBudget(store, 3);
    const results = await Promise.all([spend(NOW), spend(NOW), spend(NOW), spend(NOW), spend(NOW)]);
    const granted = results.filter(Boolean).length;
    expect(granted).toBeLessThanOrEqual(3);
    expect(Number(store.m.get(budgetKey(NOW))!.v)).toBe(granted);
  });
  it('fails closed when the store throws', async () => {
    const spend = makeBudget({ getWithMetadata: async () => { throw new Error('down'); }, set: async () => ({ modified: true }) }, 10);
    expect(await spend(NOW)).toBe(false);
  });
});
