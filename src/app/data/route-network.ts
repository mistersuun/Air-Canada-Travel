/**
 * Route network: which Air Canada routes are flown, without times.
 *
 * - public/data/route-network.json is written by scripts/fetch-route-network.py
 *   from the "Airlines and destinations" tables of the hub airports' English
 *   Wikipedia articles (CC BY-SA 4.0) and OurAirports (public domain).
 * - It fills a gap in schedules.json, which only covers the Air Canada
 *   Vacations PDFs: many Air Canada Express routes (YHZ-BOS, YHZ-EWR,
 *   YHZ-YDF) and some hub-to-hub legs (YHZ-YOW) are flown but not in it.
 * - It says a route is flown, never when. The UI shows such a route as
 *   "Flies this route · times not in our data" with the Unknown provenance
 *   tag and a link to aircanada.com. It never invents times.
 * - Published schedules always win: isRouteOnly() is true only when the
 *   schedules have no flight for the pair in either direction.
 *
 * Mirrors schedule-index.ts: load at startup (resolves false on failure, the
 * app still starts), and setRouteNetworkSource()/resetRouteNetworkSource()
 * for specs.
 */
import { registerExtraAirports } from '../utils/airports';
import { getSchedulesForRoute } from './schedule-index';

export type RouteBrand = 'mainline' | 'express' | 'rouge';

/** What the file says about one route (either direction). */
export interface RouteFact {
  brands: readonly RouteBrand[];
  /** Listed as seasonal. */
  seasonal: boolean;
  /** New route not flying yet: first day (YYYY-MM-DD). */
  begins: string | null;
  /** Last day, when the route is ending. */
  ends: string | null;
  /** Paused route (resumes / suspended until): first day back. */
  resumes: string | null;
}

/** [brands 'AXR', seasonal 0|1, begins, ends, resumes]. */
export type EncodedRouteFact = readonly [string, number, string | null, string | null, string | null];
/** [name, ISO country, IANA tz, lat, lng]. */
export type EncodedAirport = readonly [string, string, string, number, number];

export interface RouteNetworkSourceRef {
  hub: string;
  title: string;
  revid: number;
  url: string;
  routes?: number;
}

export interface RouteNetworkMeta {
  builtAt?: string;
  routeCount?: number;
  airportCount?: number;
  sources?: readonly RouteNetworkSourceRef[];
}

/** public/data/route-network.json. */
export interface RouteNetworkFile {
  version: number;
  license: string;
  attribution: string;
  meta?: RouteNetworkMeta;
  airports?: Readonly<Record<string, EncodedAirport>>;
  /** Undirected 'YHZ-BOS' keys (hub first). */
  routes: Readonly<Record<string, EncodedRouteFact>>;
}

export interface RouteNetwork {
  routes: ReadonlyMap<string, RouteFact>;
  airports: Readonly<Record<string, EncodedAirport>>;
  meta: RouteNetworkMeta | null;
  license: string;
  attribution: string;
}

export const ROUTE_NETWORK_URL = 'data/route-network.json';

const BRAND_BY_LETTER: Record<string, RouteBrand> = { A: 'mainline', X: 'express', R: 'rouge' };
const CODE_RE = /^[A-Z0-9]{3}$/;

function undirected(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Turns the file into a lookup. Throws on a file it cannot read. */
export function decodeRouteNetwork(file: RouteNetworkFile): RouteNetwork {
  if (!file || typeof file !== 'object' || file.version !== 1 || !file.routes || typeof file.routes !== 'object') {
    throw new Error('Unsupported route network file');
  }
  if (!file.license || !file.attribution) throw new Error('Route network file has no licence or attribution');
  const routes = new Map<string, RouteFact>();
  for (const [key, v] of Object.entries(file.routes)) {
    const [a, b] = key.split('-');
    if (!a || !b || !CODE_RE.test(a) || !CODE_RE.test(b) || !Array.isArray(v)) continue;
    const brands = [...String(v[0] ?? '')].map(l => BRAND_BY_LETTER[l]).filter(Boolean);
    routes.set(undirected(a, b), {
      brands,
      seasonal: v[1] === 1,
      begins: v[2] ?? null,
      ends: v[3] ?? null,
      resumes: v[4] ?? null,
    });
  }
  return {
    routes,
    airports: file.airports ?? {},
    meta: file.meta ?? null,
    license: file.license,
    attribution: file.attribution,
  };
}

const EMPTY: RouteNetwork = { routes: new Map(), airports: {}, meta: null, license: '', attribution: '' };
let baseline: RouteNetwork = EMPTY;
let current: RouteNetwork = EMPTY;

/** Replace the network (specs inject fixtures here). Registers its airports. */
export function setRouteNetworkSource(network: RouteNetwork | RouteNetworkFile | null): void {
  current = !network ? EMPTY : 'routes' in network && network.routes instanceof Map
    ? (network as RouteNetwork)
    : decodeRouteNetwork(network as RouteNetworkFile);
  registerAirports(current);
}

/** Restore the published network (the last install/load; empty when none). */
export function resetRouteNetworkSource(): void {
  current = baseline;
  registerAirports(current);
}

function registerAirports(n: RouteNetwork): void {
  registerExtraAirports(Object.fromEntries(
    Object.entries(n.airports).map(([code, a]) => [code, { name: a[0], country: a[1], tz: a[2] }]),
  ));
}

/** A regional airport from the network file (name, ISO country code, position), or null. */
export function networkAirport(code: string): { name: string; iso2: string; lat: number; lng: number } | null {
  const a = current.airports[code];
  return a ? { name: a[0], iso2: a[1], lat: a[3], lng: a[4] } : null;
}

/** Installs a route network file as the published data. */
export function installRouteNetwork(file: RouteNetworkFile): void {
  baseline = decodeRouteNetwork(file);
  resetRouteNetworkSource();
}

/**
 * Fetches and installs public/data/route-network.json (app startup).
 * Resolves false, leaving the network empty, when it cannot be loaded: the
 * app then simply says "not found in our schedule data" as before.
 */
export async function loadRouteNetwork(
  url: string = ROUTE_NETWORK_URL,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<boolean> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    installRouteNetwork((await res.json()) as RouteNetworkFile);
    return true;
  } catch (err) {
    console.error(`[route-network] could not load ${url}:`, err);
    return false;
  }
}

/** The fact for a route in either direction, or null when the file does not list it. */
export function routeFact(a: string | null | undefined, b: string | null | undefined): RouteFact | null {
  if (!a || !b || a === b) return null;
  return current.routes.get(undirected(a, b)) ?? null;
}

/**
 * True when the network lists the route but the schedules have no flight
 * for it in either direction: we know it is flown, not when.
 */
export function isRouteOnly(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!routeFact(a, b)) return false;
  return getSchedulesForRoute(a!, b!).length === 0 && getSchedulesForRoute(b!, a!).length === 0;
}

/** Airports the network links to `origin`, sorted. */
export function networkDestinations(origin: string): string[] {
  const out: string[] = [];
  for (const key of current.routes.keys()) {
    const [a, b] = key.split('-');
    if (a === origin) out.push(b);
    else if (b === origin) out.push(a);
  }
  return out.sort();
}

export function routeNetworkMeta(): RouteNetworkMeta | null {
  return current.meta;
}

/** Licence and attribution of the loaded file (empty strings when none is loaded). */
export function routeNetworkCredit(): { license: string; attribution: string; builtAt: string | null } {
  return { license: current.license, attribution: current.attribution, builtAt: current.meta?.builtAt ?? null };
}

/** True once a network is installed. */
export function routeNetworkLoaded(): boolean {
  return current.routes.size > 0;
}

/** The sentence the UI shows for a route-only pair. */
export const ROUTE_ONLY_TEXT = 'Flies this route · times not in our data';
/** The same, mid-sentence ('USA · flies this route · times not in our data'). */
export const ROUTE_ONLY_NOTE = 'flies this route · times not in our data';

/** True when the network lists every segment (origin → dest) of a flight. */
export function networkListsAll(segments: readonly { origin: string; dest: string }[]): boolean {
  return segments.length > 0 && segments.every(s => !!routeFact(s.origin, s.dest));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** 'Jun 16', or 'Jun 16, 2027' when the year differs from `on`'s. */
function dateFrom(iso: string, on: string): string {
  return iso.slice(0, 4) === on.slice(0, 4) ? shortDate(iso) : `${shortDate(iso)}, ${iso.slice(0, 4)}`;
}

/**
 * What the network says about a listed route on date `on` (YYYY-MM-DD):
 * 'flies this route · times not in our data' while it flies,
 * 'route starts Jun 16, 2027' before it begins, 'paused until May 1, 2027'
 * while paused, and null once it has ended (the caller then says "not found
 * in our schedule data"). Mid-sentence (lower case).
 */
export function routeFactNoteOn(fact: RouteFact, on: string): string | null {
  if (fact.ends && on > fact.ends) return null;
  if (fact.begins && on < fact.begins) return `route starts ${dateFrom(fact.begins, on)}`;
  if (fact.resumes && on < fact.resumes) return `paused until ${dateFrom(fact.resumes, on)}`;
  return ROUTE_ONLY_NOTE;
}

/**
 * The note for a route-only pair on date `on`, or null when the pair is not
 * route-only (no fact, or the schedules have it) or the route has ended.
 */
export function routeOnlyNoteOn(a: string | null | undefined, b: string | null | undefined, on: string): string | null {
  if (!isRouteOnly(a, b)) return null;
  return routeFactNoteOn(routeFact(a, b)!, on);
}

/**
 * The note for a flight's segments, each on its own departure date: null
 * unless the network lists every segment and none has ended; otherwise the
 * first segment that is not flying yet (or is paused) speaks, else
 * ROUTE_ONLY_NOTE.
 */
export function networkNoteFor(segments: readonly { origin: string; dest: string; dateKey: string }[]): string | null {
  if (!segments.length) return null;
  let note: string = ROUTE_ONLY_NOTE;
  for (const s of segments) {
    const fact = routeFact(s.origin, s.dest);
    if (!fact) return null;
    const n = routeFactNoteOn(fact, s.dateKey);
    if (n === null) return null;
    if (note === ROUTE_ONLY_NOTE && n !== ROUTE_ONLY_NOTE) note = n;
  }
  return note;
}

/** 'route starts Jun 16' → 'Route starts Jun 16' (for a sentence start). */
export function capitalizeNote(note: string): string {
  return note.charAt(0).toUpperCase() + note.slice(1);
}

/**
 * Optional detail under the sentence: 'Air Canada Express · Seasonal · Starts Dec 17'.
 * Empty when there is nothing worth saying.
 */
export function routeFactDetail(fact: RouteFact | null): string {
  if (!fact) return '';
  const parts: string[] = [];
  if (fact.brands.length === 1) {
    parts.push({ mainline: 'Air Canada', express: 'Air Canada Express', rouge: 'Air Canada Rouge' }[fact.brands[0]]);
  }
  if (fact.seasonal) parts.push('Seasonal');
  if (fact.begins) parts.push(`Starts ${shortDate(fact.begins)}`);
  else if (fact.resumes) parts.push(`Resumes ${shortDate(fact.resumes)}`);
  if (fact.ends) parts.push(`Ends ${shortDate(fact.ends)}`);
  return parts.join(' · ');
}
