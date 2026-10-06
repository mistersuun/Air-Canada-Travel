import { describe, expect, it } from 'vitest';
import {
  displayIdent, inboundIdToFetch, makeLimiter, normalizeFlight, normalizeInbound, pickFlight, queryWindow, validateDate, validateIdent,
} from './flight-status';

const NOW = Date.parse('2026-10-06T15:00:00Z');

describe('validateIdent', () => {
  it('maps AC to ACA and upper-cases', () => {
    expect(validateIdent('AC834')).toBe('ACA834');
    expect(validateIdent('ac834')).toBe('ACA834');
    expect(validateIdent('ACA834')).toBe('ACA834');
    expect(validateIdent('QK8900')).toBe('QK8900');
  });
  it('rejects anything else', () => {
    for (const bad of [null, '', 'A834', 'AC', 'AC12345', 'AC83 4', 'AC834/../x', '834', 'AC834?x=1', 12]) expect(validateIdent(bad)).toBeNull();
  });
});

describe('validateDate', () => {
  it('accepts -1..+2 days only', () => {
    expect(validateDate('2026-10-05', NOW)).toBe('2026-10-05');
    expect(validateDate('2026-10-08', NOW)).toBe('2026-10-08');
    expect(validateDate('2026-10-04', NOW)).toBeNull();
    expect(validateDate('2026-10-09', NOW)).toBeNull();
  });
  it('rejects malformed and impossible dates', () => {
    for (const bad of [null, '2026-1-6', '2026-02-30', '20261006', '2026-10-06T00:00', 5]) expect(validateDate(bad, NOW)).toBeNull();
  });
});

describe('queryWindow', () => {
  it('covers any airport time zone for the date', () => {
    expect(queryWindow('2026-10-06')).toEqual({ start: '2026-10-05T20:00:00Z', end: '2026-10-07T10:00:00Z' });
  });
});

const flight = {
  ident: 'ACA834', ident_iata: 'AC834', fa_flight_id: 'ACA834-1', status: 'Scheduled / Delayed', cancelled: false, diverted: false,
  scheduled_out: '2026-10-06T21:55:00Z', estimated_out: '2026-10-06T22:35:00Z', actual_out: null,
  scheduled_in: '2026-10-07T06:30:00Z', estimated_in: '2026-10-07T07:10:00Z', actual_in: null,
  gate_origin: 'D32', terminal_origin: '1', gate_destination: null, terminal_destination: 'T4',
  inbound_fa_flight_id: 'ACA811-9', aircraft_type: 'A333', registration: 'C-GXYZ',
};

describe('normalizeFlight', () => {
  it('produces the minimal shape', () => {
    const out = normalizeFlight(flight, { ident: 'ACA834', date: '2026-10-06' }, null, NOW);
    expect(out).toEqual({
      ident: 'AC834', date: '2026-10-06', status: 'Scheduled / Delayed', cancelled: false, diverted: false,
      dep: { scheduled: '2026-10-06T21:55:00Z', estimated: '2026-10-06T22:35:00Z', actual: null, gate: 'D32', terminal: '1' },
      arr: { scheduled: '2026-10-07T06:30:00Z', estimated: '2026-10-07T07:10:00Z', actual: null, gate: null, terminal: 'T4' },
      inbound: null, aircraft: 'A333', fetchedAt: '2026-10-06T15:00:00.000Z', source: 'FlightAware',
    });
    expect(JSON.stringify(out)).not.toContain('registration');
  });
  it('is defensive about missing, null and malformed fields', () => {
    const out = normalizeFlight({ scheduled_out: 'garbage', cancelled: 'yes', gate_origin: 5, status: null }, { ident: 'ACA1', date: '2026-10-06' }, null, NOW);
    expect(out.dep).toEqual({ scheduled: null, estimated: null, actual: null, gate: null, terminal: null });
    expect(out.cancelled).toBe(false);
    expect(out.status).toBe('');
    expect(out.aircraft).toBeNull();
  });
  it('falls back to runway times and keeps cancelled', () => {
    const out = normalizeFlight({ cancelled: true, scheduled_off: '2026-10-06T22:05:00Z' }, { ident: 'ACA1', date: '2026-10-06' }, null, NOW);
    expect(out.cancelled).toBe(true);
    expect(out.dep.scheduled).toBe('2026-10-06T22:05:00Z');
  });
});

describe('pickFlight', () => {
  it('returns null for empty or malformed bodies', () => {
    for (const b of [null, {}, { flights: [3, null] }, 'x']) expect(pickFlight(b, '2026-10-06')).toBeNull();
    expect(pickFlight({ flights: [] }, '2026-10-06')).toBeNull();
    expect(pickFlight(null, '2026-10-06')).toBeNull();
  });
  it('chooses the departure nearest the date, not the neighbouring day', () => {
    const prev = { id: 'prev', scheduled_out: '2026-10-05T21:55:00Z' };
    const day = { id: 'day', scheduled_out: '2026-10-06T21:55:00Z' };
    expect(pickFlight({ flights: [prev, day] }, '2026-10-06')?.['id']).toBe('day');
  });
});

describe('normalizeInbound / inboundIdToFetch', () => {
  it('reads landed time and display ident', () => {
    expect(normalizeInbound({ flights: [{ ident: 'ACA811', actual_in: '2026-10-06T17:52:00Z' }] }))
      .toEqual({ ident: 'AC811', landed: '2026-10-06T17:52:00Z', estimatedIn: null });
    expect(normalizeInbound({ flights: [] })).toBeNull();
  });
  it('only asks for the inbound within 6h of departure', () => {
    expect(inboundIdToFetch(flight, Date.parse('2026-10-06T18:00:00Z'))).toBe('ACA811-9');
    expect(inboundIdToFetch(flight, Date.parse('2026-10-06T10:00:00Z'))).toBeNull();
    expect(inboundIdToFetch({ ...flight, inbound_fa_flight_id: '../x' }, Date.parse('2026-10-06T18:00:00Z'))).toBeNull();
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
