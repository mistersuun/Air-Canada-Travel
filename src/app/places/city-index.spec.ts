import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { cityHit, decodeCities, searchCities, servedByAc } from './city-index';
import { CITIES_FETCH, CityIndexService } from './city-index.service';
import { FIXTURE_CITIES_FILE } from './testing/cities-fixture';
import { countryName, parsePlaceId, placeFromDestination, placeFromHit, placeIdOf } from './place';

const index = decodeCities(FIXTURE_CITIES_FILE)!;
const names = (q: string, limit = 6) => searchCities(index, q, limit).map(r => `${r.name}/${r.iso2}`);

describe('decodeCities', () => {
  it('decodes the columnar file', () => {
    expect(index.rows.length).toBe(10);
    const sev = index.byId.get(2510911)!;
    expect(sev).toMatchObject({
      name: 'Seville', alt: ['Sevilla', 'Sevilha', 'Siviglia'], iso2: 'ES', admin1: 'Andalusia',
      lat: 37.38, lng: -5.97, population: 687_000, tz: 'Europe/Madrid',
    });
    expect(index.byId.get(496285)!.admin1).toBeNull();
  });

  it('rejects malformed files without throwing', () => {
    expect(decodeCities(null)).toBeNull();
    expect(decodeCities({ v: 2 })).toBeNull();
    expect(decodeCities({ ...FIXTURE_CITIES_FILE, cols: { ...FIXTURE_CITIES_FILE.cols, name: ['x'] } })).toBeNull();
    expect(decodeCities('garbage')).toBeNull();
  });
});

describe('searchCities', () => {
  it('finds Seville by prefix, Spanish and French names, accent-insensitively', () => {
    expect(names('sevil')[0]).toBe('Seville/ES');
    expect(names('Sevilla')[0]).toBe('Seville/ES');
    expect(names('séville')[0]).toBe('Seville/ES');
    expect(names('SEVILLE')[0]).toBe('Seville/ES');
  });

  it('finds Lisbon by lisboa and Montréal by montreal', () => {
    expect(names('lisboa')).toEqual(['Lisbon/PT']);
    expect(names('montreal')).toEqual(['Montréal/CA']);
    expect(names('krakow')).toEqual(['Kraków/PL']);
    expect(names('Cracovie')).toEqual(['Kraków/PL']);
  });

  it('ranks exact > prefix > word start > substring, population breaking ties', () => {
    expect(names('paris')).toEqual(['Paris/FR', 'Paris/US']);
    // 'sev' prefixes both; Seville is bigger.
    expect(names('sev')).toEqual(['Seville/ES', 'Severodvinsk/RU']);
    // 'york' starts a word in 'New York City' (tier 2).
    expect(names('york')).toEqual(['New York City/US']);
    // 'ville' is only a substring.
    expect(names('ville')).toEqual(['Seville/ES']);
    expect(names('her')).toEqual(['Dos Hermanas/ES']);
  });

  it('ignores a ", country" suffix, short queries and the limit', () => {
    expect(names('Seville, Spain')[0]).toBe('Seville/ES');
    expect(names('s')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('paris', 1)).toEqual(['Paris/FR']);
    expect(searchCities(null, 'paris')).toEqual([]);
  });
});

describe('servedBy and places', () => {
  it('marks a city AC flies to itself', () => {
    expect(servedByAc(index.byId.get(2267057)!)).toBe('LIS');
    expect(servedByAc(index.byId.get(6077243)!)).toBe('YUL');
    expect(servedByAc(index.byId.get(2510911)!)).toBeNull();
    expect(servedByAc(index.byId.get(9999001)!)).toBeNull();
  });

  it('builds Places with country names and GeoNames ids', () => {
    const hit = cityHit(index.byId.get(2510911)!);
    expect(hit.population).toBe(687_000);
    expect(hit.servedBy).toBeNull();
    expect(hit.place).toEqual({
      id: 'gn-2510911', name: 'Seville', country: 'Spain', iso2: 'ES', lat: 37.38, lng: -5.97,
      tz: 'Europe/Madrid', admin1: 'Andalusia',
    });
    expect(placeIdOf(hit.place)).toBe('gn-2510911');
    const lis = placeFromHit(cityHit(index.byId.get(2267057)!));
    expect(lis.acCode).toBe('LIS');
  });

  it('parses place ids', () => {
    expect(parsePlaceId('gn-2510911')).toEqual({ kind: 'gn', geonameId: 2510911 });
    expect(parsePlaceId('ac-LIS')).toEqual({ kind: 'ac', code: 'LIS' });
    expect(parsePlaceId('gn-')).toBeNull();
    expect(parsePlaceId('ac-lis')).toBeNull();
    expect(parsePlaceId(null)).toBeNull();
  });

  it('builds a Place for an AC destination or hub', () => {
    expect(placeFromDestination('LIS')).toMatchObject({
      id: 'ac-LIS', name: 'Lisbon', country: 'Portugal', iso2: 'PT', tz: 'Europe/Lisbon', acCode: 'LIS',
    });
    expect(placeFromDestination('YUL')).toMatchObject({ id: 'ac-YUL', name: 'Montréal', iso2: 'CA', acCode: 'YUL' });
    expect(placeFromDestination('ZZZ')).toMatchObject({ id: 'ac-ZZZ', iso2: '' });
    expect(countryName('ES')).toBe('Spain');
    expect(countryName('x')).toBe('');
  });
});

describe('CityIndexService', () => {
  function setup(fetcher: () => Promise<unknown>) {
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: CITIES_FETCH, useValue: () => { calls++; return fetcher(); } }],
    });
    return { svc: TestBed.inject(CityIndexService), calls: () => calls };
  }

  it('does not fetch until asked, then loads once', async () => {
    const { svc, calls } = setup(async () => FIXTURE_CITIES_FILE);
    expect(svc.status()).toBe('idle');
    expect(svc.search('sevilla')).toEqual([]);
    expect(calls()).toBe(0);
    const p = svc.ensureLoaded();
    expect(svc.status()).toBe('loading');
    const again = svc.ensureLoaded();
    expect(await p).toBe(true);
    expect(await again).toBe(true);
    expect(await svc.ensureLoaded()).toBe(true);
    expect(calls()).toBe(1);
    expect(svc.status()).toBe('ready');
    expect(svc.search('sevilla')[0].place.name).toBe('Seville');
    expect(svc.byId('gn-2510911')?.name).toBe('Seville');
    expect(svc.byId('gn-2267057')?.acCode).toBe('LIS');
    expect(svc.byId('gn-1')).toBeNull();
  });

  it('degrades to empty results when the file is missing, and can retry', async () => {
    let ok = false;
    const { svc, calls } = setup(async () => {
      if (!ok) throw new Error('404');
      return FIXTURE_CITIES_FILE;
    });
    expect(await svc.ensureLoaded()).toBe(false);
    expect(svc.status()).toBe('error');
    expect(svc.search('seville')).toEqual([]);
    expect(svc.byId('gn-2510911')).toBeNull();
    expect(svc.byId('ac-LIS')?.name).toBe('Lisbon');
    expect(svc.byId('ac-ZZZ')).toBeNull();
    ok = true;
    expect(await svc.ensureLoaded()).toBe(true);
    expect(calls()).toBe(2);
  });

  it('treats a malformed file as an error', async () => {
    const { svc } = setup(async () => ({ v: 9 }));
    expect(await svc.ensureLoaded()).toBe(false);
    expect(svc.status()).toBe('error');
  });
});
