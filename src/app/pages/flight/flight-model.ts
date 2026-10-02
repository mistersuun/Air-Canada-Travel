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
import { addDays, formatClock, formatDuration, formatKey, utcToLocal, weekStartKey, weekKeys } from '../../utils/time';
import type { TimeFormat } from '../../state/prefs.service';
import { flightSlug, matchSlug } from '../../ui/links';
import { hm, hubDisplayName, itinKey, prettyFlight, shortDay, supOffset, tzDiffLabel } from '../../ui/format';
import type { ScheduleFacts } from '../../trips/engine/facts';
import { refDepUtc, refFromInstance, refsFromItinerary, sameRefs } from '../../trips/engine/legs';
import { type FlightLeg, type FlightRef, type LoadNote, type Trip, instanceKey, isFinalStatus } from '../../trips/model';
import { gatewaysNear } from '../../places/reach';

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

// ── Trips v2 additions (g6): schedule facts, load notes, Add to trip ─────────

/** 'Fri Oct 9'. */
export function dayShort(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

export interface FactTile { label: string; value: string }
export interface FactsView {
  covered: boolean;
  tiles: FactTile[];
  /** Neutral holiday note ('Canadian Thanksgiving weekend (Mon Oct 12). Often busy, check loads.'). */
  holiday: string | null;
}

/**
 * "This day on this route": departures, the last one, aircraft and the next
 * day, as plain counts and times (never odds). Outside coverage: no tiles.
 */
export function factsView(f: ScheduleFacts, holiday: string | null, fmt: TimeFormat = '24h'): FactsView {
  if (!f.covered) return { covered: false, tiles: [], holiday };
  const n = f.departures.length;
  const times = f.departures.slice(0, 3).map(d => formatClock(d.depLocal, fmt)).join(', ') + (n > 3 ? ', …' : '');
  const aircraft = f.aircraft.slice(0, 2).map(a => (a.count > 1 ? `${a.name} ×${a.count}` : a.name)).join(', ');
  const next = f.nextDay;
  return {
    covered: true,
    holiday,
    tiles: [
      { label: 'Departures', value: n ? `${n} · ${times}` : 'None in our schedule data' },
      { label: 'Last one', value: f.last ? `${prettyFlight(f.last.flightNumber)} ${formatClock(f.last.depLocal, fmt)}` : '—' },
      { label: 'Aircraft', value: aircraft || '—' },
      {
        label: 'Next day',
        value: !next.covered ? 'Unknown' : next.count ? `${next.count} departure${next.count === 1 ? '' : 's'}` : 'None in our schedule data',
      },
    ],
  };
}

/** 'just now', '25 min ago', '3h ago', '2 days ago'. */
export function agoLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export interface NoteRow {
  id: string;
  /** 'AC864 · 14 open, 9 listed' (or just the flight when no numbers were written). */
  title: string;
  /** 'You checked at 14:05 · 3h ago'. */
  when: string;
  text: string;
}

/**
 * One load note as a row. Times are local at the flight's origin. Purely
 * descriptive ('5 open, 20 listed'): never compared with the party as a
 * pass/fail mark, which would read as boarding odds.
 */
export function noteRow(n: LoadNote, _partySize: number, nowMs: number, fmt: TimeFormat = '24h'): NoteRow {
  const nums: string[] = [];
  if (n.open !== null) nums.push(`${n.open} open`);
  if (n.listed !== null) nums.push(`${n.listed} listed`);
  const ms = Date.parse(n.at);
  const local = Number.isFinite(ms) ? utcToLocal(ms, airportTz(n.origin)) : null;
  const today = utcToLocal(nowMs, airportTz(n.origin)).dateKey;
  const at = local ? `${local.dateKey !== today ? `${dayShort(local.dateKey)}, ` : ''}${formatClock(local.hhmm, fmt)}` : '';
  return {
    id: n.id,
    title: [prettyFlight(n.flightNumber), nums.join(', ')].filter(Boolean).join(' · '),
    when: `You checked at ${at}${Number.isFinite(ms) ? ` · ${agoLabel(nowMs - ms)}` : ''}`,
    text: n.text,
  };
}

/** A flight that can carry a note: one segment of the day's itineraries. */
export interface NoteFlight { key: string; ref: FlightRef; label: string }

/** The day's distinct segments ('AC864 · YUL 22:10 → LHR'), first-departure order. */
export function noteFlights(its: readonly Itinerary[], fmt: TimeFormat = '24h'): NoteFlight[] {
  const out = new Map<string, NoteFlight>();
  for (const it of its) {
    for (const leg of it.legs) {
      if (!leg.flightNumber || leg.estimated) continue;
      const ref = refFromInstance(leg);
      const key = instanceKey(ref);
      if (out.has(key)) continue;
      out.set(key, { key, ref, label: `${prettyFlight(leg.flightNumber)} · ${leg.origin} ${formatClock(leg.depLocal, fmt)} → ${leg.dest}` });
    }
  }
  return [...out.values()].sort((a, b) => refDepUtc(a.ref) - refDepUtc(b.ref));
}

/** Active trips whose dates cover the day (from the day before the outbound to the home-by date). */
export function tripsCovering(trips: readonly Trip[], dateKey: string): Trip[] {
  return trips.filter(t => !t.archived && dateKey >= addDays(t.outboundDate, -1) && dateKey <= t.homeBy.dateKey);
}

/**
 * The airports on the trip's far side: every leg endpoint (flights, their
 * backups, ground legs with an airport code), the goal's own AC airport and
 * the AC airports near the goal. Home (fromHub, homeAirport) is left out.
 */
export function tripAwayAirports(trip: Trip): Set<string> {
  const out = new Set<string>();
  for (const l of trip.legs) {
    if (l.kind === 'flight') {
      for (const r of [...l.refs, ...l.alternates.flatMap(a => a.refs)]) out.add(r.origin).add(r.dest);
    } else {
      if (l.from.code) out.add(l.from.code);
      if (l.to.code) out.add(l.to.code);
    }
  }
  if (trip.goal.acCode) out.add(trip.goal.acCode);
  for (const g of gatewaysNear(trip.goal)) out.add(g.code);
  out.delete(trip.fromHub);
  out.delete(trip.homeAirport);
  return out;
}

/**
 * True when the itinerary belongs to the trip's journey: it goes to the trip's
 * side (a leg endpoint or an airport near the goal), or it comes home (to the
 * home hub) from there. A flight to an unrelated place on the trip's dates
 * does not connect.
 */
export function tripConnects(trip: Trip, it: { origin: string; dest: string }): boolean {
  // Positioning between the home hub and the home airport (YOW → YUL, YUL → YOW) is part of the journey.
  if (trip.fromHub !== trip.homeAirport && it.origin !== it.dest
    && [trip.fromHub, trip.homeAirport].includes(it.origin) && [trip.fromHub, trip.homeAirport].includes(it.dest)) return true;
  const away = tripAwayAirports(trip);
  if (away.has(it.dest)) return true;
  const home = it.dest === trip.fromHub || it.dest === trip.homeAirport;
  return home && away.has(it.origin);
}

/**
 * Active trips covering the itinerary's day that it connects to (see
 * tripConnects), plus any active trip that already holds it (as a leg or a
 * backup), whatever its geography.
 */
export function tripsFor(trips: readonly Trip[], it: { origin: string; dest: string; dateKey: string } | Itinerary): Trip[] {
  const covering = new Set(tripsCovering(trips, it.dateKey));
  return trips.filter(t => !t.archived && (
    (covering.has(t) && tripConnects(t, it)) || ('legs' in it && tripTarget(t, it).kind === 'already')));
}

export type TripTarget =
  | { kind: 'already'; legId: string }
  | { kind: 'alternate'; legId: string; flight: string }
  | { kind: 'leg'; role: FlightLeg['role'] };

/**
 * What "Add to trip" does with this itinerary: nothing when the trip already
 * has it (as a leg or a backup); a backup of the open flight leg leaving the
 * same airport the same day; else a new leg (outbound when the trip has no
 * open outbound yet, onward otherwise).
 */
export function tripTarget(trip: Trip, it: Itinerary): TripTarget {
  const refs = refsFromItinerary(it);
  for (const l of trip.legs) {
    if (l.kind !== 'flight') continue;
    if (sameRefs(l.refs, refs) || l.alternates.some(a => sameRefs(a.refs, refs))) return { kind: 'already', legId: l.id };
  }
  const match = trip.legs.find((l): l is FlightLeg => l.kind === 'flight' && !isFinalStatus(l.status)
    && l.refs[0]?.origin === it.origin && l.refs[0]?.dateKey === it.dateKey);
  if (match) return { kind: 'alternate', legId: match.id, flight: match.refs.map(r => prettyFlight(r.flightNumber)).join(' + ') };
  const hasOutbound = trip.legs.some(l => l.kind === 'flight' && l.role === 'outbound' && l.status !== 'abandoned');
  return { kind: 'leg', role: hasOutbound ? 'onward' : 'outbound' };
}
