import { describe, expect, it } from 'vitest';
import { AirportHotelsService, AIRPORT_HOTELS_FETCH, decodeAirportHotels, distanceLabel } from './airport-hotels';
import { stayLinks, tonightCheckIn } from './stay-links';
import { TestBed } from '@angular/core/testing';

describe('stay links', () => {
  it('Booking.com, Hostelworld and Google Maps for tonight, plain links', () => {
    const l = stayLinks({ airportName: 'Montréal', code: 'YUL', checkIn: '2026-10-09' });
    expect(l.map(x => x.id)).toEqual(['booking', 'hostelworld', 'maps']);
    expect(l[0].href).toBe('https://www.booking.com/searchresults.html?ss=Montr%C3%A9al%20YUL%20Airport&checkin=2026-10-09&checkout=2026-10-10&group_adults=1&no_rooms=1');
    expect(l[1].href).toBe('https://www.hostelworld.com/s?q=Montr%C3%A9al%20YUL%20Airport&from=2026-10-09&to=2026-10-10&guests=1');
    expect(l[2].href).toBe('https://www.google.com/maps/search/?api=1&query=hotels%20near%20Montr%C3%A9al%20YUL%20Airport');
    for (const x of l) expect(x.href).not.toMatch(/aid=|aff|label=|utm_|tag=|marker/i);
  });

  it('keeps an airport name that already says airport; checkout rolls over the month', () => {
    const l = stayLinks({ airportName: 'Halifax Stanfield Airport', code: 'YHZ', checkIn: '2026-10-31' });
    expect(l[0].href).toContain('ss=Halifax%20Stanfield%20Airport&checkin=2026-10-31&checkout=2026-11-01');
  });

  it('tonight before 05:00 is last night\'s stay', () => {
    expect(tonightCheckIn('2026-10-09', '23:10')).toBe('2026-10-09');
    expect(tonightCheckIn('2026-10-09', '02:30')).toBe('2026-10-08');
  });
});

describe('airport hotels file', () => {
  const FILE = {
    v: 1, builtAt: '2026-10-06', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
    airports: { YUL: [['Far Inn', 45.5, -73.7, 2400], ['Near Hotel', 45.47, -73.74, 900], ['', 1, 2, 3], ['Bad', 'x', 1, 1]], YHZ: [] },
  };

  it('decodes, sorts by distance and drops bad rows and empty airports', () => {
    const f = decodeAirportHotels(FILE)!;
    expect([...f.airports.keys()]).toEqual(['YUL']);
    expect(f.airports.get('YUL')!.map(h => h.name)).toEqual(['Near Hotel', 'Far Inn']);
    expect(f.licenseUrl).toContain('opendatacommons.org');
  });

  it('rejects a wrong shape', () => {
    expect(decodeAirportHotels(null)).toBeNull();
    expect(decodeAirportHotels({ v: 2, airports: {} })).toBeNull();
    expect(decodeAirportHotels({ v: 1 })).toBeNull();
  });

  it('formats distances', () => {
    expect(distanceLabel(900)).toBe('900 m');
    expect(distanceLabel(20)).toBe('50 m');
    expect(distanceLabel(1240)).toBe('1.2 km');
  });

  it('the service loads once; a missing file gives no hotels', async () => {
    let calls = 0;
    TestBed.configureTestingModule({ providers: [{ provide: AIRPORT_HOTELS_FETCH, useValue: async () => { calls++; return structuredClone(FILE); } }] });
    const s = TestBed.inject(AirportHotelsService);
    await s.ensureLoaded();
    await s.ensureLoaded();
    expect(calls).toBe(1);
    expect(s.hotelsNear('YUL')).toHaveLength(2);
    expect(s.hotelsNear('ZZZ')).toEqual([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AIRPORT_HOTELS_FETCH, useValue: async () => null }] });
    const m = TestBed.inject(AirportHotelsService);
    await m.ensureLoaded();
    expect(m.hotelsNear('YUL')).toEqual([]);
    TestBed.resetTestingModule();
  });
});
