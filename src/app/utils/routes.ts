/**
 * Pure route selection for the list (moved out of app.component, critique 14)
 * plus the aggregate helpers the UI needs: hubStats (passport tiles) and
 * monthAvailability (modal calendar).
 */
import { DESTINATIONS, Destination, DestinationType } from '../data/destinations';
import { isCovered } from '../data/schedule-index';
import { isWidebody } from './aircraft';
import {
  ConnectOptions,
  ConnectionOption,
  Itinerary,
  ItineraryFilter,
  NO_OPTS,
  WeekSummary,
  findItineraries,
  summarizeWeek,
  toConnectionOption,
} from './connections';
import { hhmmToMin, monthKeys, weekKeys, weekdayIndex } from './time';
import { DayFlight, FlightInstance, coverageHubFor, flightsOn, getFlightsForWeek } from './week';

export type SortKey = 'az' | 'departure' | 'duration' | 'days' | 'newest';

export type DepartWindow = 'morning' | 'afternoon' | 'evening' | 'redeye';

/** Local departure windows in minutes since midnight, [start, end). Red-eye wraps midnight. */
export const DEPART_WINDOWS: Record<DepartWindow, { label: string; start: number; end: number }> = {
  morning: { label: 'Morning', start: 5 * 60, end: 12 * 60 },
  afternoon: { label: 'Afternoon', start: 12 * 60, end: 17 * 60 },
  evening: { label: 'Evening', start: 17 * 60, end: 22 * 60 },
  redeye: { label: 'Red-eye', start: 22 * 60, end: 5 * 60 },
};

export interface Filters {
  /** Destination types to keep (empty = all). */
  types: DestinationType[];
  /** Local departure windows at the home airport (empty = any time). */
  departWindows: DepartWindow[];
  /** Keep only flights/itineraries that arrive the same local calendar day. */
  sameDayArrival: boolean;
  /** Only connect through these hubs (empty = any). Direct flights are unaffected. */
  viaHubs: string[];
  /** Keep only flights on a widebody (for itineraries: any leg). */
  widebodyOnly: boolean;
  /** Keep only starred destinations. */
  starredOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  types: [],
  departWindows: [],
  sameDayArrival: false,
  viaHubs: [],
  widebodyOnly: false,
  starredOnly: false,
};

/** Number of filters that differ from EMPTY_FILTERS (for a badge). */
export function activeFilterCount(f: Partial<Filters> | null | undefined): number {
  if (!f) return 0;
  return (f.types?.length ? 1 : 0) + (f.departWindows?.length ? 1 : 0) + (f.sameDayArrival ? 1 : 0)
    + (f.viaHubs?.length ? 1 : 0) + (f.widebodyOnly ? 1 : 0) + (f.starredOnly ? 1 : 0);
}

/** Pseudo-region that selects starred destinations. */
export const STARRED_REGION = 'Starred';

export interface ComputeRoutesParams {
  home: string;
  /** Monday date key of the displayed week. */
  weekStartKey: string;
  /** Selected day, or null for the whole week. */
  dateKey: string | null;
  /** 'All', a REGIONS entry, or STARRED_REGION. */
  region: string;
  showConnections: boolean;
  query?: string;
  sort?: SortKey;
  filters?: Partial<Filters>;
  /** Starred destination codes (sorted first within each group). */
  favourites?: readonly string[];
  /** Connection preferences (minConnect, maxLayover, allowOvernight, avoidHubs). */
  connect?: ConnectOptions;
}

export interface RouteEntry {
  destination: Destination;
  /** Has a direct flight in scope (the selected day, else some day of the week). */
  isDirect: boolean;
  /** Direct flights per day Mon–Sun of the week (filters applied). */
  weekDays: DayFlight[];
  /** Direct flights in scope: the selected day's, or the whole week's. Sorted by departure. */
  flights: FlightInstance[];
  /** Best connection on the selected day (connecting routes, day mode). */
  itinerary?: Itinerary;
  /** Every connection on the selected day (connecting routes, day mode). */
  itineraries?: Itinerary[];
  /** Connections per day of the week (week mode, whenever connections are shown). */
  weekSummary?: WeekSummary;
  /** Days this week with a direct flight (direct) or a connection (connecting). */
  daysFlying: number;
  isFavourite: boolean;
  /** @deprecated Old shape for route-card/flight-modal until WS5/WS6. Same as `itinerary`. */
  bestConnection?: ConnectionOption;
}

/** Lower-cases and strips accents: 'Montréal' → 'montreal'. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Accent-insensitive match of every query word against city, country, code and region. */
export function matchesQuery(d: Destination, query: string | null | undefined): boolean {
  const q = normalizeText(query ?? '');
  if (!q) return true;
  const hay = normalizeText(`${d.city} ${d.country} ${d.code} ${d.region}`);
  return q.split(/\s+/).every(t => hay.includes(t));
}

function inWindow(hhmm: string, windows: readonly DepartWindow[]): boolean {
  if (!windows.length) return true;
  const m = hhmmToMin(hhmm);
  return windows.some(w => {
    const { start, end } = DEPART_WINDOWS[w];
    return start < end ? m >= start && m < end : m >= start || m < end;
  });
}

function flightPredicate(f: Filters): (x: FlightInstance) => boolean {
  return x =>
    inWindow(x.depLocal, f.departWindows)
    && (!f.sameDayArrival || x.arrDayOffset <= 0)
    && (!f.widebodyOnly || isWidebody(x.aircraft));
}

/** Itinerary filter, or undefined when no itinerary-level filter is active. */
function itineraryFilter(f: Filters): ItineraryFilter | undefined {
  if (!f.departWindows.length && !f.sameDayArrival && !f.widebodyOnly) return undefined;
  return {
    key: `${[...f.departWindows].sort()}|${f.sameDayArrival}|${f.widebodyOnly}`,
    keep: x =>
      inWindow(x.legs[0].depLocal, f.departWindows)
      && (!f.sameDayArrival || x.arrDayOffset <= 0)
      && (!f.widebodyOnly || x.legs.some(l => isWidebody(l.aircraft))),
  };
}

function filteredWeek(home: string, dest: string, weekStartKey: string, keep: (x: FlightInstance) => boolean, trivial: boolean): DayFlight[] {
  const week = getFlightsForWeek(home, dest, weekStartKey);
  if (trivial) return week;
  return week.map(d => {
    const flights = d.flights.filter(keep);
    const first = flights[0];
    return {
      ...d,
      flights,
      flies: flights.length > 0,
      flightNumber: first?.flightNumber ?? undefined,
      departure: first?.depLocal,
      arrival: first?.arrLocal,
      aircraft: first?.aircraft ?? undefined,
    };
  });
}

/**
 * The list's routes for a hub and week (or day): direct routes first, then
 * connecting ones, each group sorted by `sort` with starred first.
 * Destinations with no flights in scope (e.g. seasonal ones out of season) are omitted.
 */
export function computeRoutes(p: ComputeRoutesParams): RouteEntry[] {
  const filters: Filters = { ...EMPTY_FILTERS, ...(p.filters ?? {}) };
  const favs = new Set(p.favourites ?? []);
  const connect: ConnectOptions = {
    ...(p.connect ?? {}),
    viaHubs: filters.viaHubs.length ? filters.viaHubs : p.connect?.viaHubs,
  };
  const keepFlight = flightPredicate(filters);
  const keepItin = itineraryFilter(filters);
  const trivialFlightFilter = !filters.departWindows.length && !filters.sameDayArrival && !filters.widebodyOnly;
  const starredOnly = filters.starredOnly || p.region === STARRED_REGION;

  const direct: RouteEntry[] = [];
  const connecting: RouteEntry[] = [];

  for (const d of DESTINATIONS) {
    if (p.region !== 'All' && p.region !== STARRED_REGION && p.region && d.region !== p.region) continue;
    if (starredOnly && !favs.has(d.code)) continue;
    if (filters.types.length && !filters.types.includes(d.type)) continue;
    if (!matchesQuery(d, p.query)) continue;

    const weekDays = filteredWeek(p.home, d.code, p.weekStartKey, keepFlight, trivialFlightFilter);
    const directDays = weekDays.filter(w => w.flies).length;
    const isFavourite = favs.has(d.code);

    if (p.dateKey) {
      const flights = trivialFlightFilter
        ? flightsOn(p.home, d.code, p.dateKey)
        : flightsOn(p.home, d.code, p.dateKey).filter(keepFlight);
      if (flights.length) {
        direct.push({ destination: d, isDirect: true, weekDays, flights, daysFlying: directDays, isFavourite });
      } else if (p.showConnections) {
        const itineraries = findItineraries(p.home, d.code, p.dateKey, connect, keepItin);
        if (itineraries.length) {
          const itinerary = itineraries[0];
          connecting.push({
            destination: d, isDirect: false, weekDays, flights: [], itinerary, itineraries,
            // Connection days this week (not direct days), so the 'days' sort ranks connecting routes meaningfully.
            daysFlying: summarizeWeek(p.home, d.code, p.weekStartKey, connect, keepFlight, keepItin).connectDays,
            isFavourite,
            bestConnection: toConnectionOption(itinerary) ?? undefined,
          });
        }
      }
      continue;
    }

    const flights = weekDays.flatMap(w => w.flights);
    const weekSummary = p.showConnections
      ? summarizeWeek(p.home, d.code, p.weekStartKey, connect, keepFlight, keepItin)
      : undefined;
    if (directDays) {
      direct.push({ destination: d, isDirect: true, weekDays, flights, weekSummary, daysFlying: directDays, isFavourite });
    } else if (weekSummary && weekSummary.connectDays) {
      const best = weekSummary.days.find(x => x.best)?.best ?? undefined;
      connecting.push({
        destination: d, isDirect: false, weekDays, flights: [], weekSummary,
        daysFlying: weekSummary.connectDays, isFavourite,
        bestConnection: best ? toConnectionOption(best) ?? undefined : undefined,
      });
    }
  }

  const cmp = comparator(p.sort ?? 'az', !!p.dateKey);
  const byFavThen = (a: RouteEntry, b: RouteEntry) => Number(b.isFavourite) - Number(a.isFavourite) || cmp(a, b);
  return [...direct.sort(byFavThen), ...connecting.sort(byFavThen)];
}

function firstDeparture(r: RouteEntry): number {
  if (r.flights.length) return Math.min(...r.flights.map(f => f.depUtc));
  if (r.itinerary) return r.itinerary.departUtc;
  return Infinity;
}

function shortestTrip(r: RouteEntry): number {
  if (r.flights.length) return Math.min(...r.flights.map(f => f.durationMin));
  if (r.itineraries?.length) return Math.min(...r.itineraries.map(i => i.totalMin));
  const week = r.weekSummary?.days.filter(d => d.best).map(d => d.best!.totalMin) ?? [];
  return week.length ? Math.min(...week) : Infinity;
}

function comparator(sort: SortKey, dayMode: boolean): (a: RouteEntry, b: RouteEntry) => number {
  const az = (a: RouteEntry, b: RouteEntry) => a.destination.city.localeCompare(b.destination.city);
  switch (sort) {
    case 'departure':
      return dayMode ? (a, b) => firstDeparture(a) - firstDeparture(b) || az(a, b) : az;
    case 'duration':
      return (a, b) => shortestTrip(a) - shortestTrip(b) || az(a, b);
    case 'days':
      return (a, b) => b.daysFlying - a.daysFlying || az(a, b);
    case 'newest':
      return (a, b) => Number(!!b.destination.isNew) - Number(!!a.destination.isNew) || az(a, b);
    default:
      return az;
  }
}

// ── Aggregates ──────────────────────────────────────────────────────────────

export interface HubStats {
  /** Destinations with a direct flight this week. */
  directDestinations: number;
  /** Destinations reachable this week only with one connection. */
  connectingDestinations: number;
  /** Distinct countries reachable this week (direct or one connection). */
  countries: number;
  /** Direct departures this week. */
  flightsThisWeek: number;
  /** Direct departures per weekday, Mon..Sun. */
  departuresByWeekday: number[];
}

export function hubStats(home: string, weekStartKey: string, connect: ConnectOptions = NO_OPTS): HubStats {
  const routes = computeRoutes({ home, weekStartKey, dateKey: null, region: 'All', showConnections: true, connect });
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  let flightsThisWeek = 0;
  const countries = new Set<string>();
  for (const r of routes) {
    countries.add(r.destination.country);
    for (const f of r.flights) {
      byDay[weekdayIndex(f.dateKey)]++;
      flightsThisWeek++;
    }
  }
  const directDestinations = routes.filter(r => r.isDirect).length;
  return {
    directDestinations,
    connectingDestinations: routes.length - directDestinations,
    countries: countries.size,
    flightsThisWeek,
    departuresByWeekday: byDay,
  };
}

export interface DayAvailability {
  dateKey: string;
  /** Number of direct departures. */
  direct: number;
  /** At least one one-stop connection exists. */
  connect: boolean;
  /** Inside the published window for this route's hub. */
  covered: boolean;
}

/** Month grid data for the calendar heatmap ('YYYY-MM'). */
export function monthAvailability(home: string, dest: string, yearMonth: string, connect: ConnectOptions = NO_OPTS): DayAvailability[] {
  const hub = coverageHubFor(home, dest);
  return monthKeys(yearMonth).map(dateKey => {
    const covered = isCovered(dateKey, hub);
    return {
      dateKey,
      direct: flightsOn(home, dest, dateKey).length,
      connect: covered && findItineraries(home, dest, dateKey, connect).length > 0,
      covered,
    };
  });
}

/** The 7 date keys of a week (re-exported for components). */
export { weekKeys };
