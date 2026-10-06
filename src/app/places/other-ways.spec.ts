import { describe, expect, it } from 'vitest';
import type { LegEnd } from '../trips/model';
import { airportEnd } from './ground';
import { BUSBUD_URL, FLIXBUS_URL, OMIO_URL, cityName, kiwiUrl, otherWays, rome2rioUrl, slug } from './other-ways';

const YUL = airportEnd('YUL')!;
const QUEBEC: LegEnd = { name: 'Québec City', lat: 46.81, lng: -71.21 };

describe('other ways: builders', () => {
  it('slugs strip accents and punctuation', () => {
    expect(slug('Québec City')).toBe('quebec-city');
    expect(slug("St. John's")).toBe('st-john-s');
    expect(slug('Bath & Wells')).toBe('bath-and-wells');
  });

  it('drops airport words from the place name', () => {
    expect(cityName({ name: 'Madrid Barajas Airport', lat: 0, lng: 0 })).toBe('Madrid Barajas');
    expect(cityName({ name: 'Montreal', lat: 0, lng: 0 })).toBe('Montreal');
  });

  it('bus sites are plain home pages', () => {
    expect(BUSBUD_URL).toBe('https://www.busbud.com/en');
    expect(FLIXBUS_URL).toBe('https://www.flixbus.com/');
    expect(OMIO_URL).toBe('https://www.omio.com/');
  });

  it('Rome2Rio carries the route', () => {
    expect(rome2rioUrl(YUL, QUEBEC)).toContain('https://www.rome2rio.com/map/Montr%C3%A9al-YUL-Airport/');
  });

  it('Kiwi.com deep link needs two airport codes and a date', () => {
    expect(kiwiUrl('YUL', 'SVQ', '2026-10-09')).toBe('https://www.kiwi.com/deep?from=YUL&to=SVQ&departure=2026-10-09');
    expect(kiwiUrl('YUL', undefined, '2026-10-09')).toBeNull();
    expect(kiwiUrl('YUL', 'YUL', '2026-10-09')).toBeNull();
    expect(kiwiUrl('YUL', 'YHZ', 'tomorrow')).toBeNull();
    expect(kiwiUrl('Montreal', 'YHZ', '2026-10-09')).toBeNull();
  });
});

describe('other ways: the list', () => {
  const ways = otherWays({ from: YUL, to: QUEBEC, dateKey: '2026-10-09', toAirport: 'YQB' });

  it('shows the route in each label, in order, with Kiwi.com last', () => {
    expect(ways.map(w => w.id)).toEqual(['busbud', 'flixbus', 'omio', 'rome2rio', 'kiwi']);
    expect(ways.map(w => w.label)).toEqual([
      'Search YUL → Québec City on Busbud ↗', 'Search YUL → Québec City on FlixBus ↗', 'Search YUL → Québec City on Omio ↗',
      'Search YUL → Québec City on Rome2Rio ↗', 'Search flights YUL → YQB on Kiwi.com ↗',
    ]);
    expect(ways[4].href).toBe('https://www.kiwi.com/deep?from=YUL&to=YQB&departure=2026-10-09');
  });

  it('has no affiliate ids, tags or prices, only https', () => {
    for (const w of ways) {
      expect(w.href).toMatch(/^https:\/\//);
      expect(w.href).not.toMatch(/aff|partner|utm_|tag=|ref=|price|marker/i);
    }
  });

  it('skips bus and train sites without a land route', () => {
    const w = otherWays({ from: YUL, to: QUEBEC, dateKey: '2026-10-09', land: false });
    expect(w.map(x => x.id)).toEqual(['rome2rio']);
  });
});
