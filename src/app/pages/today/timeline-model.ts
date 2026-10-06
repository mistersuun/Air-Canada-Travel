/**
 * The travel-day timeline on /today: the leg's own to-dos, each flight's
 * departure and arrival (local times, time difference vs home), the layovers
 * between segments, the onward ground ride and the final row (home-by
 * deadline on a return day, else the goal). Pure: the clock is passed in and
 * every time comes from the saved trip, the installed schedules and the
 * ground timetables. Facts and counts only, never odds.
 */
import { airportTz } from '../../utils/airports';
import { DEFAULT_MIN_CONNECT } from '../../utils/connections';
import { MINUTE_MS, formatClock, hhmmToMin, minToHhmm, utcToLocal } from '../../utils/time';
import { hm, tzDiffLabel } from '../../ui/format';
import type { TimeFormat } from '../../state/prefs.service';
import { airportEnd, arrivalAtGoal, groundEstimate, type GroundEstimate } from '../../places/ground';
import { departuresOn } from '../../places/timetable';
import type { PrepItem } from '../../places/prep';
import { deadlineUtc, spareLabel } from '../../trips/engine/homeby';
import { refArrUtc, refDepUtc } from '../../trips/engine/legs';
import { placeName } from '../../trips/engine/today';
import type { FlightLeg, Trip } from '../../trips/model';
import { dayLabel } from './today-model';

export type TimelineKind = 'prep' | 'depart' | 'arrive' | 'layover' | 'ground' | 'final';

export interface TimelineRow {
  id: string;
  kind: TimelineKind;
  /** Local clock ('17:55'); null for rows with no single time (to-dos, layovers). */
  time: string | null;
  title: string;
  detail: string | null;
  /** The instant the row happens (null for to-dos); drives dimming. */
  atUtc: number | null;
  /** Already behind the clock. */
  past: boolean;
  /** Layover shorter than the traveller's minimum connection time. */
  tight: boolean;
}

const MODE_WORD: Record<string, string> = {
  train: 'Train', bus: 'Bus', car: 'Car', ferry: 'Ferry', flight: 'Flight', other: 'Transfer',
};

function row(r: Omit<TimelineRow, 'past' | 'tight'> & { tight?: boolean }, nowMs: number): TimelineRow {
  return { ...r, tight: r.tight ?? false, past: r.atUtc !== null && r.atUtc < nowMs };
}

/** '+6h vs Montréal' or '' when the arrival airport is on home time. */
function diffVsHome(trip: Trip, dest: string, atUtc: number): string {
  const diff = tzDiffLabel(airportTz(dest), airportTz(trip.homeAirport), atUtc);
  return diff === '0h' ? '' : `${diff} vs ${placeName(trip.homeAirport)}`;
}

/** The ground row's wording: next departures when a timetable gives them, else the estimate. */
function groundRow(trip: Trip, leg: FlightLeg, nowMs: number, fmt: TimeFormat): { row: TimelineRow; goalUtc: number | null; overnight: boolean } | null {
  const last = leg.refs[leg.refs.length - 1];
  const end = airportEnd(last.dest);
  if (!end) return null;
  const g: GroundEstimate = groundEstimate(end, trip.goal, { dateKey: last.arrDateKey });
  if (g.mode === 'unknown' || g.rideMin === null) return null;
  const landUtc = refArrUtc(last);
  const arr = arrivalAtGoal(landUtc, g, airportTz(last.dest));
  const readyUtc = landUtc + g.exitMin * MINUTE_MS;
  const parts: string[] = [];
  if (g.timetable) {
    const ready = utcToLocal(readyUtc, g.timetable.dir.tz);
    const readyMin = hhmmToMin(ready.hhmm);
    const today = (departuresOn(g.timetable.dir, ready.dateKey) ?? []).filter(d => d.depMin >= readyMin).slice(0, 2);
    if (today.length) parts.push(`next ${today.map(d => formatClock(minToHhmm(d.depMin), fmt)).join(', ')}`);
    else if (arr.departure) parts.push(`next ${dayLabel(arr.departure.dateKey)} ${formatClock(arr.departure.hhmm, fmt)}`);
    else if (arr.noService) parts.push('nothing running in the timetable');
  } else {
    parts.push(g.label);
  }
  if (arr.lastDepMissed) parts.push('last one likely gone');
  return {
    row: row({
      id: 'ground', kind: 'ground', time: null,
      title: `${MODE_WORD[g.mode] ?? 'Transfer'} ${placeName(last.dest)} → ${trip.goal.name}`,
      detail: parts.join(' · ') || null, atUtc: readyUtc,
    }, nowMs),
    goalUtc: arr.utc,
    overnight: arr.overnightLikely,
  };
}

/**
 * Rows for the active travel day, in order: remaining to-dos, then per flight
 * segment departure, arrival and (between segments) the layover, then the
 * onward ground ride and the final row. `left` is the to-do list Today already
 * shows. Returns [] when the leg is not a flight leg.
 */
export function travelTimeline(input: {
  trip: Trip; leg: FlightLeg | undefined; left: readonly PrepItem[]; nowMs: number; fmt: TimeFormat; minConnect?: number;
}): TimelineRow[] {
  const { trip, leg, nowMs, fmt } = input;
  if (!leg || leg.kind !== 'flight' || !leg.refs.length) return [];
  const minConnect = input.minConnect ?? DEFAULT_MIN_CONNECT;
  const rows: TimelineRow[] = [];

  for (const item of input.left) {
    rows.push(row({ id: `prep:${item.id}`, kind: 'prep', time: null, title: item.title, detail: item.detail, atUtc: null }, nowMs));
  }

  leg.refs.forEach((ref, i) => {
    const arrUtc = refArrUtc(ref);
    rows.push(row({
      id: `dep:${i}`, kind: 'depart', time: formatClock(ref.depLocal, fmt),
      title: `${ref.flightNumber} departs ${placeName(ref.origin)} (${ref.origin})`,
      detail: `${dayLabel(ref.dateKey)} · ${ref.origin} time`, atUtc: refDepUtc(ref),
    }, nowMs));
    const diff = diffVsHome(trip, ref.dest, arrUtc);
    const nextDay = ref.arrDateKey !== ref.dateKey ? dayLabel(ref.arrDateKey) : null;
    rows.push(row({
      id: `arr:${i}`, kind: 'arrive', time: formatClock(ref.arrLocal, fmt),
      title: `Arrives ${placeName(ref.dest)} (${ref.dest})`,
      detail: [nextDay, `${ref.dest} time`, diff].filter(Boolean).join(' · '), atUtc: arrUtc,
    }, nowMs));
    const next = leg.refs[i + 1];
    if (next) {
      const min = Math.round((refDepUtc(next) - arrUtc) / MINUTE_MS);
      const tight = min < minConnect;
      rows.push(row({
        id: `lay:${i}`, kind: 'layover', time: null,
        title: `Layover at ${ref.dest} · ${hm(min)}`,
        detail: tight ? `Shorter than your ${minConnect} min minimum connection` : null,
        atUtc: refDepUtc(next), tight,
      }, nowMs));
    }
  });

  const last = leg.refs[leg.refs.length - 1];
  const landUtc = refArrUtc(last);
  if (leg.role === 'return') {
    const deadline = deadlineUtc(trip.homeBy, trip.homeAirport);
    const slack = Math.round((deadline - landUtc) / MINUTE_MS);
    const spare = slack >= 0 ? `${spareLabel(slack)} after landing` : `landing ${spareLabel(-slack)} after it`;
    rows.push(row({
      id: 'final', kind: 'final', time: formatClock(trip.homeBy.hhmm, fmt),
      title: `Home by ${dayLabel(trip.homeBy.dateKey)}`, detail: `${trip.homeAirport} time · ${spare}`, atUtc: deadline,
    }, nowMs));
    return rows;
  }

  const ground = groundRow(trip, leg, nowMs, fmt);
  if (ground) rows.push(ground.row);
  if (ground && ground.goalUtc !== null) {
    const at = utcToLocal(ground.goalUtc, trip.goal.tz ?? airportTz(last.dest));
    rows.push(row({
      id: 'final', kind: 'final', time: formatClock(at.hhmm, fmt),
      title: `Reach ${trip.goal.name}`,
      detail: `${dayLabel(at.dateKey)} · ${ground.overnight ? 'overnight likely · ' : ''}estimated`,
      atUtc: ground.goalUtc,
    }, nowMs));
  } else {
    rows.push(row({
      id: 'final', kind: 'final', time: null, title: `Onward to ${trip.goal.name}`,
      detail: 'Onward ride not found in our data', atUtc: landUtc,
    }, nowMs));
  }
  return rows;
}
