/**
 * "Other ways there": plain deep links to other sites that search buses,
 * trains and cheap flights for the distance still to go. One builder module so
 * every URL format sits in one place with its spec (other-ways.spec.ts).
 *
 * Rules: plain links only. No affiliate ids, no tracking parameters, no
 * prices, no odds: we only say where to look. Each opens in a new tab and
 * needs internet.
 *
 * URL formats (taken from each site's public search pages; the sites do not
 * publish a stable contract, so if one stops working the worst case is that
 * it opens its own search form):
 *   Busbud    https://www.busbud.com/en/bus-<from>-<to>?outbound_date=YYYY-MM-DD
 *   FlixBus   https://shop.flixbus.com/search?departureCity=<from>&arrivalCity=<to>&rideDate=DD.MM.YYYY&adult=1
 *   Omio      https://www.omio.com/search?from=<from>&to=<to>&date=YYYY-MM-DD
 *   Rome2Rio  https://www.rome2rio.com/map/<From>/<To>   (the same builder onwardLinks() uses)
 *   Kiwi.com  https://www.kiwi.com/en/search/results/<from>/<to>/<YYYY-MM-DD>/no-return   (IATA codes)
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

export function busbudUrl(from: LegEnd, to: LegEnd, dateKey: string): string {
  return `https://www.busbud.com/en/bus-${slug(cityName(from))}-${slug(cityName(to))}?outbound_date=${q(dateKey)}`;
}

export function flixbusUrl(from: LegEnd, to: LegEnd, dateKey: string): string {
  const d = ymd(dateKey);
  const date = d ? `&rideDate=${d.d}.${d.m}.${d.y}` : '';
  return `https://shop.flixbus.com/search?departureCity=${q(cityName(from))}&arrivalCity=${q(cityName(to))}${date}&adult=1`;
}

export function omioUrl(from: LegEnd, to: LegEnd, dateKey: string): string {
  return `https://www.omio.com/search?from=${q(cityName(from))}&to=${q(cityName(to))}&date=${q(dateKey)}`;
}

export function rome2rioUrl(from: LegEnd, to: LegEnd): string {
  return `https://www.rome2rio.com/map/${rome2rioName(from)}/${rome2rioName(to)}`;
}

/** Kiwi.com one-way flight search; null unless both ends are airports (IATA code). */
export function kiwiUrl(fromCode: string | undefined, toCode: string | undefined, dateKey: string): string | null {
  if (!fromCode || !toCode || fromCode === toCode || !ymd(dateKey)) return null;
  if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) return null;
  return `https://www.kiwi.com/en/search/results/${fromCode.toLowerCase()}/${toCode.toLowerCase()}/${dateKey}/no-return`;
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
  if (input.land !== false) {
    out.push(
      { id: 'busbud', label: 'Search on Busbud ↗', href: busbudUrl(from, to, dateKey) },
      { id: 'flixbus', label: 'Search on FlixBus ↗', href: flixbusUrl(from, to, dateKey) },
      { id: 'omio', label: 'Search on Omio ↗', href: omioUrl(from, to, dateKey) },
    );
  }
  out.push({ id: 'rome2rio', label: 'Search on Rome2Rio ↗', href: rome2rioUrl(from, to) });
  const kiwi = kiwiUrl(from.code, input.toAirport ?? to.code, dateKey);
  if (kiwi) out.push({ id: 'kiwi', label: 'Search flights on Kiwi.com ↗', href: kiwi });
  return out;
}
