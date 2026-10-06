import { describe, expect, it } from 'vitest';
import { DESTINATIONS, HUBS } from '../../../src/app/data/destinations';
import places from './places.json';
import {
  buildUrl, coordsFor, eventsDailyLimit, normalizeEvents, safeTicketmasterUrl, validateCode, validateWindow,
} from './events';

const NOW = Date.parse('2026-10-06T15:00:00Z');

describe('places.json', () => {
  it('matches destinations.ts (regenerate with: node --experimental-strip-types scripts/gen-places.mjs)', () => {
    const want: Record<string, { lat: number; lng: number }> = {};
    for (const p of [...HUBS, ...DESTINATIONS]) want[p.code] = { lat: p.lat, lng: p.lng };
    expect(places).toEqual(want);
  });
});

describe('validateCode / coordsFor', () => {
  it('accepts known codes case-insensitively', () => {
    expect(validateCode('lis')).toBe('LIS');
    expect(coordsFor('PUJ')).toEqual({ lat: 18.57, lng: -68.37 });
  });
  it('rejects unknown and malformed codes', () => {
    for (const bad of [null, '', 'XXX', 'LISB', 'L1S', '__proto__', 'constructor', 5]) expect(validateCode(bad)).toBeNull();
    expect(coordsFor('toString')).toBeNull();
  });
});

describe('validateWindow', () => {
  it('accepts 1 to 7 days inside the horizon', () => {
    expect(validateWindow('2026-10-10', '2026-10-10', NOW)).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(validateWindow('2026-10-10', '2026-10-16', NOW)).not.toBeNull();
    expect(validateWindow('2026-10-05', '2026-10-06', NOW)).not.toBeNull();
  });
  it('rejects 8 days, reversed, past, beyond 120 days and junk', () => {
    expect(validateWindow('2026-10-10', '2026-10-17', NOW)).toBeNull();
    expect(validateWindow('2026-10-12', '2026-10-10', NOW)).toBeNull();
    expect(validateWindow('2026-10-03', '2026-10-04', NOW)).toBeNull();
    expect(validateWindow('2027-02-03', '2027-02-04', NOW)).toBeNull(); // day 121
    expect(validateWindow('2027-02-02', '2027-02-02', NOW)).not.toBeNull(); // day 120
    for (const bad of [null, '', '2026-02-30', '2026-10-1', '10/10/2026', '2026-10-10T00:00']) expect(validateWindow(bad, '2026-10-10', NOW)).toBeNull();
  });
});

describe('buildUrl', () => {
  it('uses the documented Discovery v2 parameters, padded a day each side', () => {
    const u = new URL(buildUrl('LIS', { from: '2026-10-10', to: '2026-10-11' }, 'K')!);
    expect(u.origin + u.pathname).toBe('https://app.ticketmaster.com/discovery/v2/events.json');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      apikey: 'K', unit: 'km', radius: '40', sort: 'date,asc', startDateTime: '2026-10-09T00:00:00Z', endDateTime: '2026-10-12T23:59:59Z',
    });
    expect(u.searchParams.get('latlong')).toBe(`${coordsFor('LIS')!.lat},${coordsFor('LIS')!.lng}`);
    expect(buildUrl('XXX', { from: '2026-10-10', to: '2026-10-11' }, 'K')).toBeNull();
  });
});

const ev = (over: Record<string, unknown> = {}) => ({
  name: 'Coldplay', url: 'https://www.ticketmaster.pt/event/1',
  dates: { start: { localDate: '2026-10-10', localTime: '20:00:00' }, status: { code: 'onsale' } },
  classifications: [{ segment: { name: 'Music' } }],
  _embedded: { venues: [{ name: 'Estádio da Luz' }] },
  ...over,
});
const W = { from: '2026-10-09', to: '2026-10-12' };

describe('normalizeEvents', () => {
  it('maps the documented fields', () => {
    const r = normalizeEvents({ _embedded: { events: [ev()] } }, W, NOW);
    expect(r).toEqual({
      events: [{ name: 'Coldplay', url: 'https://www.ticketmaster.pt/event/1', date: '2026-10-10', time: '20:00', venue: 'Estádio da Luz', segment: 'Music' }],
      source: 'Ticketmaster', fetchedAt: '2026-10-06T15:00:00.000Z',
    });
  });
  it('sorts, de-duplicates, filters by local date, drops cancelled and non-Ticketmaster links, keeps null time', () => {
    const body = { _embedded: { events: [
      ev({ name: 'B', dates: { start: { localDate: '2026-10-11' } } }),
      ev({ name: 'A' }), ev({ name: 'a' }),
      ev({ name: 'Out', dates: { start: { localDate: '2026-10-20', localTime: '10:00:00' } } }),
      ev({ name: 'Gone', dates: { start: { localDate: '2026-10-10' }, status: { code: 'cancelled' } } }),
      ev({ name: 'Evil', url: 'https://evil.example/ticketmaster.com' }),
      ev({ name: 'Js', url: 'javascript:alert(1)' }),
      null, 'x', ev({ name: '' }),
    ] } };
    const r = normalizeEvents(body, W, NOW).events;
    expect(r.map(e => e.name)).toEqual(['A', 'B']);
    expect(r[1].time).toBeNull();
  });
  it('caps at 10 and survives garbage', () => {
    const many = Array.from({ length: 25 }, (_, i) => ev({ name: `E${i}` }));
    expect(normalizeEvents({ _embedded: { events: many } }, W, NOW).events).toHaveLength(10);
    for (const b of [null, {}, [], 'x', { _embedded: { events: 'no' } }]) expect(normalizeEvents(b, W, NOW).events).toEqual([]);
  });
});

describe('misc', () => {
  it('safeTicketmasterUrl', () => {
    expect(safeTicketmasterUrl('https://www.ticketmaster.com/e/1')).not.toBeNull();
    expect(safeTicketmasterUrl('http://www.ticketmaster.com/e/1')).toBeNull();
    expect(safeTicketmasterUrl('https://ticketmaster.com.evil.io/')).toBeNull();
  });
  it('eventsDailyLimit', () => {
    expect(eventsDailyLimit(undefined)).toBe(500);
    expect(eventsDailyLimit('120')).toBe(120);
    expect(eventsDailyLimit('0')).toBe(0);
    expect(eventsDailyLimit('x')).toBe(500);
  });
});
