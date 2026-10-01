/**
 * The GeoNames city index (public/data/cities.json, built by
 * scripts/build-cities.py): decoding and accent-insensitive search. Pure.
 */
import type { Place } from '../trips/model';
import { greatCircleKm } from '../utils/geo';
import { normalizeText } from '../utils/routes';
import { acAirports, countryName } from './place';

export const CITIES_URL = 'data/cities.json';

/** The columnar file as written by scripts/build-cities.py. */
export interface CitiesFile {
  v: 1;
  source: string;
  license: string;
  attribution: string;
  generatedAt: string;
  tz: string[];
  cc: string[];
  /** (index into cc, region name or '') pairs. */
  rg: [number, string][];
  cols: {
    id: number[];      // delta-encoded geonameids
    name: string[];
    alt: string[];     // '|'-joined
    rg: number[];
    lat: number[];     // hundredths of a degree
    lng: number[];
    pop: number[];     // thousands
    tz: number[];
  };
}

export interface CityRecord {
  geonameId: number;
  name: string;
  alt: string[];
  iso2: string;
  admin1: string | null;
  lat: number;
  lng: number;
  /** People (rounded to the thousand). */
  population: number;
  tz: string | null;
}

export interface CityIndex {
  rows: CityRecord[];
  /** Normalised [name, ...alt] per row, same order as rows. */
  keys: string[][];
  byId: ReadonlyMap<number, CityRecord>;
  generatedAt: string | null;
}

/** A search result. `servedBy` is the AC airport when AC flies to this city itself. */
export interface CityHit {
  place: Place;
  /** People (rounded to the thousand). */
  population: number;
  servedBy: string | null;
}

/** An AC airport within this distance whose city name matches serves the city. */
export const SERVED_BY_KM = 40;

const isArr = Array.isArray;

/** Decodes cities.json; null when the shape is wrong (never throws). */
export function decodeCities(file: unknown): CityIndex | null {
  try {
    const f = file as CitiesFile;
    if (!f || f.v !== 1 || !isArr(f.tz) || !isArr(f.cc) || !isArr(f.rg) || !f.cols) return null;
    const c = f.cols;
    const n = c.id?.length ?? 0;
    for (const k of ['name', 'alt', 'rg', 'lat', 'lng', 'pop', 'tz'] as const) {
      if (!isArr(c[k]) || c[k].length !== n) return null;
    }
    const rows: CityRecord[] = [];
    const keys: string[][] = [];
    const byId = new Map<number, CityRecord>();
    let id = 0;
    for (let i = 0; i < n; i++) {
      id += c.id[i];
      const [ccIdx, region] = f.rg[c.rg[i]] ?? [-1, ''];
      const iso2 = f.cc[ccIdx];
      const name = c.name[i];
      if (typeof name !== 'string' || !name || typeof iso2 !== 'string') continue;
      const alt = typeof c.alt[i] === 'string' && c.alt[i] ? c.alt[i].split('|').filter(Boolean) : [];
      const rec: CityRecord = {
        geonameId: id,
        name,
        alt,
        iso2,
        admin1: region || null,
        lat: c.lat[i] / 100,
        lng: c.lng[i] / 100,
        population: (c.pop[i] || 0) * 1000,
        tz: f.tz[c.tz[i]] ?? null,
      };
      rows.push(rec);
      keys.push([name, ...alt].map(normalizeText));
      byId.set(id, rec);
    }
    return { rows, keys, byId, generatedAt: typeof f.generatedAt === 'string' ? f.generatedAt : null };
  } catch {
    return null;
  }
}

/** The Place of a city record ('gn-<id>'). */
export function placeFromCity(rec: CityRecord): Place {
  const place: Place = {
    id: `gn-${rec.geonameId}`,
    name: rec.name,
    country: countryName(rec.iso2),
    iso2: rec.iso2,
    lat: rec.lat,
    lng: rec.lng,
    tz: rec.tz,
  };
  if (rec.admin1) place.admin1 = rec.admin1;
  return place;
}

/**
 * Match tier of a normalised query against a row's names: 0 exact, 1 prefix,
 * 2 a later word starts with it ('york' in 'new york'), 3 substring; -1 none.
 */
function tier(keys: readonly string[], q: string): number {
  let best = -1;
  for (const k of keys) {
    let t = -1;
    if (k === q) t = 0;
    else if (k.startsWith(q)) t = 1;
    else {
      const at = k.indexOf(q);
      if (at > 0) t = /[\s\-'’.]/.test(k[at - 1]) ? 2 : 3;
    }
    if (t >= 0 && (best < 0 || t < best)) best = t;
    if (best === 0) break;
  }
  return best;
}

/** Strips a trailing ', Spain' style qualifier and normalises. */
function normalizeQuery(q: string): string {
  return normalizeText(q.split(',')[0] ?? '').replace(/\s+/g, ' ');
}

/**
 * Cities matching `q` accent- and case-insensitively on the name or an
 * alternate name ('sevilla', 'Séville' → Seville). Exact beats prefix beats
 * word start beats substring; population breaks ties. Queries under 2
 * characters return [].
 */
export function searchCities(index: CityIndex | null, q: string, limit = 6): CityRecord[] {
  const nq = normalizeQuery(q ?? '');
  if (!index || nq.length < 2 || limit <= 0) return [];
  const found: { rec: CityRecord; tier: number }[] = [];
  for (let i = 0; i < index.rows.length; i++) {
    const t = tier(index.keys[i], nq);
    if (t >= 0) found.push({ rec: index.rows[i], tier: t });
  }
  found.sort((a, b) => a.tier - b.tier || b.rec.population - a.rec.population || a.rec.name.localeCompare(b.rec.name));
  return found.slice(0, limit).map(f => f.rec);
}

let airportKeys: (ReturnType<typeof acAirports>[number] & { key: string })[] | null = null;

function nameMatches(a: string, b: string): boolean {
  return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
}

/**
 * The AC airport (destination or hub) serving this city: within SERVED_BY_KM
 * and its normalised city name matches the city's name or an alternate name
 * ('Lisbon' → LIS, 'Montréal' → YUL). Null otherwise.
 */
export function servedByAc(rec: Pick<CityRecord, 'name' | 'alt' | 'lat' | 'lng'>): string | null {
  const names = [rec.name, ...rec.alt].map(normalizeText);
  let best: { code: string; km: number } | null = null;
  airportKeys ??= acAirports().map(a => ({ ...a, key: normalizeText(a.city) }));
  for (const a of airportKeys) {
    const km = greatCircleKm(rec, a);
    if (km > SERVED_BY_KM) continue;
    if (!names.some(n => nameMatches(n, a.key))) continue;
    if (!best || km < best.km) best = { code: a.code, km };
  }
  return best?.code ?? null;
}

/** A search record as a hit. */
export function cityHit(rec: CityRecord): CityHit {
  return { place: placeFromCity(rec), population: rec.population, servedBy: servedByAc(rec) };
}
