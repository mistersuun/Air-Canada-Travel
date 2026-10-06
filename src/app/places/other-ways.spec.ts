import { describe, expect, it } from 'vitest';
import type { LegEnd } from '../trips/model';
import { airportEnd } from './ground';
import { busbudUrl, cityName, flixbusUrl, kiwiUrl, omioUrl, otherWays, rome2rioUrl, slug } from './other-ways';

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

  it('Busbud: city slugs and the date', () => {
    expect(busbudUrl(YUL, QUEBEC, '2026-10-09')).toBe('https://www.busbud.com/en/bus-montreal-quebec-city?outbound_date=2026-10-09');
  });

  it('FlixBus: names and DD.MM.YYYY', () => {
    expect(flixbusUrl(YUL, QUEBEC, '2026-10-09'))
      .toBe('https://shop.flixbus.com/search?departureCity=Montr%C3%A9al&arrivalCity=Qu%C3%A9bec%20City&rideDate=09.10.2026&adult=1');
  });

  it('Omio and Rome2Rio', () => {
    expect(omioUrl(YUL, QUEBEC, '2026-10-09')).toBe('https://www.omio.com/search?from=Montr%C3%A9al&to=Qu%C3%A9bec%20City&date=2026-10-09');
    expect(rome2rioUrl(YUL, QUEBEC)).toContain('https://www.rome2rio.com/map/Montr%C3%A9al-YUL-Airport/');
  });

  it('Kiwi.com needs two airport codes and a date', () => {
    expect(kiwiUrl('YUL', 'YHZ', '2026-10-09')).toBe('https://www.kiwi.com/en/search/results/yul/yhz/2026-10-09/no-return');
    expect(kiwiUrl('YUL', undefined, '2026-10-09')).toBeNull();
    expect(kiwiUrl('YUL', 'YUL', '2026-10-09')).toBeNull();
    expect(kiwiUrl('YUL', 'YHZ', 'tomorrow')).toBeNull();
    expect(kiwiUrl('Montreal', 'YHZ', '2026-10-09')).toBeNull();
  });
});

describe('other ways: the list', () => {
  const ways = otherWays({ from: YUL, to: QUEBEC, dateKey: '2026-10-09', toAirport: 'YQB' });

  it('is labelled "Search on X ↗", in order, with Kiwi.com last', () => {
    expect(ways.map(w => w.id)).toEqual(['busbud', 'flixbus', 'omio', 'rome2rio', 'kiwi']);
    expect(ways.map(w => w.label)).toEqual([
      'Search on Busbud ↗', 'Search on FlixBus ↗', 'Search on Omio ↗', 'Search on Rome2Rio ↗', 'Search flights on Kiwi.com ↗',
    ]);
    expect(ways[4].href).toBe('https://www.kiwi.com/en/search/results/yul/yqb/2026-10-09/no-return');
  });

  it('has no affiliate ids, tags or prices, only https', () => {
    for (const w of ways) {
      expect(w.href).toMatch(/^https:\/\//);
      expect(w.href).not.toMatch(/aff|partner|utm_|tag=|ref=|price|marker/i);
    }
  });

  it('skips bus and train sites without a land route, and Kiwi without an airport', () => {
    const w = otherWays({ from: YUL, to: QUEBEC, dateKey: '2026-10-09', land: false });
    expect(w.map(x => x.id)).toEqual(['rome2rio']);
  });
});
