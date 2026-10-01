/**
 * Place helpers: a Place is where the traveller wants to be, either a GeoNames
 * city ('gn-2510911', Seville) or an Air Canada destination/hub ('ac-LIS').
 */
import { DESTINATIONS, HUBS } from '../data/destinations';
import type { Place } from '../trips/model';
import { airportName, airportTz, findDestination, findHub } from '../utils/airports';
import { hubDisplayName } from '../ui/format';
import type { CityHit } from './city-index';

export type ParsedPlaceId = { kind: 'gn'; geonameId: number } | { kind: 'ac'; code: string };

/** 'gn-2510911' → { kind: 'gn', geonameId }, 'ac-LIS' → { kind: 'ac', code }; null when malformed. */
export function parsePlaceId(id: string | null | undefined): ParsedPlaceId | null {
  if (!id) return null;
  const gn = /^gn-(\d{1,10})$/.exec(id);
  if (gn) return { kind: 'gn', geonameId: Number(gn[1]) };
  const ac = /^ac-([A-Z]{3})$/.exec(id);
  if (ac) return { kind: 'ac', code: ac[1] };
  return null;
}

export function placeIdOf(place: Pick<Place, 'id'>): string {
  return place.id;
}

let regionNames: Intl.DisplayNames | null | undefined;

/** English country name from ISO 3166-1 alpha-2 ('ES' → 'Spain'); the code when Intl cannot tell. */
export function countryName(iso2: string | null | undefined): string {
  const code = (iso2 ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The Place for an AC destination or hub ('LIS' → Lisbon, Portugal, acCode
 * 'LIS'). An unknown code still yields a usable Place named after the code.
 */
export function placeFromDestination(code: string): Place {
  const d = findDestination(code);
  if (d) {
    return {
      id: `ac-${d.code}`, name: d.city, country: countryName(d.iso2) || d.country, iso2: d.iso2,
      lat: d.lat, lng: d.lng, tz: d.tz, acCode: d.code,
    };
  }
  const h = findHub(code);
  if (h) {
    return {
      id: `ac-${h.code}`, name: hubDisplayName(h.code), country: countryName('CA') || 'Canada', iso2: 'CA',
      lat: h.lat, lng: h.lng, tz: h.tz, acCode: h.code,
    };
  }
  return { id: `ac-${code}`, name: airportName(code), country: '', iso2: '', lat: 0, lng: 0, tz: airportTz(code), acCode: code };
}

/** True when `code` is an AC destination or hub. */
export function isAcAirport(code: string): boolean {
  return !!(findDestination(code) || findHub(code));
}

/** The Place of a city search hit. A hit served by AC itself carries `acCode`. */
export function placeFromHit(hit: CityHit): Place {
  return hit.servedBy ? { ...hit.place, acCode: hit.servedBy } : hit.place;
}

/** Every AC airport as a gateway candidate: destinations then hubs. */
export function acAirports(): { code: string; city: string; iso2: string; lat: number; lng: number; tz: string }[] {
  return [
    ...DESTINATIONS.map(d => ({ code: d.code, city: d.city, iso2: d.iso2, lat: d.lat, lng: d.lng, tz: d.tz })),
    ...HUBS.map(h => ({ code: h.code, city: hubDisplayName(h.code), iso2: 'CA', lat: h.lat, lng: h.lng, tz: h.tz })),
  ];
}
