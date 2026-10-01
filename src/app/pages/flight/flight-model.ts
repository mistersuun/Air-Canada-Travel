/**
 * View-model for the flight page (/flight/:code/:date/:flight?). Pure
 * functions only, so the page stays thin and every rule is unit-tested.
 */
import type { Alternatives, Itinerary } from '../../utils/connections';
import { isLayoverAlert, LONG_LAYOVER } from '../../utils/connections';
import type { FlightInstance } from '../../utils/week';
import { flightsOn } from '../../utils/week';
import { aircraftName } from '../../utils/aircraft';
import { airportName, airportTz, isHub } from '../../utils/airports';
import { addDays, formatClock, formatDuration, formatKey, weekStartKey, weekKeys } from '../../utils/time';
import type { TimeFormat } from '../../state/prefs.service';
import { flightSlug, matchSlug } from '../../ui/links';
import { hm, hubDisplayName, itinKey, prettyFlight, shortDay, supOffset, tzDiffLabel } from '../../ui/format';

export type Pick = 'earliest' | 'nonstop' | 'fastest';
export const PICKS: readonly Pick[] = ['earliest', 'nonstop', 'fastest'];

export function isPick(v: unknown): v is Pick {
  return typeof v === 'string' && (PICKS as readonly string[]).includes(v);
}

/** The itinerary a seg choice stands for, among the day's ranked itineraries. */
export function pickOf(its: readonly Itinerary[], pick: Pick): Itinerary | null {
  if (!its.length) return null;
  if (pick === 'nonstop') return its.find(i => !i.hubs.length) ?? null;
  if (pick === 'fastest') return its.reduce((a, b) => (b.totalMin < a.totalMin ? b : a));
  return its[0];
}

/**
 * The shown itinerary: an explicit flight slug wins, then ?pick=, then the
 * earliest. A pick with no match (no nonstop that day) falls back to the
 * earliest. `pick` is the seg option lit for it: the requested pick when it
 * resolves to the shown itinerary, else the first pick that does, else null.
 */
export function choose(
  its: readonly Itinerary[],
  slug: string | null | undefined,
  pick: string | null | undefined,
): { it: Itinerary | null; pick: Pick | null } {
  const bySlug = matchSlug(slug, its);
  const want = isPick(pick) ? pick : 'earliest';
  const it = bySlug ?? pickOf(its, want) ?? its[0] ?? null;
  if (!it) return { it: null, pick: null };
  const k = itinKey(it);
  const same = (p: Pick) => {
    const x = pickOf(its, p);
    return !!x && itinKey(x) === k;
  };
  if (same(want)) return { it, pick: want };
  return { it, pick: PICKS.find(same) ?? null };
}

/** 'Montréal' for a hub, else the city. */
export function placeName(code: string): string {
  return isHub(code) ? hubDisplayName(code) : airportName(code);
}

/** 'A330-300', '777-300ER': the aircraft name without the maker. */
export function shortAircraft(code: string | null | undefined): string {
  return aircraftName(code).replace(/^(Airbus|Boeing)\s+/, '');
}

/** Days in the week of `dateKey` on which this flight number operates. */
export function weekFrequency(leg: FlightInstance): number {
  if (!leg.flightNumber) return 0;
  return weekKeys(weekStartKey(leg.dateKey))
    .filter(k => flightsOn(leg.origin, leg.dest, k).some(f => f.flightNumber === leg.flightNumber))
    .length;
}

/** 'Daily', '6× / wk', '—'. */
export function frequencyLabel(n: number): string {
  if (n >= 7) return 'Daily';
  return n > 0 ? `${n}× / wk` : '—';
}

export interface TicketCell {
  label: string;
  value: string;
  title?: string;
}

export interface TicketLeg {
  /** 'YUL → YYZ' (shown above each block for a connection). */
  route: string;
  estimated: boolean;
  cells: TicketCell[];
}

export interface TicketLayover {
  text: string;
  alert: boolean;
  reason: string;
}

export interface TicketModel {
  origin: string;
  originCity: string;
  dest: string;
  destCity: string;
  nonstop: boolean;
  tag: string;
  duration: string;
  dep: string;
  depDate: string;
  arr: string;
  arrDate: string;
  arrOffset: string;
  legs: TicketLeg[];
  /** layovers[i] sits between legs[i] and legs[i + 1]. */
  layovers: TicketLayover[];
  estimated: boolean;
}

/** Everything the boarding-pass ticket shows. */
export function ticketModel(it: Itinerary, fmt: TimeFormat = '24h', minConnect = 60): TicketModel {
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  return {
    origin: it.origin,
    originCity: placeName(it.origin),
    dest: it.dest,
    destCity: placeName(it.dest),
    nonstop: !it.hubs.length,
    tag: it.hubs.length ? `${it.hubs.length} STOP${it.hubs.length > 1 ? 'S' : ''} · ${it.hubs.join(' ')}` : 'NON-STOP',
    duration: formatDuration(it.totalMin),
    dep: formatClock(first.depLocal, fmt),
    depDate: shortDay(it.dateKey),
    arr: formatClock(last.arrLocal, fmt),
    arrDate: `${shortDay(it.arrDateKey)} · local`,
    arrOffset: supOffset(it.arrDayOffset),
    estimated: it.estimated,
    legs: it.legs.map(leg => ({
      route: `${leg.origin} → ${leg.dest}`,
      estimated: leg.estimated,
      cells: [
        { label: 'Date', value: formatKey(leg.dateKey, { month: 'short', day: 'numeric' }) },
        leg.estimated
          ? { label: 'Flight', value: 'Estimated', title: 'Not from published schedules: verify on aircanada.com' }
          : {
              label: 'Flight',
              value: prettyFlight(leg.flightNumber),
              title: leg.altFlightNumbers?.length ? `Also filed as ${leg.altFlightNumbers.map(prettyFlight).join(', ')}` : undefined,
            },
        { label: 'Aircraft', value: shortAircraft(leg.aircraft) || '—', title: aircraftName(leg.aircraft) || undefined },
        { label: 'Duration', value: hm(leg.durationMin) },
        { label: 'Frequency', value: frequencyLabel(weekFrequency(leg)) },
        { label: 'Time diff', value: tzDiffLabel(airportTz(leg.dest), airportTz(leg.origin), leg.depUtc) },
      ],
    })),
    layovers: it.layovers.map((min, i) => ({
      text: `${formatDuration(min)} in ${placeName(it.legs[i].dest)}`,
      alert: isLayoverAlert(min, minConnect),
      reason: min < minConnect ? 'Tight connection' : min > LONG_LAYOVER ? 'Long wait' : '',
    })),
  };
}

export interface OptionRow {
  key: string;
  /** Code on the monogram tile: the first hub, or the non-hub end for a nonstop. */
  tile: string;
  name: string;
  small: string;
  meta: string;
  date: string;
  slug: string;
  it: Itinerary;
}

/**
 * One itinerary as a list row: 'Via Toronto' / 'Nonstop', and
 * 'AC1 · YYZ 13:05 → HND 15:40⁺¹ · 777-300ER' (the onward leg for a connection).
 */
export function optionRow(it: Itinerary, fmt: TimeFormat = '24h', name?: string): OptionRow {
  const hub = it.hubs[0] ?? null;
  const flights = it.legs.map(l => (l.estimated ? 'Est.' : prettyFlight(l.flightNumber))).join(' + ');
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  const times = `${it.origin} ${formatClock(first.depLocal, fmt)} → ${it.dest} ${formatClock(last.arrLocal, fmt)}${supOffset(it.arrDayOffset)}`;
  const aircraft = [...new Set(it.legs.map(l => shortAircraft(l.aircraft)).filter(Boolean))].join(' / ');
  return {
    key: itinKey(it),
    tile: hub ?? (isHub(it.dest) ? it.origin : it.dest),
    name: name ?? (hub ? `Via ${placeName(hub)}` : 'Nonstop'),
    small: hm(it.totalMin),
    meta: [flights, times, aircraft].filter(Boolean).join(' · '),
    date: it.dateKey,
    slug: flightSlug(it),
    it,
  };
}

export interface BackupGroup {
  id: 'later' | 'other' | 'next';
  label: string;
  rows: OptionRow[];
}

/** "If you miss this": later same route, other routes the same day, first the next day. */
export function backupGroups(alts: Alternatives, chosen: Itinerary, fmt: TimeFormat = '24h'): BackupGroup[] {
  const groups: BackupGroup[] = [
    { id: 'later', label: chosen.hubs.length ? `Later via ${chosen.hubs.join(' ')}` : 'Later nonstop', rows: alts.laterSameRoute.slice(0, 2).map(i => optionRow(i, fmt)) },
    { id: 'other', label: chosen.hubs.length ? 'Other routes, same day' : 'Connections, same day', rows: alts.otherHubsSameDay.slice(0, 2).map(i => optionRow(i, fmt)) },
    {
      id: 'next',
      label: `Next day · ${shortDay(addDays(chosen.dateKey, 1))}`,
      rows: alts.nextDayFirst ? [optionRow(alts.nextDayFirst, fmt)] : [],
    },
  ];
  return groups.filter(g => g.rows.length);
}

export const NIGHT_PRESETS = [2, 3, 4, 5, 7] as const;
export const DEFAULT_NIGHTS = 4;
export const MAX_NIGHTS = 30;

/** ?nights= as an int in 1..MAX_NIGHTS, else the default. */
export function parseNights(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_NIGHTS ? n : DEFAULT_NIGHTS;
}

/** The round trip, in time order, for the two-way .ics. */
export function roundTrip(out: Itinerary, ret: Itinerary | null): Itinerary[] {
  if (!ret) return [out];
  return ret.departUtc < out.departUtc ? [ret, out] : [out, ret];
}
