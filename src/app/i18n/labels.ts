/**
 * Display labels for data values that double as identifiers (regions, trip
 * types, departure windows, trip lengths). The identifiers stay English in
 * data, URLs and storage; only what is shown goes through here. Unknown
 * values are shown as they are.
 */
import { MsgKey, t } from './t';

const REGION_KEYS: Readonly<Record<string, MsgKey>> = {
  All: 'data.region.all',
  Starred: 'data.region.starred',
  Caribbean: 'data.region.caribbean',
  Mexico: 'data.region.mexico',
  USA: 'data.region.usa',
  Europe: 'data.region.europe',
  'Asia & Pacific': 'data.region.asiaPacific',
  'Central America': 'data.region.centralAmerica',
  'South America': 'data.region.southAmerica',
  'Africa & Middle East': 'data.region.africaMiddleEast',
};

const TYPE_KEYS: Readonly<Record<string, MsgKey>> = {
  Sun: 'data.type.sun',
  City: 'data.type.city',
  Adventure: 'data.type.adventure',
};

const WINDOW_KEYS: Readonly<Record<string, MsgKey>> = {
  morning: 'data.window.morning',
  afternoon: 'data.window.afternoon',
  evening: 'data.window.evening',
  redeye: 'data.window.redeye',
};

const LENGTH_KEYS: Readonly<Record<string, MsgKey>> = {
  day: 'data.length.day',
  weekend: 'data.length.weekend',
  week: 'data.length.week',
};

function label(keys: Readonly<Record<string, MsgKey>>, v: string): string {
  const k = keys[v];
  return k ? t(k) : v;
}

/** 'All regions', '★ Starred', 'Asia & Pacific' / 'Toutes les régions', '★ Favoris', 'Asie et Pacifique'. */
export function regionLabel(region: string): string {
  return label(REGION_KEYS, region);
}

/** 'Sun' / 'Soleil' (a DestinationType or TripStyle). */
export function typeLabel(type: string): string {
  return label(TYPE_KEYS, type);
}

/** 'Morning' / 'Matin' (a DepartWindow key). */
export function departWindowLabel(w: string): string {
  return label(WINDOW_KEYS, w);
}

/** 'Day trip' / 'Journée' (a TripLength). */
export function tripLengthLabel(l: string): string {
  return label(LENGTH_KEYS, l);
}
