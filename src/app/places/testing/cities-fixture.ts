/**
 * A small cities.json in the real columnar format, for specs. Built from
 * plain records by encodeCities (the same layout scripts/build-cities.py writes).
 */
import type { CitiesFile } from '../city-index';

export interface FixtureCity {
  id: number; name: string; alt?: string[]; cc: string; admin1?: string;
  lat: number; lng: number; popK: number; tz: string;
}

export function encodeCities(cities: FixtureCity[]): CitiesFile {
  const rows = [...cities].sort((a, b) => a.id - b.id);
  const tz: string[] = [];
  const cc: string[] = [];
  const rg: [number, string][] = [];
  const idx = <T>(arr: T[], v: T, eq: (a: T, b: T) => boolean = (a, b) => a === b) => {
    let i = arr.findIndex(x => eq(x, v));
    if (i < 0) i = arr.push(v) - 1;
    return i;
  };
  const cols: CitiesFile['cols'] = { id: [], name: [], alt: [], rg: [], lat: [], lng: [], pop: [], tz: [] };
  let prev = 0;
  for (const c of rows) {
    cols.id.push(c.id - prev);
    prev = c.id;
    cols.name.push(c.name);
    cols.alt.push((c.alt ?? []).join('|'));
    const ci = idx(cc, c.cc);
    cols.rg.push(idx(rg, [ci, c.admin1 ?? ''] as [number, string], (a, b) => a[0] === b[0] && a[1] === b[1]));
    cols.lat.push(Math.round(c.lat * 100));
    cols.lng.push(Math.round(c.lng * 100));
    cols.pop.push(c.popK);
    cols.tz.push(idx(tz, c.tz));
  }
  return {
    v: 1, source: 'fixture', license: 'CC BY 4.0', attribution: 'GeoNames (geonames.org)',
    generatedAt: '2026-10-01T00:00:00Z', tz, cc, rg, cols,
  };
}

export const FIXTURE_CITIES: FixtureCity[] = [
  { id: 2510911, name: 'Seville', alt: ['Sevilla', 'Sevilha', 'Siviglia'], cc: 'ES', admin1: 'Andalusia', lat: 37.38, lng: -5.97, popK: 687, tz: 'Europe/Madrid' },
  { id: 2267057, name: 'Lisbon', alt: ['Lisbonne', 'Lisboa', 'Lissabon', 'Lisbona'], cc: 'PT', admin1: 'Lisbon', lat: 38.73, lng: -9.15, popK: 518, tz: 'Europe/Lisbon' },
  { id: 6077243, name: 'Montréal', cc: 'CA', admin1: 'Quebec', lat: 45.51, lng: -73.59, popK: 1763, tz: 'America/Toronto' },
  { id: 3094802, name: 'Kraków', alt: ['Cracovie', 'Cracovia', 'Krakau'], cc: 'PL', admin1: 'Lesser Poland', lat: 50.06, lng: 19.94, popK: 817, tz: 'Europe/Warsaw' },
  { id: 2988507, name: 'Paris', alt: ['Parigi'], cc: 'FR', admin1: 'Île-de-France', lat: 48.85, lng: 2.35, popK: 2139, tz: 'Europe/Paris' },
  { id: 4717560, name: 'Paris', cc: 'US', admin1: 'Texas', lat: 33.66, lng: -95.56, popK: 25, tz: 'America/Chicago' },
  { id: 496285, name: 'Severodvinsk', cc: 'RU', lat: 64.56, lng: 39.83, popK: 192, tz: 'Europe/Moscow' },
  { id: 5128581, name: 'New York City', alt: ['New York', 'Nueva York'], cc: 'US', admin1: 'New York', lat: 40.71, lng: -74.01, popK: 8804, tz: 'America/New_York' },
  { id: 2517117, name: 'Granada', alt: ['Grenade'], cc: 'ES', admin1: 'Andalusia', lat: 37.19, lng: -3.61, popK: 234, tz: 'Europe/Madrid' },
  { id: 9999001, name: 'Dos Hermanas', cc: 'ES', admin1: 'Andalusia', lat: 37.28, lng: -5.92, popK: 133, tz: 'Europe/Madrid' },
];

export const FIXTURE_CITIES_FILE: CitiesFile = encodeCities(FIXTURE_CITIES);
