/**
 * "Other ways there": plain deep links to other sites that search buses,
 * trains and cheap flights for the distance still to go. One builder module so
 * every URL format sits in one place with its spec (other-ways.spec.ts).
 *
 * Rules: plain links only. No affiliate ids, no tracking parameters, no
 * prices, no odds: we only say where to look. Each opens in a new tab and
 * needs internet.
 *
 * Link targets: Busbud, FlixBus and Omio only get their home page (their
 * search URLs need internal ids we cannot build), so the label carries the
 * route ("Search YUL -> Quebec on Busbud"). Rome2Rio and Kiwi.com take the
 * route and date in the URL:
 *   Busbud    https://www.busbud.com/en
 *   FlixBus   https://www.flixbus.com/
 *   Omio      https://www.omio.com/
 *   Rome2Rio  https://www.rome2rio.com/map/<From>/<To>   (the same builder onwardLinks() uses)
 *   Kiwi.com  https://www.kiwi.com/deep?from=YUL&to=SVQ&departure=YYYY-MM-DD   (IATA codes)
 */
import type { LegEnd } from '../trips/model';
import { rome2rioName } from './ground';

export type OtherWayId = 'busbud' | 'flixbus' | 'omio' | 'rome2rio' | 'kiwi';

export interface OtherWay {
  id: OtherWayId;
  /** 'Search on Busbud ↗' */
  label: string;
  href: string;
}

/** Lower-case ascii slug: 'Québec City' -> 'quebec-city'. */
export function slug(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The place name without airport words ('Madrid Barajas Airport' -> 'Madrid Barajas'): the city a coach or train leaves from. */
export function cityName(end: LegEnd): string {
  return end.name.replace(/\b(international|intl\.?|airport)\b/gi, '').replace(/\s+/g, ' ').trim() || end.name;
}

const q = encodeURIComponent;

function ymd(dateKey: string): { y: string; m: string; d: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  return m ? { y: m[1], m: m[2], d: m[3] } : null;
}

export const BUSBUD_URL = 'https://www.busbud.com/en';
export const FLIXBUS_URL = 'https://www.flixbus.com/';
export const OMIO_URL = 'https://www.omio.com/';

export function rome2rioUrl(from: LegEnd, to: LegEnd): string {
  return `https://www.rome2rio.com/map/${rome2rioName(from)}/${rome2rioName(to)}`;
}

/** Kiwi.com one-way flight search; null unless both ends are airports (IATA code). */
export function kiwiUrl(fromCode: string | undefined, toCode: string | undefined, dateKey: string): string | null {
  if (!fromCode || !toCode || fromCode === toCode || !ymd(dateKey)) return null;
  if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) return null;
  return `https://www.kiwi.com/deep?from=${fromCode}&to=${toCode}&departure=${dateKey}`;
}

/** 'YUL' for an airport end, else the city name. */
function shortName(end: LegEnd): string {
  return end.code && /^[A-Z]{3}$/.test(end.code) ? end.code : cityName(end);
}

/**
 * The links for getting from `from` to `to` on `dateKey` (local date at `from`).
 * `toAirport` is the airport code to search flights to (the goal's AC airport
 * when it has one). Bus and train links only when `land` is not false (a
 * ground route exists); Rome2Rio always; Kiwi.com only with two airport codes.
 */
export function otherWays(input: {
  from: LegEnd; to: LegEnd; dateKey: string; land?: boolean; toAirport?: string;
}): OtherWay[] {
  const { from, to, dateKey } = input;
  const out: OtherWay[] = [];
  const route = `${shortName(from)} \u2192 ${cityName(to)}`;
  if (input.land !== false) {
    out.push(
      { id: 'busbud', label: `Search ${route} on Busbud \u2197`, href: BUSBUD_URL },
      { id: 'flixbus', label: `Search ${route} on FlixBus \u2197`, href: FLIXBUS_URL },
      { id: 'omio', label: `Search ${route} on Omio \u2197`, href: OMIO_URL },
    );
  }
  out.push({ id: 'rome2rio', label: `Search ${route} on Rome2Rio \u2197`, href: rome2rioUrl(from, to) });
  const toCode = input.toAirport ?? to.code;
  const kiwi = kiwiUrl(from.code, toCode, dateKey);
  if (kiwi) out.push({ id: 'kiwi', label: `Search flights ${from.code} \u2192 ${toCode} on Kiwi.com \u2197`, href: kiwi });
  return out;
}
