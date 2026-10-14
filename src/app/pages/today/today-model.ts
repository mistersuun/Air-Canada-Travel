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
import { currentStop, stopForLeg } from '../../trips/stops';
import { type ConnectOptions, type Itinerary } from '../../utils/connections';
import { airportTz } from '../../utils/airports';
import { networkNoteFor } from '../../data/route-network';
import { MINUTE_MS, addDays, diffDays, formatClock, formatKey, utcToLocal, weekdayIndex, weekdayLong, weekdayShort } from '../../utils/time';
import { type MsgKey, t } from '../../i18n/t';
import { MISS_GAP_MIN, deadlineUtc, departuresHome } from '../../trips/engine/homeby';
import { hm, supOffset } from '../../ui/format';
import type { TimeFormat } from '../../state/prefs.service';
import { airportEnd, arrivalAtGoal, groundEstimate, placeEnd, type GroundEstimate } from '../../places/ground';
import { tonightCheckIn } from '../../places/stay-links';
import { legPrepItems, type PrepItem } from '../../places/prep';
import { partOfDay } from '../reach/reach-model';
import { shortAircraftName } from '../../trips/engine/facts';
import { groundRide } from '../trips/trips-model';
import { endTz, legStartUtc, legWindow, refArrUtc, refDepUtc, sortLegs } from '../../trips/engine/legs';
import { DEFAULT_LISTING_HOURS, listingChip } from '../../trips/engine/listing';
import { findDestination, findHub } from '../../utils/airports';
import { getDestinationCodes } from '../../data/schedule-index';
import { dailyFact } from '../destination/fun-facts';
import { type ReachableOption, legDepartureKey, leavesGoalArea, missOneOutbound, stillReachable } from '../../trips/engine/recover';
import { activeTravelDay, placeName } from '../../trips/engine/today';
import {
  type FlightLeg, type FlightRef, type GroundLeg, type LegEnd, type LegStatus, type LoadNote, type Outcome, type Provenance, type Trip, type TripLeg,
  instanceKey, isFinalStatus,
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
    return t('today.leaves.days', { n: days });
  }
  if (min > 0) return t('today.leaves.in', { dur: hm(min) });
  if (min === 0) return t('today.leaves.now');
  return t('today.leaves.ago', { dur: hm(-min) });
}

/** The leg status in the UI language ('Not boarded'); the status itself stays the English id. */
export function legStatusLabel(s: LegStatus): string {
  return t(`today.status.${s}` as MsgKey);
}

const GROUND_MODES = ['train', 'bus', 'car', 'ferry', 'flight'];

/** The ground mode in the UI language ('Train'); any other mode reads as 'Ground'. */
export function groundModeLabel(mode: string): string {
  return t(`today.mode.${GROUND_MODES.includes(mode) ? mode : 'other'}` as MsgKey);
}

/** 'AC834' or 'AC489 + AC824'. */
export function flightsLabel(it: Itinerary): string {
  return it.legs.map(l => l.flightNumber ?? t('today.estimatedLeg')).join(' + ');
}

/** '16:20' (or '4:20 PM') for an ISO instant, local at `tz`. */
export function clockAt(iso: string, tz: string, fmt: TimeFormat): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatClock(utcToLocal(ms, tz).hhmm, fmt) : '';
}

/** 'YUL time': labels a clock time as local at that airport. */
export function zoneLabel(code: string): string {
  return t('today.zone', { code });
}

/**
 * 'Today', 'Tomorrow', 'Yesterday' or '' for a departure day, against the
 * calendar at the departure airport (not the device's time zone).
 */
export function dayWord(depKey: string, nowMs: number, origin: string): string {
  const d = diffDays(utcToLocal(nowMs, airportTz(origin)).dateKey, depKey);
  return d === 0 ? t('format.today') : d === 1 ? t('format.tomorrow') : d === -1 ? t('today.yesterday') : '';
}

/** The text of a load note: '14 open, 9 listed, Gate 52' (only the parts written). */
export function noteText(n: LoadNote): string {
  const parts: string[] = [];
  if (n.open !== null) parts.push(t('today.note.open', { n: n.open }));
  if (n.listed !== null) parts.push(t('today.note.listed', { n: n.listed }));
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

/** The goal's time zone: its own, else its AC airport's, else the home airport's. */
function goalTz(trip: Trip): string {
  return trip.goal.tz || airportTz(trip.goal.acCode ?? trip.homeAirport);
}

/** The calendar a ground leg is read against: local at its start place (else the goal). */
function groundDayKey(leg: GroundLeg, trip: Trip, nowMs: number): { today: string; day: string } {
  const tz = endTz(leg.from) ?? goalTz(trip);
  return { today: utcToLocal(nowMs, tz).dateKey, day: leg.userTimes?.depDateKey ?? utcToLocal(legStartUtc(leg, trip.legs), tz).dateKey };
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
  const ut = leg.userTimes;
  const ride = groundRide(leg);
  const from = leg.from.code ? airportEnd(leg.from.code) ?? leg.from : leg.from;
  const g = groundEstimate(from, leg.to, { dateKey: leg.dateKey });
  const sub = ut
    ? t(ut.arrDateKey !== ut.depDateKey ? 'today.ground.arrivesNext' : 'today.ground.arrives', { mode: groundModeLabel(leg.mode), time: formatClock(ut.arrLocal, fmt) })
    : ride.label;
  const info = leg.mode === g.mode
    ? [g.frequency, g.lastDepLocal ? t('today.ground.lastOne', { time: formatClock(g.lastDepLocal, fmt) }) : null].filter(Boolean).join(' · ') || null
    : null;
  const k = groundDayKey(leg, trip, nowMs);
  const d = diffDays(k.today, k.day);
  return {
    tripId: trip.id,
    legId: leg.id,
    eyebrow: [d === 0 ? t('format.today') : d === 1 ? t('format.tomorrow') : '', dayLabel(k.day), leg.from.name].filter(Boolean).join(' · '),
    title: `${leg.from.name} → ${leg.to.name}`,
    mode: leg.mode,
    modeLabel: groundModeLabel(leg.mode),
    time: ut ? formatClock(ut.depLocal, fmt) : null,
    zone: zoneLabel(leg.from.name),
    provenance: ride.provenance,
    status: leg.status,
    final: isFinalStatus(leg.status),
    sub,
    info,
    note: leg.note.trim(),
  };
}

/**
 * The trip is under way: its first leg has started and the home-by time has not
 * passed. It ends earlier once the traveller is home: every live leg is done
 * and the last has landed, or the return flight is boarded and has landed.
 */
export function tripUnderWay(trip: Trip, nowMs: number): boolean {
  if (trip.archived) return false;
  const live = sortLegs(trip.legs.filter(l => l.status !== 'abandoned'));
  const first = live[0];
  const w = first ? legWindow(first, trip.legs) : null;
  if (!w || nowMs < w.depUtc || nowMs > deadlineUtc(trip.homeBy, trip.homeAirport)) return false;
  const landed = (l: TripLeg) => {
    const win = legWindow(l, trip.legs);
    return !!win && nowMs >= win.arrUtc;
  };
  if (live.every(l => isFinalStatus(l.status)) && landed(live[live.length - 1])) return false;
  const home = live.find(l => l.kind === 'flight' && l.role === 'return' && l.status === 'boarded' && l.refs.length > 0 && landed(l));
  return !home;
}

export interface MidTripView {
  tripId: string;
  eyebrow: string;          // 'Seville trip · Wed Oct 14'
  title: string;            // 'Day 2 in Seville' | 'On your way to Seville'
  /** The next open leg, with where it stands. */
  next: { title: string; detail: string; listing?: { label: string; open: boolean } | null } | null;
  /** 'Home by Mon Oct 19, 22:00' and '5 days to go'. */
  homeBy: { label: string; countdown: string };
  /** 'Nothing else today.' when a leg started today, else 'Nothing is scheduled today.' */
  quiet: string;
  fact: string | null;
}

/** 'today', 'tomorrow', 'in 5 days' against the calendar at the home airport. */
function homeByCountdown(trip: Trip, nowMs: number): string {
  const d = diffDays(utcToLocal(nowMs, airportTz(trip.homeAirport)).dateKey, trip.homeBy.dateKey);
  return d <= 0 ? t('today.homeBy.today') : d === 1 ? t('today.homeBy.tomorrow') : t('today.homeBy.days', { n: d });
}

/** The outbound flight actually flown (the latest live one) and when it lands, as a date at the goal. */
function arrival(trip: Trip, tz: string): { dateKey: string; utc: number | null } {
  const dead = new Set<string>(['abandoned', 'notBoarded', 'didntTry']);
  const outs = sortLegs(trip.legs).filter((l): l is FlightLeg => l.kind === 'flight' && l.role !== 'return' && l.refs.length > 0 && !dead.has(l.status));
  const out = outs[outs.length - 1];
  if (!out) return { dateKey: trip.outboundDate, utc: null };
  const utc = refArrUtc(out.refs[out.refs.length - 1]);
  return { dateKey: utcToLocal(utc, tz).dateKey, utc };
}

function nextLeg(trip: Trip, nowMs: number, fmt: TimeFormat, listingHours: number): MidTripView['next'] {
  const leg = sortLegs(trip.legs).find(l => !isFinalStatus(l.status) && (l.kind === 'ground' || l.refs.length > 0) && legStartUtc(l, trip.legs) > nowMs);
  if (!leg) return null;
  if (leg.kind === 'flight') {
    const ref = leg.refs[0];
    const when = `${dayLabel(ref.dateKey)} ${formatClock(ref.depLocal, fmt)} ${zoneLabel(ref.origin)}`;
    const state = leg.status === 'planned' ? t('today.notListedYet') : legStatusLabel(leg.status);
    return {
      title: t(leg.role === 'return' ? 'today.next.flightHome' : 'today.next.flight', { flight: ref.flightNumber, when }),
      detail: `${state} · ${leavesLabel(refDepUtc(ref), nowMs, airportTz(ref.origin))}`,
      listing: listingChip(leg, nowMs, listingHours, fmt),
    };
  }
  const day = leg.userTimes?.depDateKey ?? leg.dateKey;
  const time = leg.userTimes ? ` ${formatClock(leg.userTimes.depLocal, fmt)}` : '';
  return {
    title: t('today.next.ground', { mode: groundModeLabel(leg.mode), from: leg.from.name, to: leg.to.name, when: `${dayLabel(day)}${time}` }),
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
export function midTripView(trips: Trip[], nowMs: number, fmt: TimeFormat, tripId?: string | null, listingHours = DEFAULT_LISTING_HOURS): MidTripView | null {
  const trip = trips
    .filter(t => (!tripId || t.id === tripId) && tripUnderWay(t, nowMs))
    .sort((a, b) => deadlineUtc(a.homeBy, a.homeAirport) - deadlineUtc(b.homeBy, b.homeAirport))[0];
  if (!trip) return null;
  const tz = goalTz(trip);
  const todayKey = utcToLocal(nowMs, tz).dateKey;
  const arr = arrival(trip, tz);
  const n = arr.utc !== null && arr.utc > nowMs ? 0 : diffDays(arr.dateKey, todayKey) + 1;
  const homeToday = utcToLocal(nowMs, airportTz(trip.homeAirport)).dateKey;
  const zone = homeToday !== todayKey ? zoneLabel(trip.homeAirport) : '';
  const startedToday = trip.legs.some(l => {
    if (l.status === 'abandoned') return false;
    const w = legWindow(l, trip.legs);
    return !!w && w.depUtc <= nowMs && utcToLocal(w.depUtc, tz).dateKey === todayKey;
  });
  return {
    tripId: trip.id,
    eyebrow: `${trip.name} · ${dayLabel(todayKey)}`,
    title: stopTitle(trip, todayKey, n),
    next: nextLeg(trip, nowMs, fmt, listingHours),
    homeBy: {
      label: t(zone ? 'today.homeBy.labelZone' : 'today.homeBy.label', { day: dayLabel(trip.homeBy.dateKey), time: formatClock(trip.homeBy.hhmm, fmt), zone }),
      countdown: homeByCountdown(trip, nowMs),
    },
    quiet: t(startedToday ? 'today.quiet.else' : 'today.quiet.none'),
    fact: goalFact(trip, nowMs),
  };
}

/** 'Day 3 in Lisbon': counts from arriving at the stop you are in (the goal until a later stop begins). */
function stopTitle(trip: Trip, todayKey: string, goalDay: number): string {
  const stop = currentStop(trip, todayKey);
  if (stop.id !== 'goal') return t('today.day', { n: diffDays(stop.arriveDate, todayKey) + 1, place: stop.place.name });
  return goalDay >= 1 ? t('today.day', { n: goalDay, place: trip.goal.name }) : t('today.onYourWay', { place: trip.goal.name });
}

export interface UpcomingTripView { tripId: string; title: string; detail: string; listing?: { label: string; open: boolean } | null }

/** The nearest trip that has not started: 'Next trip in 5 days' with its name and first date (the first leg's own start day). */
export function upcomingTripView(trips: Trip[], nowMs: number, tripId?: string | null, fmt: TimeFormat = '24h', listingHours = DEFAULT_LISTING_HOURS): UpcomingTripView | null {
  let best: { trip: Trip; start: number; tz: string; first: TripLeg | undefined } | null = null;
  for (const trip of trips) {
    if (trip.archived || (tripId && trip.id !== tripId)) continue;
    const first = sortLegs(trip.legs.filter(l => l.status !== 'abandoned'))[0];
    const w = first ? legWindow(first, trip.legs) : null;
    const tz = first ? (first.kind === 'flight' ? airportTz(first.refs[0]?.origin ?? trip.fromHub) : endTz(first.from) ?? airportTz(trip.fromHub)) : airportTz(trip.fromHub);
    const start = w ? w.depUtc : deadlineUtc({ dateKey: trip.outboundDate, hhmm: '00:00' }, trip.fromHub);
    if (start <= nowMs || (best && best.start <= start)) continue;
    best = { trip, start, tz: w ? tz : airportTz(trip.fromHub), first };
  }
  if (!best) return null;
  const startKey = utcToLocal(best.start, best.tz).dateKey;
  const d = diffDays(utcToLocal(nowMs, best.tz).dateKey, startKey);
  return {
    tripId: best.trip.id,
    title: d <= 0 ? t('today.upcoming.later') : d === 1 ? t('today.upcoming.tomorrow') : t('today.upcoming.days', { n: d }),
    detail: `${best.trip.name} · ${dayLabel(startKey)}`,
    listing: best.first?.kind === 'flight' ? listingChip(best.first, nowMs, listingHours, fmt) : null,
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
    title: t('today.banner.title', { title: day.title }),
    detail: `${ref.flightNumber} ${formatClock(ref.depLocal, fmt)} ${zoneLabel(ref.origin)} · ${legStatusLabel(leg.status)}`,
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
    const p = { flights: flightsLabel(it), place: placeName(it.dest), time: formatClock(it.legs[0].depLocal, fmt) };
    return {
      title: day === ref.dateKey ? t('today.backup.later', p) : t('today.backup.day', { ...p, day: weekdayShort(weekdayIndex(day)) }),
      detail: t('today.backup.still', { flight: ref.flightNumber }),
    };
  }
  return null;
}

/** The first usable option if the leg's flight leaves without you, tonight first. */
export function todayBackup(trip: Trip, leg: FlightLeg, connect: ConnectOptions, fmt: TimeFormat): TodayBackup | null {
  // Recovery searches toward the goal: for a return leg the backup is the next way home.
  if (leg.role === 'return') return returnBackup(trip, leg, connect, fmt);
  const r = missOneOutbound(trip, leg.id, connect);   // heads for the leg's own stop (stopForLeg)
  const missed = leg.refs[0].flightNumber;
  const tonight = r.tonight.find(o => o.status === 'usable');
  if (tonight) {
    return {
      title: t('today.backup.tonight', { flights: flightsLabel(tonight.itinerary), place: placeName(tonight.gateway), time: formatClock(tonight.itinerary.legs[0].depLocal, fmt) }),
      detail: t('today.backup.still', { flight: missed }),
    };
  }
  const tomorrow = r.tomorrow.find(o => o.status === 'usable');
  if (tomorrow) {
    const it = tomorrow.itinerary;
    return {
      title: t('today.backup.tomorrow', { flights: flightsLabel(it), place: placeName(tomorrow.gateway), day: weekdayShort(weekdayIndex(it.dateKey)), time: formatClock(it.legs[0].depLocal, fmt) }),
      detail: t('today.backup.nothingTonight'),
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
    eyebrow: [word, dayLabel(ref.dateKey), t('today.atAirport', { code: ref.origin })].filter(Boolean).join(' · '),
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
  if (o.ground.mode === 'unknown') return t('today.onward.unknown');
  const label = onwardLabel(o);
  if (o.arriveGoalUtc === null) return t('today.onward.then', { label });
  return t('today.onward.thenWhen', { label, when: onwardWhen(o, goal) });
}

/** The ground ride's own label, lower-cased to follow 'then': 'bus about 6h45'. */
function onwardLabel(o: ReachableOption): string {
  return o.ground.label.charAt(0).toLowerCase() + o.ground.label.slice(1);
}

/** 'Seville Fri evening', or with the late-timetable note: 'last one likely gone, Seville Fri evening'. */
function onwardWhen(o: ReachableOption, goal: Trip['goal']): string {
  const local = utcToLocal(o.arriveGoalUtc!, goal.tz || airportTz(o.gateway));
  const when = `${goal.name} ${weekdayShort(weekdayIndex(local.dateKey))} ${partOfDay(local.hhmm)}`;
  const late = arrivalAtGoal(o.itinerary.arriveUtc, o.ground, airportTz(o.gateway)).lastDepMissed;
  return late ? t('today.onward.late', { when }) : when;
}

function flightLine(it: Itinerary, fmt: TimeFormat, withDay: boolean): string {
  const day = withDay ? `${weekdayShort(weekdayIndex(it.dateKey))} ` : '';
  const first = it.legs[0];
  if (it.legs.length === 1) {
    return `${day}${first.flightNumber ?? ''} ${formatClock(first.depLocal, fmt)} → ${formatClock(it.legs[0].arrLocal, fmt)}${supOffset(it.arrDayOffset)}`;
  }
  const last = it.legs[it.legs.length - 1];
  return `${day}${flightsLabel(it)} · ${formatClock(first.depLocal, fmt)} → ${formatClock(last.arrLocal, fmt)}${supOffset(it.arrDayOffset)} · ${t('today.standbyLegs', { n: it.legs.length })}`;
}

function row(o: ReachableOption, trip: Trip, currentGw: string | null, fmt: TimeFormat): RecoverRow {
  const it = o.itinerary;
  const key = `${o.day}|${o.gateway}|${it.legs.map(l => `${l.flightNumber}${l.dateKey}`).join('+')}`;
  if (o.status === 'missedConnection') {
    const hub = it.hubs[0] ?? it.legs[0].dest;
    return {
      key, gateway: o.gateway, thumb: { kind: 'code', code: hub },
      name: t('format.via', { hubs: placeName(hub) }), code: t('today.toCode', { code: o.gateway }),
      line: o.reason ?? '', onward: null, usable: false, option: o,
    };
  }
  const again = o.day === 'tomorrow' && o.gateway === currentGw;
  /** 'Madrid', 'Madrid again', 'Madrid via Toronto'. */
  const named = (place: string, withAgain: boolean) => {
    const base = withAgain && again ? t('today.again', { place }) : place;
    return it.legs.length > 1 ? `${base} ${t('format.via', { hubs: placeName(it.hubs[0]) })}` : base;
  };
  if (o.status === 'closed') {
    return {
      key, gateway: o.gateway, thumb: { kind: 'code', code: o.gateway },
      name: named(placeName(o.gateway), false), code: o.gateway,
      line: `${flightsLabel(it)} ${formatClock(it.legs[0].depLocal, fmt)} · ${o.reason ?? t('today.boardingClosed')}`,
      onward: null, usable: false, option: o,
    };
  }
  if (o.day === 'tomorrow') {
    return {
      key, gateway: o.gateway, thumb: { kind: 'photo', code: o.gateway },
      name: named(placeName(o.gateway), true), code: o.gateway,
      line: `${weekdayShort(weekdayIndex(it.dateKey))} ${flightsLabel(it)} ${formatClock(it.legs[0].depLocal, fmt)}`
        + (it.legs.length > 1 ? ` · ${t('today.standbyLegs', { n: it.legs.length })}` : '')
        + ` · ${o.ground.mode === 'unknown' ? t('today.onward.unknown') : o.arriveGoalUtc === null ? t('today.onward.then', { label: onwardLabel(o) }) : onwardWhen(o, trip.goal)}`,
      onward: null,
      usable: true, option: o,
    };
  }
  return {
    key, gateway: o.gateway, thumb: { kind: 'photo', code: o.gateway },
    name: named(placeName(o.gateway), false), code: o.gateway,
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
  return t('today.nights', { n });
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
    const long = weekdayLong(weekdayIndex(ret.refs[0].dateKey));
    const short = weekdayShort(weekdayIndex(ret.refs[0].dateKey));
    const works = picks.map(o => o.returnStillWorks);
    if (works.every(w => w === true)) {
      parts.push(t(picks.length > 1 ? 'today.note.returnBoth' : 'today.note.returnOne', { day: long }));
    } else if (works.every(w => w === false)) {
      returnBroken = true;
      parts.push(t('today.note.returnBroken', { day: short }));
    } else if (works.some(w => w === false)) {
      returnBroken = true;
      const bad = picks.find(o => o.returnStillWorks === false)!;
      parts.push(t('today.note.returnBrokenFor', { day: short, place: placeName(bad.gateway), when: bad.day }));
    }
  }

  const planned = leg ? plannedNights(trip, leg) : null;
  const goal = trip.goal.name;
  const say = (o: ReachableOption) => {
    const n = o.nightsAtGoal!;
    const keeps = planned !== null && n >= planned;
    return t(keeps ? 'today.note.keeps' : 'today.note.leaves', { place: placeName(o.gateway), when: o.day, nights: nightsWord(n), goal });
  };
  if (tonight && tonight.nightsAtGoal !== null && tomorrow && tomorrow.nightsAtGoal !== null) {
    const b = tomorrow.nightsAtGoal === tonight.nightsAtGoal
      ? t('today.note.tooTomorrow', { place: placeName(tomorrow.gateway) })
      : t('today.note.waiting', { place: placeName(tomorrow.gateway), n: tomorrow.nightsAtGoal });
    parts.push(`${say(tonight)}; ${b}.`);
  } else {
    const one = picks.find(o => o.nightsAtGoal !== null);
    if (one) parts.push(`${say(one)}.`);
  }
  if (!parts.length) return null;
  const text = parts.join(' ');
  return { text: text.charAt(0).toUpperCase() + text.slice(1), returnBroken };
}

export function recoverView(input: {
  trip: Trip; at: string | null; legId: string | null; nowMs: number; connect: ConnectOptions; fmt: TimeFormat;
}): RecoverView {
  const { nowMs, fmt } = input;
  const leg = recoverLeg(input.trip, input.at, input.legId);
  // Recovery heads for the place this leg is going to (an onward leg: its stop, not the first one).
  const trip: Trip = leg ? { ...input.trip, goal: stopForLeg(input.trip, leg) } : input.trip;
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
    subtitle: t('today.recover.subtitle', { at, time: formatClock(utcToLocal(nowMs, airportTz(at)).hhmm, fmt) }),
    goal: trip.goal.name,
    homeBy: `${weekdayShort(weekdayIndex(hb.dateKey))} ${formatClock(hb.hhmm, fmt)}`,
    legNote: leg ? (isFinalStatus(leg.status) ? t('today.legNote.marked', { flight: leg.refs[0].flightNumber, status: legStatusLabel(leg.status) }) : `${leg.refs[0].flightNumber} ${legStatusLabel(leg.status)}`) : null,
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
