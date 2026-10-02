/**
 * Trips list, trip card and trip menu model: pure functions over a Trip, so
 * the templates stay thin and every wording rule has a spec.
 *
 * Wording follows the Trips v2 rules: facts with their source (Scheduled /
 * Estimated / Saved by you / Unknown), counts not odds, and "not found in our
 * schedule data" rather than "no flights".
 */
import { networkNoteFor } from '../../data/route-network';
import { countryName } from '../../places/place';
import { aboutDuration, airportEnd, groundEstimate } from '../../places/ground';
import { joinNames, routeCountries } from '../../places/prep';
import type { TimeFormat } from '../../state/prefs.service';
import { hubDisplayName, supOffset } from '../../ui/format';
import { airportTz, findDestination, findHub } from '../../utils/airports';
import { deadlineUtc, departuresHome } from '../../trips/engine/homeby';
import { legWindow, refArrUtc } from '../../trips/engine/legs';
import type { ConnectOptions } from '../../utils/connections';
import { MINUTE_MS, WEEKDAY_SHORT, addDays, diffDays, formatClock, formatKey, utcToLocal, weekdayIndex } from '../../utils/time';
import {
  FlightLeg, FlightRef, GroundLeg, GroundMode, LegStatus, Party, Provenance, Trip, TripLeg, isFinalStatus,
} from '../../trips/model';
import type { IconName } from '../../components/shared/icons.component';

/** How soon the trip starts, as a tag. */
export interface Countdown {
  text: string;              // 'In 7 days', 'Tomorrow', 'Today', 'Under way', 'Done'
  tone: 'blue' | 'teal' | 'neutral';
}

/** One row of the trip timeline. */
export interface LegRow {
  id: string;
  kind: 'flight' | 'ground';
  icon: IconName;
  /** 'Thu · YUL → MAD · AC834', 'Fri · Madrid → Seville'. */
  title: string;
  /** '17:55 → 06:50⁺¹ · 2 backups', 'Train about 2h40 · not booked'. */
  meta: string;
  /** Flight legs show their status (and Scheduled/Unknown for their times), ground legs their provenance. */
  status: LegStatus | null;
  provenance: Provenance | null;
  /** Replaced or done with: shown dimmed. */
  done: boolean;
}

export const MODE_LABEL: Record<GroundMode, string> = {
  train: 'Train', bus: 'Bus', car: 'Car', ferry: 'Ferry', flight: 'Flight', other: 'Ground',
};

export const MODE_ICON: Record<GroundMode, IconName> = {
  train: 'train', bus: 'bus', car: 'car', ferry: 'pin', flight: 'plane', other: 'pin',
};

/** Days before the outbound when an unlisted return leg gets the amber reminder. */
export const RETURN_REMINDER_DAYS = 14;

/** 'Thu Oct 8'. */
export function dayLabel(key: string): string {
  return `${WEEKDAY_SHORT[weekdayIndex(key)]} ${formatKey(key, { month: 'short', day: 'numeric' })}`;
}

/** 'Oct 20'. */
export function monthDay(key: string): string {
  return formatKey(key, { month: 'short', day: 'numeric' });
}

/** 'Thu Oct 8 → home by Tue Oct 13, 22:00'. */
export function tripDatesLabel(trip: Trip, fmt: TimeFormat = '24h'): string {
  return `${dayLabel(trip.outboundDate)} → home by ${dayLabel(trip.homeBy.dateKey)}, ${formatClock(trip.homeBy.hhmm, fmt)}`;
}

/** '2 travellers · stay together', '2 travellers', '1 traveller'. */
export function partyLabel(party: Party): string {
  const n = Math.max(1, party.count);
  const who = `${n} ${n === 1 ? 'traveller' : 'travellers'}`;
  return n > 1 && party.stayTogether ? `${who} · stay together` : who;
}

/** First departure of the trip (or the outbound date at 00:00 home time when it has no legs yet). */
function tripStartUtc(trip: Trip): number {
  const first = trip.legs.find(l => l.status !== 'abandoned');
  const w = first ? legWindow(first, trip.legs) : null;
  if (w) return w.depUtc;
  return deadlineUtc({ dateKey: trip.outboundDate, hhmm: '00:00' }, trip.fromHub);
}

/** 'In 7 days', 'Tomorrow', 'Today', 'Under way' (after the first departure), 'Done' (after the deadline). */
export function countdown(trip: Trip, nowMs: number): Countdown {
  const deadline = deadlineUtc(trip.homeBy, trip.homeAirport);
  if (nowMs > deadline) return { text: 'Done', tone: 'neutral' };
  if (nowMs >= tripStartUtc(trip)) return { text: 'Under way', tone: 'teal' };
  const today = utcToLocal(nowMs, airportTz(trip.fromHub)).dateKey;
  const d = diffDays(today, trip.outboundDate);
  if (d <= 0) return { text: 'Today', tone: 'blue' };
  if (d === 1) return { text: 'Tomorrow', tone: 'blue' };
  return { text: `In ${d} days`, tone: 'blue' };
}

/** 'home 8h before your deadline', 'home 45m before your deadline', 'lands after your deadline'. */
export function deadlineNote(trip: Trip, ref: FlightRef): string | null {
  if (ref.dest !== trip.homeAirport) return null;
  const slack = Math.round((deadlineUtc(trip.homeBy, trip.homeAirport) - refArrUtc(ref)) / MINUTE_MS);
  if (slack < 0) return 'lands after your deadline';
  const h = Math.floor(slack / 60);
  return `home ${h ? `${h}h` : `${slack}m`} before your deadline`;
}

function backupsLabel(n: number): string {
  return n === 1 ? '1 backup' : `${n} backups`;
}

/** The flight numbers of a leg: 'AC834', 'AC811 + AC422'. */
export function flightNumbers(refs: readonly FlightRef[]): string {
  return refs.map(r => (r.flightNumber === 'EST' ? 'estimated leg' : r.flightNumber)).join(' + ');
}

/** 'YUL → MAD', 'LIS → YYZ → YUL'. */
export function refsRoute(refs: readonly FlightRef[]): string {
  if (!refs.length) return '';
  return [refs[0].origin, ...refs.map(r => r.dest)].join(' → ');
}

/** '17:55 → 06:50⁺¹' for an itinerary of refs (first departure, last arrival). */
export function refsTimes(refs: readonly FlightRef[], fmt: TimeFormat = '24h'): string {
  if (!refs.length) return '';
  const first = refs[0];
  const last = refs[refs.length - 1];
  return `${formatClock(first.depLocal, fmt)} → ${formatClock(last.arrLocal, fmt)}${supOffset(diffDays(first.dateKey, last.arrDateKey))}`;
}

function flightRow(trip: Trip, leg: FlightLeg, fmt: TimeFormat): LegRow {
  const refs = leg.refs;
  const first = refs[0];
  const last = refs[refs.length - 1];
  const meta = [refsTimes(refs, fmt)];
  if (leg.provenance === 'unknown') {
    // Flown per the route network, but the schedules have no times for it.
    meta.push(networkNoteFor(refs) ?? 'not found in our schedule data');
  }
  if (leg.alternates.length) meta.push(backupsLabel(leg.alternates.length));
  if (!isFinalStatus(leg.status) || leg.status === 'boarded') {
    const note = last ? deadlineNote(trip, last) : null;
    if (note) meta.push(note);
  }
  return {
    id: leg.id,
    kind: 'flight',
    icon: 'plane',
    title: first ? `${WEEKDAY_SHORT[weekdayIndex(first.dateKey)]} · ${refsRoute(refs)} · ${flightNumbers(refs)}` : 'Flight',
    meta: meta.filter(Boolean).join(' · '),
    status: leg.status,
    provenance: leg.provenance,
    done: leg.status === 'abandoned' || leg.status === 'notBoarded' || leg.status === 'didntTry',
  };
}

/** What a ground leg's ride line says, and the provenance of that ride. */
export interface GroundRide {
  /** 'Train 2h39' (timetable), 'Train about 2h40', 'Onward travel unknown'. */
  label: string;
  /**
   * 'scheduled' when an Estimated leg's ride now comes from a timetable for
   * its day (only the ride: exit and transfer stay Estimated); otherwise the
   * stored provenance. The stored leg itself never changes.
   */
  provenance: Provenance;
  /** The airport exit / station transfer part, when the ride is Scheduled and there is one (always Estimated). */
  exit: { label: string; min: number } | null;
}

/**
 * The ride of a ground leg as shown now: the corridor/heuristic label when it
 * still describes this leg ('Train about 2h40', or 'Train 2h39' from a
 * timetable for the leg's day, which makes the ride Scheduled), else the
 * mode and the door-to-door minutes.
 */
export function groundRide(leg: GroundLeg): GroundRide {
  if (leg.provenance === 'unknown' || leg.estMinutes === null) {
    return { label: 'Onward travel unknown', provenance: leg.provenance, exit: null };
  }
  const from = leg.from.code ? airportEnd(leg.from.code) ?? leg.from : leg.from;
  const g = groundEstimate(from, leg.to, { dateKey: leg.dateKey });
  // A timetable for that day describes the ride of the same corridor, whatever total was stored.
  if (g.mode === leg.mode && g.source === 'timetable') {
    const scheduled = leg.provenance === 'estimated';
    return {
      label: g.label,
      provenance: scheduled ? 'scheduled' : leg.provenance,
      exit: scheduled && g.exitMin > 0 ? { label: g.exitLabel || 'Airport exit and transfer', min: g.exitMin } : null,
    };
  }
  if (g.mode === leg.mode && g.totalMin === leg.estMinutes) return { label: g.label, provenance: leg.provenance, exit: null };
  return { label: `${MODE_LABEL[leg.mode]} about ${aboutDuration(leg.estMinutes)}`, provenance: leg.provenance, exit: null };
}

/** What an estimated ground leg says (see groundRide). */
export function groundLabel(leg: GroundLeg): string {
  return groundRide(leg).label;
}

function groundRow(leg: GroundLeg, fmt: TimeFormat): LegRow {
  const day = leg.userTimes?.depDateKey ?? leg.dateKey;
  let meta: string;
  let provenance: Provenance = leg.provenance;
  if (leg.provenance === 'saved' && leg.userTimes) {
    const t = leg.userTimes;
    const off = supOffset(diffDays(t.depDateKey, t.arrDateKey));
    meta = `${MODE_LABEL[leg.mode]} ${formatClock(t.depLocal, fmt)} → ${formatClock(t.arrLocal, fmt)}${off}`;
    if (leg.note.trim()) meta += ` · ${leg.note.trim()}`;
  } else if (leg.provenance === 'unknown' || leg.estMinutes === null) {
    meta = 'Onward travel unknown · find it yourself';
  } else {
    const ride = groundRide(leg);
    meta = `${ride.label} · not booked`;
    provenance = ride.provenance;
  }
  return {
    id: leg.id,
    kind: 'ground',
    icon: MODE_ICON[leg.mode] ?? 'pin',
    title: `${WEEKDAY_SHORT[weekdayIndex(day)]} · ${leg.from.name} → ${leg.to.name}`,
    meta,
    status: null,
    provenance,
    done: leg.status === 'abandoned',
  };
}

/** The timeline rows, in trip order. */
export function legRows(trip: Trip, fmt: TimeFormat = '24h'): LegRow[] {
  return trip.legs.map(l => (l.kind === 'flight' ? flightRow(trip, l, fmt) : groundRow(l, fmt)));
}

/** 'Home, Montréal'. */
/** True when the trip has no live return flight yet (none planned, or every one abandoned or missed). */
export function needsReturn(trip: Trip): boolean {
  const dead = new Set<string>(['abandoned', 'notBoarded', 'didntTry']);
  return !trip.legs.some(l => l.kind === 'flight' && l.role === 'return' && l.refs.length > 0 && !dead.has(l.status));
}

export function homeLabel(trip: Trip): string {
  return `Home, ${hubDisplayName(trip.homeAirport)}`;
}

/**
 * The amber "Return leg not listed yet" reminder: the outbound is within 14
 * days (or under way) and a return leg is still only Planned.
 */
export function returnNotListed(trip: Trip, nowMs: number): boolean {
  const today = utcToLocal(nowMs, airportTz(trip.fromHub)).dateKey;
  if (diffDays(today, trip.outboundDate) > RETURN_REMINDER_DAYS) return false;
  if (nowMs > deadlineUtc(trip.homeBy, trip.homeAirport)) return false;
  return trip.legs.some(l => l.kind === 'flight' && l.role === 'return' && l.status === 'planned');
}

/** 'Spain and Portugal · 2 travellers' (the countries the route touches, home left out). */
export function tripSubtitle(trip: Trip): string {
  const home = new Set(['CA']);
  const names = routeCountries(trip).filter(c => !home.has(c)).map(countryName).filter(Boolean);
  const where = names.length ? joinNames(names) : trip.goal.country;
  const n = Math.max(1, trip.party.count);
  return [where, `${n} ${n === 1 ? 'traveller' : 'travellers'}`].filter(Boolean).join(' · ');
}

/** One-line summary for a compact card: '4 legs · 2 backups'. */
export function compactSummary(trip: Trip): string {
  const legs = trip.legs.filter(l => l.status !== 'abandoned');
  const backups = trip.legs.reduce((n, l) => n + (l.kind === 'flight' ? l.alternates.length : 0), 0);
  const parts = [legs.length === 1 ? '1 leg' : `${legs.length} legs`];
  if (backups) parts.push(backupsLabel(backups));
  if (!legs.length) return 'No legs yet';
  return parts.join(' · ');
}

// ── Trip menu (g8) ───────────────────────────────────────────────────────────

/** 'Saved Thu Oct 1, 09:38' at the home airport, or null when never saved. */
export function savedAtLabel(iso: string | null, homeAirport: string, fmt: TimeFormat = '24h'): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const local = utcToLocal(ms, airportTz(homeAirport));
  return `Saved ${dayLabel(local.dateKey)}, ${formatClock(local.hhmm, fmt)}`;
}

function cityOf(code: string): string {
  return findDestination(code)?.city ?? (findHub(code) ? hubDisplayName(code) : code);
}

/**
 * The airports whose schedules matter offline: every gateway and connection
 * hub of the flight legs and their backups, plus the hubs of the one-stop
 * ways home from the return gateway. Home and the departure hub are left
 * out (they are where you start). Sorted by city: 'Barcelona, Lisbon, Madrid, Toronto'.
 */
export function offlineAirports(trip: Trip, connect: ConnectOptions = {}): string[] {
  const skip = new Set([trip.homeAirport, trip.fromHub]);
  const codes = new Set<string>();
  const add = (c: string) => {
    if (!skip.has(c)) codes.add(c);
  };
  for (const leg of trip.legs) {
    if (leg.kind !== 'flight' || leg.status === 'abandoned') continue;
    for (const refs of [leg.refs, ...leg.alternates.map(a => a.refs)]) {
      for (const r of refs) {
        add(r.origin);
        add(r.dest);
      }
    }
    if (leg.role === 'return' && leg.refs.length) {
      const first = leg.refs[0];
      for (const it of departuresHome(first.origin, trip.homeAirport, first.dateKey, connect)) it.hubs.forEach(add);
    }
  }
  return [...codes].sort((a, b) => cityOf(a).localeCompare(cityOf(b)));
}

/** 'Lisbon, Madrid, Toronto'. */
export function offlineAirportsLabel(trip: Trip, connect: ConnectOptions = {}): string {
  return offlineAirports(trip, connect).map(cityOf).join(', ');
}

/** The last day worth keeping offline: home-by + 7 days, capped at the published window. */
export function offlineUntil(trip: Trip, coverageTo: string | null): string {
  const want = addDays(trip.homeBy.dateKey, 7);
  return coverageTo && coverageTo < want ? coverageTo : want;
}

/** 'Shared plan · Thu Oct 1'. */
export function sharedLabel(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'Shared plan';
  return `Shared plan · ${dayLabel(utcToLocal(ms, tz).dateKey)}`;
}

/** The leg by id. */
export function legById(trip: Trip, legId: string | null | undefined): TripLeg | null {
  return legId ? trip.legs.find(l => l.id === legId) ?? null : null;
}
