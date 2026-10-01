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
import { MINUTE_MS, WEEKDAY_LONG, WEEKDAY_SHORT, addDays, diffDays, formatClock, formatKey, utcToLocal, weekdayIndex } from '../../utils/time';
import { MISS_GAP_MIN, departuresHome } from '../../trips/engine/homeby';
import { hm, supOffset } from '../../ui/format';
import type { TimeFormat } from '../../state/prefs.service';
import { airportEnd, arrivalAtGoal, groundEstimate, type GroundEstimate } from '../../places/ground';
import { legPrepItems, type PrepItem } from '../../places/prep';
import { partOfDay } from '../reach/reach-model';
import { shortAircraftName } from '../../trips/engine/facts';
import { legStartUtc, refArrUtc, refDepUtc } from '../../trips/engine/legs';
import { type ReachableOption, legDepartureKey, leavesGoalArea, missOneOutbound, stillReachable } from '../../trips/engine/recover';
import { activeTravelDay, placeName } from '../../trips/engine/today';
import {
  type FlightLeg, type FlightRef, type LegStatus, type LoadNote, type Outcome, type Trip, type TripLeg,
  LEG_STATUS_LABEL, instanceKey, isFinalStatus,
} from '../../trips/model';

// ── Shared formatting ─────────────────────────────────────────────────────────

/** 'Thu Oct 8'. */
export function dayLabel(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** 'leaves in 1h15', 'leaves now', 'left 25m ago'. */
export function leavesLabel(depUtc: number, nowMs: number): string {
  const min = Math.round((depUtc - nowMs) / 60_000);
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
    detail: `${ref.flightNumber} ${formatClock(ref.depLocal, fmt)} · ${LEG_STATUS_LABEL[leg.status]}`,
  };
}

// ── /today ────────────────────────────────────────────────────────────────────

export interface TodayBackup { title: string; detail: string }

export interface TodayView {
  tripId: string;
  legId: string;
  eyebrow: string;          // 'Today · Thu Oct 8 · at YUL'
  title: string;            // 'Montréal → Madrid'
  time: string;             // '17:55'
  status: LegStatus;
  /** Where the times come from: Scheduled, or Unknown when the flight was not found in the latest data. */
  provenance: FlightLeg['provenance'];
  final: boolean;
  /** A return leg: recovery means the next way home (the Return tab), not the goal. */
  isReturn: boolean;
  sub: string;              // 'AC834 · A330-300 · leaves in 1h15'
  then: string | null;      // one-stop: 'then AC824 YYZ 19:15'
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
  const next = leg.refs[seg + 1] ?? null;
  const final = isFinalStatus(leg.status);
  const departed = refDepUtc(ref) < nowMs;

  const subParts = [ref.flightNumber];
  if (ref.aircraft) subParts.push(shortAircraftName(ref.aircraft));
  if (!final) subParts.push(leavesLabel(refDepUtc(ref), nowMs));

  const notes = input.notes
    .filter(n => instanceKey(n) === instanceKey(ref) && noteText(n))
    .sort((a, b) => b.at.localeCompare(a.at));
  const note = notes[0] ? { time: clockAt(notes[0].at, airportTz(ref.origin), fmt), text: noteText(notes[0]) } : null;

  return {
    tripId: trip.id,
    legId: leg.id,
    eyebrow: `Today · ${dayLabel(ref.dateKey)} · at ${ref.origin}`,
    title: `${placeName(ref.origin)} → ${placeName(last.dest)}`,
    time: formatClock(ref.depLocal, fmt),
    status: leg.status,
    provenance: leg.provenance,
    final,
    isReturn: leg.role === 'return',
    sub: subParts.join(' · '),
    then: next ? `then ${next.flightNumber} ${next.origin} ${formatClock(next.depLocal, fmt)}` : null,
    ref,
    note,
    // Listing and check-in can't be done once the flight has left: the outcome question replaces them.
    left: final ? [] : legPrepItems(trip, leg.id).filter(item => !(departed && /^(list|checkin):/.test(item.id))),
    backup: final || seg > 0 ? null : todayBackup(trip, leg, input.connect, fmt),
  };
}

/** The leg status a "Left to do" tick (or untick) sets; null when the item is not a status item. */
export function statusForTick(item: PrepItem, current: LegStatus): LegStatus | null {
  if (item.id.startsWith('list:')) return item.done ? 'planned' : current === 'planned' ? 'listed' : current;
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
  const g: GroundEstimate = groundEstimate(end, trip.goal);
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
  };
}
