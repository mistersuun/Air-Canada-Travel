import { describe, expect, it } from 'vitest';
import {
  INBOUND_TTL_MS, cachedInbound, cacheSeconds, canonicalQuery, displayIdent, inboundIdToFetch, normalizeFlight, normalizeInbound, pickFlight,
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

describe('canonicalQuery', () => {
  const canon = (qs: string) => canonicalQuery(new URLSearchParams(qs), 'ACA834', 'YVR', '2026-10-06T21:55Z');
  it('is null for the canonical request', () => {
    expect(canon('ident=AC834&origin=YVR&dep=2026-10-06T21%3A55Z')).toBeNull();
  });
  it('gives one canonical query for case, ICAO form, order and extra params', () => {
    const want = 'ident=AC834&origin=YVR&dep=2026-10-06T21%3A55Z';
    expect(canon('ident=ac834&origin=yvr&dep=2026-10-06T21:55Z')).toBe(want);
    expect(canon('ident=ACA834&origin=YVR&dep=2026-10-06T21:55Z')).toBe(want);
    expect(canon('dep=2026-10-06T21:55Z&origin=YVR&ident=AC834')).toBe(want);
    expect(canon('ident=AC834&origin=YVR&dep=2026-10-06T21:55Z&x=1')).toBe(want);
  });
});

describe('cachedInbound (15 minute cache keyed by the inbound flight id)', () => {
  const inbound = { ident: 'AC811', landed: null, estimatedIn: '2026-10-06T21:00:00Z' };
  function store() {
    const m = new Map<string, string>();
    return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
  }
  it('looks up once, then reuses it until 15 minutes pass', async () => {
    const s = store();
    let calls = 0;
    const look = async () => { calls++; return inbound; };
    expect(await cachedInbound(s, 'ACA811-9', NOW, look)).toEqual(inbound);
    expect(await cachedInbound(s, 'ACA811-9', NOW + INBOUND_TTL_MS - 1, look)).toEqual(inbound);
    expect(calls).toBe(1);
    expect(await cachedInbound(s, 'ACA811-9', NOW + INBOUND_TTL_MS, look)).toEqual(inbound);
    expect(calls).toBe(2);
    await cachedInbound(s, 'ACA999-1', NOW, look);
    expect(calls).toBe(3);
  });
  it('deletes an entry it finds stale or unreadable before looking up again', async () => {
    const m = new Map<string, string>();
    const deleted: string[] = [];
    const s = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { deleted.push(k); m.delete(k); } };
    m.set('inbound-ACA811-9', JSON.stringify({ at: NOW - INBOUND_TTL_MS - 1, inbound }));
    await cachedInbound(s, 'ACA811-9', NOW, async () => undefined);
    expect(deleted).toEqual(['inbound-ACA811-9']);
    expect(m.size).toBe(0);
    m.set('inbound-ACA811-9', 'junk');
    await cachedInbound(s, 'ACA811-9', NOW, async () => inbound);
    expect(deleted).toHaveLength(2);
    expect(m.size).toBe(1); // the fresh lookup is stored again
  });
  it('a refused or failed lookup (undefined) gives null and is not cached', async () => {
    const s = store();
    let calls = 0;
    const fail = async () => { calls++; return undefined; };
    expect(await cachedInbound(s, 'ACA811-9', NOW, fail)).toBeNull();
    expect(await cachedInbound(s, 'ACA811-9', NOW, fail)).toBeNull();
    expect(calls).toBe(2);
    expect(s.m.size).toBe(0);
  });
  it('caches "no inbound known" too, and survives a missing or broken store', async () => {
    const s = store();
    let calls = 0;
    const none = async () => { calls++; return null; };
    await cachedInbound(s, 'ACA811-9', NOW, none);
    expect(await cachedInbound(s, 'ACA811-9', NOW + 1000, none)).toBeNull();
    expect(calls).toBe(1);
    expect(await cachedInbound(null, 'ACA811-9', NOW, async () => inbound)).toEqual(inbound);
    const broken = { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } };
    expect(await cachedInbound(broken, 'ACA811-9', NOW, async () => inbound)).toEqual(inbound);
    s.m.set('inbound-ACA811-9', 'junk');
    expect(await cachedInbound(s, 'ACA811-9', NOW, async () => inbound)).toEqual(inbound);
  });
});
