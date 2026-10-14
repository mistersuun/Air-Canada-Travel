/**
 * View models for the day of travel (/today), its Explore banner and the
 * recovery screen (/trips/:id/recover). Pure: the clock, the trips and the
 * connection options are passed in; schedules are read only through the trip
 * engine (stillReachable / missOneOutbound) and never fetched.
 *
 * Wording follows the Trips v2 rules: facts only (times, counts, "next day"),
 * no odds, "not found in our schedule data" rather than "no flights", and
 * listing is always the traveller's own step.
 */
import { type ConnectOptions, type Itinerary } from '../../utils/connections';
import { airportTz } from '../../utils/airports';
import { networkNoteFor } from '../../data/route-network';
import { MINUTE_MS, WEEKDAY_LONG, WEEKDAY_SHORT, addDays, diffDays, formatClock, formatKey, utcToLocal, weekdayIndex } from '../../utils/time';
import { MISS_GAP_MIN, deadlineUtc, departuresHome } from '../../trips/engine/homeby';
import { hm, supOffset } from '../../ui/format';
import type { TimeFormat } from '../../state/prefs.service';
import { airportEnd, arrivalAtGoal, groundEstimate, placeEnd, type GroundEstimate } from '../../places/ground';
import { tonightCheckIn } from '../../places/stay-links';
import { legPrepItems, type PrepItem } from '../../places/prep';
import { partOfDay } from '../reach/reach-model';
import { shortAircraftName } from '../../trips/engine/facts';
import { endTz, legStartUtc, legWindow, refArrUtc, refDepUtc, sortLegs } from '../../trips/engine/legs';
import { findDestination, findHub } from '../../utils/airports';
import { getDestinationCodes } from '../../data/schedule-index';
import { dailyFact } from '../destination/fun-facts';
import { MODE_LABEL, groundRide } from '../trips/trips-model';
import { type ReachableOption, legDepartureKey, leavesGoalArea, missOneOutbound, stillReachable } from '../../trips/engine/recover';
import { activeTravelDay, placeName } from '../../trips/engine/today';
import {
  type FlightLeg, type FlightRef, type GroundLeg, type LegEnd, type LegStatus, type LoadNote, type Outcome, type Provenance, type Trip, type TripLeg,
  LEG_STATUS_LABEL, instanceKey, isFinalStatus,
} from '../../trips/model';

// ── Shared formatting ─────────────────────────────────────────────────────────

/** 'Thu Oct 8'. */
export function dayLabel(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/**
 * 'leaves in 1h15', 'leaves in 7 days', 'leaves now', 'left 25m ago'. With the
 * departure airport's `tz`, "N days" counts calendar days there (never in the
 * device's own time zone).
 */
export function leavesLabel(depUtc: number, nowMs: number, tz?: string): string {
  const min = Math.round((depUtc - nowMs) / 60_000);
  if (min >= 48 * 60) {
    const days = tz ? diffDays(utcToLocal(nowMs, tz).dateKey, utcToLocal(depUtc, tz).dateKey) : Math.floor(min / (24 * 60));
    return `leaves in ${days} days`;
  }
  if (min > 0) return `leaves in ${hm(min)}`;
  if (min === 0) return 'leaves now';
  return `left ${hm(-min)} ago`;
}

/** 'AC834' or 'AC489 + AC824'. */
export function flightsLabel(it: Itinerary): string {
  return it.legs.map(l => l.flightNumber ?? 'an estimated leg').join(' + ');
}

/** '16:20' (or '4:20 PM') for an ISO instant, local at `tz`. */
export function clockAt(iso: string, tz: string, fmt: TimeFormat): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatClock(utcToLocal(ms, tz).hhmm, fmt) : '';
}

/** 'YUL time': labels a clock time as local at that airport. */
export function zoneLabel(code: string): string {
  return `${code} time`;
}

/**
 * 'Today', 'Tomorrow', 'Yesterday' or '' for a departure day, against the
 * calendar at the departure airport (not the device's time zone).
 */
export function dayWord(depKey: string, nowMs: number, origin: string): string {
  const d = diffDays(utcToLocal(nowMs, airportTz(origin)).dateKey, depKey);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : '';
}

/** The text of a load note: '14 open, 9 listed, Gate 52' (only the parts written). */
export function noteText(n: LoadNote): string {
  const parts: string[] = [];
  if (n.open !== null) parts.push(`${n.open} open`);
  if (n.listed !== null) parts.push(`${n.listed} listed`);
  if (n.text.trim()) parts.push(n.text.trim());
  return parts.join(', ');
}

// ── Which leg is "today" ──────────────────────────────────────────────────────

export interface TodayTarget { tripId: string; legId: string }

/**
 * The leg /today shows: an explicit ?trip= (and ?leg=) when it names a flight
 * leg, else the trip's travel-day leg, else the travel day across all trips.
 */
export function resolveToday(trips: Trip[], nowMs: number, tripId?: string | null, legId?: string | null): TodayTarget | null {
  if (tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return null;
    if (legId) {
      const leg = trip.legs.find(l => l.id === legId);
      return leg && leg.kind === 'flight' && leg.refs.length ? { tripId, legId } : null;
    }
    const day = activeTravelDay([trip], nowMs);
    return day ? { tripId: day.tripId, legId: day.legId } : null;
  }
  const day = activeTravelDay(trips, nowMs);
  return day ? { tripId: day.tripId, legId: day.legId } : null;
}

/**
 * The segment of a flight leg the traveller is at: the first one they have
 * not boarded yet. A segment recorded as not boarded (or not tried) stops
 * here, since the traveller is still at its origin.
 */
export function currentSegment(trip: Trip, leg: FlightLeg, outcomes: readonly Outcome[]): number {
  const boarded = new Set(outcomes
    .filter(o => o.tripId === trip.id && (o.kind === 'allBoarded' || o.kind === 'someBoarded'))
    .map(o => instanceKey(o)));
  const i = leg.refs.findIndex(r => !boarded.has(instanceKey(r)));
  return i < 0 ? Math.max(0, leg.refs.length - 1) : i;
}

// ── Ground legs and the days between flights ────────────────────────────────

/** The calendar a ground leg is read against: local at its start place (else the goal). */
function groundDayKey(leg: GroundLeg, trip: Trip, nowMs: number): { today: string; day: string } {
  const tz = endTz(leg.from) ?? trip.goal.tz ?? airportTz(trip.fromHub);
  return { today: utcToLocal(nowMs, tz).dateKey, day: leg.userTimes?.depDateKey ?? leg.dateKey };
}

/**
 * The ground leg /today shows when no flight is up: an explicit ?trip=&leg=
 * naming a ground leg, else a train, bus, car or ferry leg planned for today
 * (local at its start). Open legs come before ones already marked done;
 * dropped legs never show.
 */
export function resolveGroundToday(trips: Trip[], nowMs: number, tripId?: string | null, legId?: string | null): TodayTarget | null {
  if (tripId && legId) {
    const leg = trips.find(t => t.id === tripId)?.legs.find(l => l.id === legId);
    return leg && leg.kind === 'ground' ? { tripId, legId } : null;
  }
  const found: { target: TodayTarget; open: boolean; depUtc: number }[] = [];
  for (const trip of trips) {
    if (trip.archived || (tripId && trip.id !== tripId)) continue;
    for (const leg of trip.legs) {
      if (leg.kind !== 'ground' || leg.status === 'abandoned') continue;
      const k = groundDayKey(leg, trip, nowMs);
      if (k.day !== k.today) continue;
      found.push({ target: { tripId: trip.id, legId: leg.id }, open: !isFinalStatus(leg.status), depUtc: legStartUtc(leg, trip.legs) });
    }
  }
  found.sort((a, b) => Number(b.open) - Number(a.open) || a.depUtc - b.depUtc);
  return found[0]?.target ?? null;
}

export interface GroundTodayView {
  tripId: string;
  legId: string;
  eyebrow: string;          // 'Today · Wed Oct 14 · Madrid'
  title: string;            // 'Madrid → Seville'
  mode: GroundLeg['mode'];
  modeLabel: string;        // 'Train'
  /** The saved departure ('09:00'), or null while only estimated. */
  time: string | null;
  zone: string;             // 'Madrid time'
  provenance: Provenance;
  status: LegStatus;
  final: boolean;
  sub: string;              // 'Train 2h39' or 'Train · arrives 14:45'
  /** Timetable facts for the corridor: 'trains roughly hourly · usual last one 21:30'. */
  info: string | null;
  note: string;
}

export function groundTodayView(input: { trip: Trip; legId: string; nowMs: number; fmt: TimeFormat }): GroundTodayView | null {
  const { trip, nowMs, fmt } = input;
  const leg = trip.legs.find(l => l.id === input.legId);
  if (!leg || leg.kind !== 'ground') return null;
  const t = leg.userTimes;
  const ride = groundRide(leg);
  const from = leg.from.code ? airportEnd(leg.from.code) ?? leg.from : leg.from;
  const g = groundEstimate(from, leg.to, { dateKey: leg.dateKey });
  const sub = t
    ? `${MODE_LABEL[leg.mode]} · arrives ${formatClock(t.arrLocal, fmt)}${t.arrDateKey !== t.depDateKey ? ' (next day)' : ''}`
    : ride.label;
  const info = leg.mode === g.mode
    ? [g.frequency, g.lastDepLocal ? `usual last one ${formatClock(g.lastDepLocal, fmt)}` : null].filter(Boolean).join(' · ') || null
    : null;
  const k = groundDayKey(leg, trip, nowMs);
  const d = diffDays(k.today, k.day);
  return {
    tripId: trip.id,
    legId: leg.id,
    eyebrow: [d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : '', dayLabel(k.day), leg.from.name].filter(Boolean).join(' · '),
    title: `${leg.from.name} → ${leg.to.name}`,
    mode: leg.mode,
    modeLabel: MODE_LABEL[leg.mode] ?? 'Ground',
    time: t ? formatClock(t.depLocal, fmt) : null,
    zone: `${leg.from.name} time`,
    provenance: ride.provenance,
    status: leg.status,
    final: isFinalStatus(leg.status),
    sub,
    info,
    note: leg.note.trim(),
  };
}

/** The trip is under way: its first leg has started and the home-by time has not passed. */
export function tripUnderWay(trip: Trip, nowMs: number): boolean {
  if (trip.archived) return false;
  const first = sortLegs(trip.legs.filter(l => l.status !== 'abandoned'))[0];
  const w = first ? legWindow(first, trip.legs) : null;
  return !!w && nowMs >= w.depUtc && nowMs <= deadlineUtc(trip.homeBy, trip.homeAirport);
}

export interface MidTripView {
  tripId: string;
  eyebrow: string;          // 'Seville trip · Wed Oct 14'
  title: string;            // 'Day 2 in Seville' | 'On your way to Seville'
  /** The next open leg, with where it stands. */
  next: { title: string; detail: string } | null;
  /** 'Home by Mon Oct 19, 22:00' and '5 days to go'. */
  homeBy: { label: string; countdown: string };
  fact: string | null;
}

/** 'today', 'tomorrow', '5 days to go' against the calendar at the home airport. */
function homeByCountdown(trip: Trip, nowMs: number): string {
  const d = diffDays(utcToLocal(nowMs, airportTz(trip.homeAirport)).dateKey, trip.homeBy.dateKey);
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `${d} days to go`;
}

/** When and on which day the first outbound flight lands (else the outbound date, no instant). */
function arrival(trip: Trip): { dateKey: string; utc: number | null } {
  const out = trip.legs.find((l): l is FlightLeg => l.kind === 'flight' && l.role !== 'return' && l.refs.length > 0 && l.status !== 'abandoned');
  if (!out) return { dateKey: trip.outboundDate, utc: null };
  const last = out.refs[out.refs.length - 1];
  return { dateKey: last.arrDateKey, utc: refArrUtc(last) };
}

function nextLeg(trip: Trip, nowMs: number, fmt: TimeFormat): MidTripView['next'] {
  const leg = sortLegs(trip.legs).find(l => !isFinalStatus(l.status) && legStartUtc(l, trip.legs) > nowMs);
  if (!leg) return null;
  if (leg.kind === 'flight') {
    if (!leg.refs.length) return null;
    const ref = leg.refs[0];
    const home = leg.role === 'return' ? ' home' : '';
    const state = leg.status === 'planned' ? 'Not listed yet' : LEG_STATUS_LABEL[leg.status];
    return {
      title: `Next: ${ref.flightNumber}${home} · ${dayLabel(ref.dateKey)} ${formatClock(ref.depLocal, fmt)} ${zoneLabel(ref.origin)}`,
      detail: `${state} · ${leavesLabel(refDepUtc(ref), nowMs, airportTz(ref.origin))}`,
    };
  }
  const day = leg.userTimes?.depDateKey ?? leg.dateKey;
  const time = leg.userTimes ? ` ${formatClock(leg.userTimes.depLocal, fmt)}` : '';
  return {
    title: `Next: ${MODE_LABEL[leg.mode] ?? 'Ground'} ${leg.from.name} → ${leg.to.name} · ${dayLabel(day)}${time}`,
    detail: groundRide(leg).label,
  };
}

function goalFact(trip: Trip, nowMs: number): string | null {
  const dest = findDestination(trip.goal.acCode) ?? findHub(trip.goal.acCode);
  const hub = findHub(trip.fromHub);
  if (!dest || !hub) return null;
  const nonstops = getDestinationCodes(hub.code).map(c => findHub(c) ?? findDestination(c)).filter((x): x is NonNullable<typeof x> => !!x);
  return dailyFact(dest, hub, nonstops, nowMs);
}

/**
 * A day of a trip that is under way with nothing scheduled: which day it is at
 * the goal, the next leg, the home-by countdown and (when one applies) a fact
 * about the destination. The trip with the nearest home-by time wins.
 */
export function midTripView(trips: Trip[], nowMs: number, fmt: TimeFormat, tripId?: string | null): MidTripView | null {
  const trip = trips
    .filter(t => (!tripId || t.id === tripId) && tripUnderWay(t, nowMs))
    .sort((a, b) => deadlineUtc(a.homeBy, a.homeAirport) - deadlineUtc(b.homeBy, b.homeAirport))[0];
  if (!trip) return null;
  const tz = trip.goal.tz || airportTz(trip.homeAirport);
  const todayKey = utcToLocal(nowMs, tz).dateKey;
  const arr = arrival(trip);
  const n = arr.utc !== null && arr.utc > nowMs ? 0 : diffDays(arr.dateKey, todayKey) + 1;
  return {
    tripId: trip.id,
    eyebrow: `${trip.name} · ${dayLabel(todayKey)}`,
    title: n >= 1 ? `Day ${n} in ${trip.goal.name}` : `On your way to ${trip.goal.name}`,
    next: nextLeg(trip, nowMs, fmt),
    homeBy: { label: `Home by ${dayLabel(trip.homeBy.dateKey)}, ${formatClock(trip.homeBy.hhmm, fmt)}`, countdown: homeByCountdown(trip, nowMs) },
    fact: goalFact(trip, nowMs),
  };
}

export interface UpcomingTripView { tripId: string; title: string; detail: string }

/** The nearest trip that has not started: 'Next trip in 5 days' with its name and first date. */
export function upcomingTripView(trips: Trip[], nowMs: number): UpcomingTripView | null {
  let best: { trip: Trip; start: number } | null = null;
  for (const trip of trips) {
    if (trip.archived) continue;
    const first = sortLegs(trip.legs.filter(l => l.status !== 'abandoned'))[0];
    const w = first ? legWindow(first, trip.legs) : null;
    const start = w ? w.depUtc : deadlineUtc({ dateKey: trip.outboundDate, hhmm: '00:00' }, trip.fromHub);
    if (start <= nowMs || (best && best.start <= start)) continue;
    best = { trip, start };
  }
  if (!best) return null;
  const d = diffDays(utcToLocal(nowMs, airportTz(best.trip.fromHub)).dateKey, best.trip.outboundDate);
  return {
    tripId: best.trip.id,
    title: d <= 0 ? 'Your next trip is later today' : d === 1 ? 'Next trip tomorrow' : `Next trip in ${d} days`,
    detail: `${best.trip.name} · ${dayLabel(best.trip.outboundDate)}`,
  };
}

// ── Explore banner ────────────────────────────────────────────────────────────

/** 'Today · Montréal → Madrid · AC834 17:55 · Listed', or null when nothing departs today. */
export function bannerText(trips: Trip[], nowMs: number, fmt: TimeFormat): { title: string; detail: string } | null {
  const day = activeTravelDay(trips, nowMs);
  if (!day) return null;
  const trip = trips.find(t => t.id === day.tripId);
  const leg = trip?.legs.find(l => l.id === day.legId);
  if (!trip || !leg || leg.kind !== 'flight' || !leg.refs.length) return null;
  const ref = leg.refs[0];
  return {
    title: `Today · ${day.title}`,
    detail: `${ref.flightNumber} ${formatClock(ref.depLocal, fmt)} ${zoneLabel(ref.origin)} · ${LEG_STATUS_LABEL[leg.status]}`,
  };
}

// ── /today ────────────────────────────────────────────────────────────────────

export interface TodayBackup { title: string; detail: string }

export interface TodayView {
  tripId: string;
  legId: string;
  eyebrow: string;          // 'Today · Thu Oct 8 · at YUL' (Today / Tomorrow by the calendar at YUL)
  title: string;            // 'Montréal → Madrid'
  time: string;             // '17:55', local at the departure airport
  zone: string;             // 'YUL time'
  status: LegStatus;
  /** Where the times come from: Scheduled, or Unknown when the flight was not found in the latest data. */
  provenance: FlightLeg['provenance'];
  final: boolean;
  /** A return leg: recovery means the next way home (the Return tab), not the goal. */
  isReturn: boolean;
  sub: string;              // 'AC834 · A330-300 · leaves in 1h15'
  ref: FlightRef;           // the segment shown
  note: { time: string; text: string } | null;
  left: PrepItem[];
  backup: TodayBackup | null;
}

/** How far ahead a return-leg backup is searched (the missed day and the next). */
const RETURN_BACKUP_DAYS = 2;

/**
 * A return leg's backup: the next departure home from the same airport that
 * leaves at least MISS_GAP_MIN after the missed flight (that day or the next).
 */
export function returnBackup(trip: Trip, leg: FlightLeg, connect: ConnectOptions, fmt: TimeFormat): TodayBackup | null {
  const ref = leg.refs[0];
  const home = trip.homeAirport || leg.refs[leg.refs.length - 1].dest;
  const after = refDepUtc(ref) + MISS_GAP_MIN * MINUTE_MS;
  for (let i = 0; i < RETURN_BACKUP_DAYS; i++) {
    const day = addDays(ref.dateKey, i);
    const it = departuresHome(ref.origin, home, day, connect).find(x => x.departUtc >= after);
    if (!it) continue;
    const when = day === ref.dateKey ? 'later today' : WEEKDAY_SHORT[weekdayIndex(day)];
    return {
      title: `Backup ${when}: ${flightsLabel(it)} to ${placeName(it.dest)} ${formatClock(it.legs[0].depLocal, fmt)}`,
      detail: `Still possible if you don't clear ${ref.flightNumber}`,
    };
  }
  return null;
}

/** The first usable option if the leg's flight leaves without you, tonight first. */
export function todayBackup(trip: Trip, leg: FlightLeg, connect: ConnectOptions, fmt: TimeFormat): TodayBackup | null {
  // Recovery searches toward the goal: for a return leg the backup is the next way home.
  if (leg.role === 'return') return returnBackup(trip, leg, connect, fmt);
  const r = missOneOutbound(trip, leg.id, connect);
  const missed = leg.refs[0].flightNumber;
  const tonight = r.tonight.find(o => o.status === 'usable');
  if (tonight) {
    return {
      title: `Backup tonight: ${flightsLabel(tonight.itinerary)} to ${placeName(tonight.gateway)} ${formatClock(tonight.itinerary.legs[0].depLocal, fmt)}`,
      detail: `Still possible if you don't clear ${missed}`,
    };
  }
  const tomorrow = r.tomorrow.find(o => o.status === 'usable');
  if (tomorrow) {
    const it = tomorrow.itinerary;
    return {
      title: `Backup tomorrow: ${flightsLabel(it)} to ${placeName(tomorrow.gateway)} ${WEEKDAY_SHORT[weekdayIndex(it.dateKey)]} ${formatClock(it.legs[0].depLocal, fmt)}`,
      detail: `Nothing else found tonight in our schedule data`,
    };
  }
  return null;
}

export function todayView(input: {
  trip: Trip; legId: string; nowMs: number; notes: readonly LoadNote[]; outcomes: readonly Outcome[];
  connect: ConnectOptions; fmt: TimeFormat;
}): TodayView | null {
  const { trip, legId, nowMs, fmt } = input;
  const leg = trip.legs.find(l => l.id === legId);
  if (!leg || leg.kind !== 'flight' || !leg.refs.length) return null;
  const seg = currentSegment(trip, leg, input.outcomes);
  const ref = leg.refs[seg];
  const last = leg.refs[leg.refs.length - 1];
  const final = isFinalStatus(leg.status);
  const departed = refDepUtc(ref) < nowMs;

  const subParts = [ref.flightNumber];
  if (ref.aircraft) subParts.push(shortAircraftName(ref.aircraft));
  const tz = airportTz(ref.origin);
  if (!final) subParts.push(leavesLabel(refDepUtc(ref), nowMs, tz));
  // Unknown provenance on a route the network lists: flown, but not in our schedules.
  const routeNote = leg.provenance === 'unknown' ? networkNoteFor([ref]) : null;
  if (routeNote) subParts.push(routeNote);

  const notes = input.notes
    .filter(n => instanceKey(n) === instanceKey(ref) && noteText(n))
    .sort((a, b) => b.at.localeCompare(a.at));
  const note = notes[0] ? { time: `${clockAt(notes[0].at, tz, fmt)} ${zoneLabel(ref.origin)}`, text: noteText(notes[0]) } : null;
  const word = dayWord(ref.dateKey, nowMs, ref.origin);

  return {
    tripId: trip.id,
    legId: leg.id,
    eyebrow: [word, dayLabel(ref.dateKey), `at ${ref.origin}`].filter(Boolean).join(' · '),
    title: `${placeName(ref.origin)} → ${placeName(last.dest)}`,
    time: formatClock(ref.depLocal, fmt),
    zone: zoneLabel(ref.origin),
    status: leg.status,
    provenance: leg.provenance,
    final,
    isReturn: leg.role === 'return',
    sub: subParts.join(' · '),
    ref,
    note,
    // Listing and check-in can't be done once the flight has left: the outcome question replaces them.
    left: final ? [] : legPrepItems(trip, leg.id).filter(item => !(departed && /^(list|checkin):/.test(item.id))),
    backup: final || seg > 0 ? null : todayBackup(trip, leg, input.connect, fmt),
  };
}

/** The leg status a "Left to do" tick (or untick) sets; null when the item is not a status item. */
export function statusForTick(item: PrepItem, current: LegStatus): LegStatus | null {
  if (item.id.startsWith('list:')) return item.done ? (current === 'listed' ? 'planned' : null) : current === 'planned' ? 'listed' : null;
  if (item.id.startsWith('checkin:')) return item.done ? 'listed' : 'checkedIn';
  return null;
}

// ── /trips/:id/recover ────────────────────────────────────────────────────────

export interface RecoverRow {
  key: string;
  gateway: string;
  thumb: { kind: 'photo'; code: string } | { kind: 'code'; code: string };
  name: string;             // 'Lisbon', 'Madrid again', 'via Toronto'
  code: string | null;      // 'LIS' (shown after the name)
  line: string;             // 'AC812 21:45 → 09:20⁺¹' or the grey reason line
  onward: string | null;    // 'then bus about 6h45 · Seville Fri evening'
  usable: boolean;
  option: ReachableOption;
}

export interface RecoverView {
  tripId: string;
  legId: string | null;
  at: string;
  subtitle: string;         // 'From YUL · now 18:05'
  goal: string;             // 'Seville'
  homeBy: string;           // 'Tue 22:00'
  legNote: string | null;   // 'AC834 marked Not boarded'
  tonight: RecoverRow[];
  tomorrow: RecoverRow[];
  tomorrowMore: RecoverRow[];
  note: { text: string; returnBroken: boolean } | null;
  /** True when nothing usable is left tonight: the "Stuck tonight?" card shows. */
  stuckTonight: boolean;
  /** Where the traveller is and the goal, as leg ends for the "Other ways there" links (null when `at` is not a known airport). */
  ways: {
    from: LegEnd; to: LegEnd;
    /** Local date at `from`. */
    dateKey: string;
    /** A ground route exists from `from` to the goal (bus and train sites are worth showing). */
    land: boolean;
    /** The goal's own AC airport, for the Kiwi.com flight search. */
    toAirport?: string;
  } | null;
  /** Tonight's hotel check-in date (local at `at`) and the airport's display name. */
  stay: { code: string; airportName: string; checkIn: string } | null;
}

/** The outbound leg being recovered: ?leg= when it is a flight leg, else the last outbound flight leg from `at`. */
export function recoverLeg(trip: Trip, at: string | null, legId: string | null): FlightLeg | null {
  const flights = trip.legs.filter((l): l is FlightLeg => l.kind === 'flight' && l.refs.length > 0);
  if (legId) {
    const leg = flights.find(l => l.id === legId);
    if (leg) return leg;
  }
  const outs = flights.filter(l => l.role !== 'return' && (!at || l.refs[0].origin === at));
  return outs.find(l => !isFinalStatus(l.status))
    ?? [...outs].reverse().find(l => l.status === 'notBoarded')
    ?? null;
}

/** 'then bus about 6h45 · Seville Fri evening'. */
export function onwardLine(o: ReachableOption, goal: Trip['goal']): string {
  if (o.ground.mode === 'unknown') return `then onward travel unknown`;
  const label = o.ground.label.charAt(0).toLowerCase() + o.ground.label.slice(1);
  if (o.arriveGoalUtc === null) return `then ${label}`;
  const local = utcToLocal(o.arriveGoalUtc, goal.tz || airportTz(o.gateway));
  const when = `${goal.name} ${WEEKDAY_SHORT[weekdayIndex(local.dateKey)]} ${partOfDay(local.hhmm)}`;
  const late = arrivalAtGoal(o.itinerary.arriveUtc, o.ground, airportTz(o.gateway)).lastDepMissed;
  return late ? `then ${label} · last one likely gone, ${when}` : `then ${label} · ${when}`;
}

function flightLine(it: Itinerary, fmt: TimeFormat, withDay: boolean): string {
  const day = withDay ? `${WEEKDAY_SHORT[weekdayIndex(it.dateKey)]} ` : '';
  const first = it.legs[0];
  if (it.legs.length === 1) {
    return `${day}${first.flightNumber ?? ''} ${formatClock(first.depLocal, fmt)} → ${formatClock(it.legs[0].arrLocal, fmt)}${supOffset(it.arrDayOffset)}`;
  }
  const last = it.legs[it.legs.length - 1];
  return `${day}${flightsLabel(it)} · ${formatClock(first.depLocal, fmt)} → ${formatClock(last.arrLocal, fmt)}${supOffset(it.arrDayOffset)} · ${it.legs.length} standby legs`;
}

function row(o: ReachableOption, trip: Trip, currentGw: string | null, fmt: TimeFormat): RecoverRow {
  const it = o.itinerary;
  const key = `${o.day}|${o.gateway}|${it.legs.map(l => `${l.flightNumber}${l.dateKey}`).join('+')}`;
  if (o.status === 'missedConnection') {
    const hub = it.hubs[0] ?? it.legs[0].dest;
    return {
      key, gateway: o.gateway, thumb: { kind: 'code', code: hub },
      name: `via ${placeName(hub)}`, code: `to ${o.gateway}`,
      line: o.reason ?? '', onward: null, usable: false, option: o,
    };
  }
  const again = o.day === 'tomorrow' && o.gateway === currentGw ? ' again' : '';
  const via = it.legs.length > 1 ? ` via ${placeName(it.hubs[0])}` : '';
  if (o.status === 'closed') {
    return {
      key, gateway: o.gateway, thumb: { kind: 'code', code: o.gateway },
      name: `${placeName(o.gateway)}${via}`, code: o.gateway,
      line: `${flightsLabel(it)} ${formatClock(it.legs[0].depLocal, fmt)} · ${o.reason ?? 'boarding has likely closed'}`,
      onward: null, usable: false, option: o,
    };
  }
  if (o.day === 'tomorrow') {
    return {
      key, gateway: o.gateway, thumb: { kind: 'photo', code: o.gateway },
      name: `${placeName(o.gateway)}${again}${via}`, code: o.gateway,
      line: `${WEEKDAY_SHORT[weekdayIndex(it.dateKey)]} ${flightsLabel(it)} ${formatClock(it.legs[0].depLocal, fmt)}`
        + (it.legs.length > 1 ? ` · ${it.legs.length} standby legs` : '')
        + ` · ${onwardLine(o, trip.goal).replace(/^then [^·]*· /, '')}`,
      onward: null,
      usable: true, option: o,
    };
  }
  return {
    key, gateway: o.gateway, thumb: { kind: 'photo', code: o.gateway },
    name: `${placeName(o.gateway)}${via}`, code: o.gateway,
    line: flightLine(it, fmt, false), onward: onwardLine(o, trip.goal), usable: true, option: o,
  };
}

/** Nights at the goal the original leg would have given (its snapshot plus the estimated ground trip). */
export function plannedNights(trip: Trip, leg: FlightLeg): number | null {
  const last = leg.refs[leg.refs.length - 1];
  const end = airportEnd(last.dest);
  if (!end) return null;
  const g: GroundEstimate = groundEstimate(end, trip.goal, { dateKey: last.arrDateKey });
  const arr = arrivalAtGoal(refArrUtc(last), g, airportTz(last.dest)).utc;
  if (arr === null) return null;
  const leave = trip.legs.find(l => leavesGoalArea(trip, l) && legStartUtc(l, trip.legs) > arr);
  if (!leave) return null;
  return Math.max(0, diffDays(utcToLocal(arr, trip.goal.tz ?? airportTz(last.dest)).dateKey, legDepartureKey(leave)));
}

function nightsWord(n: number): string {
  return n === 1 ? '1 night' : `${n} nights`;
}

/**
 * The blue note under the options: whether the planned return still works
 * and how many nights at the goal each first choice leaves.
 * 'Your Tuesday return still works either way. Lisbon tonight keeps all 3
 * nights in Seville; waiting for Madrid tomorrow leaves 2.'
 */
export function recoverNote(trip: Trip, leg: FlightLeg | null, tonight: ReachableOption | null, tomorrow: ReachableOption | null):
  { text: string; returnBroken: boolean } | null {
  const picks = [tonight, tomorrow].filter((o): o is ReachableOption => !!o);
  if (!picks.length) return null;
  const ret = trip.legs.find((l): l is FlightLeg => l.kind === 'flight' && l.role === 'return' && !isFinalStatus(l.status) && l.refs.length > 0);
  const parts: string[] = [];
  let returnBroken = false;

  if (ret) {
    const long = WEEKDAY_LONG[weekdayIndex(ret.refs[0].dateKey)];
    const short = WEEKDAY_SHORT[weekdayIndex(ret.refs[0].dateKey)];
    const works = picks.map(o => o.returnStillWorks);
    if (works.every(w => w === true)) {
      parts.push(picks.length > 1 ? `Your ${long} return still works either way.` : `Your ${long} return still works.`);
    } else if (works.every(w => w === false)) {
      returnBroken = true;
      parts.push(`Your ${short} return no longer fits: open Return.`);
    } else if (works.some(w => w === false)) {
      returnBroken = true;
      const bad = picks.find(o => o.returnStillWorks === false)!;
      parts.push(`Your ${short} return no longer fits ${placeName(bad.gateway)} ${bad.day}: open Return.`);
    }
  }

  const planned = leg ? plannedNights(trip, leg) : null;
  const goal = trip.goal.name;
  const say = (o: ReachableOption, lead: string) => {
    const n = o.nightsAtGoal!;
    return planned !== null && n >= planned ? `${lead} keeps all ${nightsWord(n)} in ${goal}` : `${lead} leaves ${nightsWord(n)} in ${goal}`;
  };
  if (tonight && tonight.nightsAtGoal !== null && tomorrow && tomorrow.nightsAtGoal !== null) {
    const a = say(tonight, `${placeName(tonight.gateway)} tonight`);
    const b = tomorrow.nightsAtGoal === tonight.nightsAtGoal
      ? `${placeName(tomorrow.gateway)} tomorrow too`
      : `waiting for ${placeName(tomorrow.gateway)} tomorrow leaves ${tomorrow.nightsAtGoal}`;
    parts.push(`${a}; ${b}.`);
  } else {
    const one = picks.find(o => o.nightsAtGoal !== null);
    if (one) parts.push(`${say(one, `${placeName(one.gateway)} ${one.day}`)}.`);
  }
  if (!parts.length) return null;
  const text = parts.join(' ');
  return { text: text.charAt(0).toUpperCase() + text.slice(1), returnBroken };
}

export function recoverView(input: {
  trip: Trip; at: string | null; legId: string | null; nowMs: number; connect: ConnectOptions; fmt: TimeFormat;
}): RecoverView {
  const { trip, nowMs, fmt } = input;
  const leg = recoverLeg(trip, input.at, input.legId);
  const at = input.at || leg?.refs[0].origin || trip.fromHub;
  const r = stillReachable({ trip, at, nowMs, connect: input.connect });
  // Never offer the very flight being recovered from.
  const self = leg?.refs[0];
  const notSelf = (o: ReachableOption) =>
    !self || !(o.itinerary.legs[0].flightNumber === self.flightNumber && o.itinerary.dateKey === self.dateKey);
  const currentGw = leg ? leg.refs[leg.refs.length - 1].dest : null;

  const tonightOpts = r.tonight.filter(notSelf);
  const tomorrowOpts = r.tomorrow.filter(notSelf);
  const tonight = tonightOpts.map(o => row(o, trip, currentGw, fmt));
  // Tomorrow: the plan's own gateway first ("Madrid again"), then the earliest arrival; the rest folded.
  const tomorrowAll = tomorrowOpts.map(o => row(o, trip, currentGw, fmt));
  const first = new Set<string>();
  const again = tomorrowAll.find(x => x.gateway === currentGw);
  if (again) first.add(again.key);
  if (tomorrowAll[0]) first.add(tomorrowAll[0].key);
  const tomorrow = tomorrowAll.filter(x => first.has(x.key)).sort((a, b) => (a.gateway === currentGw ? -1 : b.gateway === currentGw ? 1 : 0));
  const tomorrowMore = tomorrowAll.filter(x => !first.has(x.key));

  const firstTonight = tonightOpts.find(o => o.status === 'usable') ?? null;
  const firstTomorrow = (again?.option ?? tomorrowOpts.find(o => o.status === 'usable')) ?? null;
  const hb = trip.homeBy;

  return {
    tripId: trip.id,
    legId: leg?.id ?? null,
    at,
    subtitle: `From ${at} · now ${formatClock(utcToLocal(nowMs, airportTz(at)).hhmm, fmt)}`,
    goal: trip.goal.name,
    homeBy: `${WEEKDAY_SHORT[weekdayIndex(hb.dateKey)]} ${formatClock(hb.hhmm, fmt)}`,
    legNote: leg ? `${leg.refs[0].flightNumber} ${isFinalStatus(leg.status) ? 'marked ' : ''}${LEG_STATUS_LABEL[leg.status]}` : null,
    tonight,
    tomorrow,
    tomorrowMore,
    note: recoverNote(trip, leg, firstTonight, firstTomorrow),
    ...recoverExtras(trip, at, nowMs, !tonight.some(r => r.usable)),
  };
}

/** The "Stuck tonight?" card shows from this local time (until 05:00): earlier, tomorrow's flights are still the plan. */
const STUCK_FROM = '17:00';

/** Everything the recover page needs for "Other ways there" and "Stuck tonight?". */
function recoverExtras(trip: Trip, at: string, nowMs: number, stuck: boolean):
  Pick<RecoverView, 'stuckTonight' | 'ways' | 'stay'> {
  const from = airportEnd(at);
  if (!from) return { stuckTonight: false, ways: null, stay: null };
  const local = utcToLocal(nowMs, airportTz(at));
  const to = placeEnd(trip.goal);
  const land = groundEstimate(from, trip.goal).mode !== 'unknown';
  return {
    stuckTonight: stuck && (local.hhmm >= STUCK_FROM || local.hhmm < '05:00'),
    ways: { from, to, dateKey: local.dateKey, land, toAirport: trip.goal.acCode },
    stay: { code: at, airportName: from.name, checkIn: tonightCheckIn(local.dateKey, local.hhmm) },
  };
}
