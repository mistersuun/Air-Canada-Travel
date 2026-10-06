/**
 * The travel-day timeline on /today: each flight's departure and arrival
 * (local times, time difference vs home), the layovers between segments, the
 * onward ground ride and the final row (home-by deadline on a return day, the
 * goal when nothing else flies first, else the next flight). Pure and clock
 * free: markPast() dims rows against `nowMs` separately. Every time comes from
 * the saved trip, the installed schedules and the ground timetables. Facts
 * and counts only, never odds.
 */
import { airportTz } from '../../utils/airports';
import { DEFAULT_MIN_CONNECT, LONG_LAYOVER, isLayoverAlert } from '../../utils/connections';
import { MINUTE_MS, formatClock, hhmmToMin, minToHhmm, toUtcMs, utcToLocal } from '../../utils/time';
import { hm, tzDiffLabel } from '../../ui/format';
import type { TimeFormat } from '../../state/prefs.service';
import { airportEnd, arrivalAtGoal, groundEstimate, type GroundEstimate } from '../../places/ground';
import { departuresOn } from '../../places/timetable';
import { deadlineUtc, spareLabel } from '../../trips/engine/homeby';
import { endTz, refArrUtc, refDepUtc } from '../../trips/engine/legs';
import { placeName } from '../../trips/engine/today';
import type { FlightLeg, GroundLeg, Trip, TripLeg } from '../../trips/model';
import { dayLabel } from './today-model';

export type TimelineKind = 'depart' | 'arrive' | 'layover' | 'ground' | 'final' | 'next';

export interface TimelineRow {
  id: string;
  kind: TimelineKind;
  /** Local clock ('17:55'); null for rows with no single time. */
  time: string | null;
  title: string;
  detail: string | null;
  /** The instant the row happens; drives dimming. */
  atUtc: number | null;
  /** A layover that is tight, long or impossible (see isLayoverAlert). */
  alert: boolean;
}

export type TimelineRowView = TimelineRow & { past: boolean };

const MODE_WORD: Record<string, string> = {
  train: 'Train', bus: 'Bus', car: 'Car', ferry: 'Ferry', flight: 'Flight', other: 'Transfer',
};

function row(r: Omit<TimelineRow, 'alert'> & { alert?: boolean }): TimelineRow {
  return { ...r, alert: r.alert ?? false };
}

/** Rows already behind the clock are marked past. */
export function markPast(rows: readonly TimelineRow[], nowMs: number): TimelineRowView[] {
  return rows.map(r => ({ ...r, past: r.atUtc !== null && r.atUtc < nowMs }));
}

/** '+6h vs Montréal' or '' when the arrival airport is on home time. */
function diffVsHome(trip: Trip, dest: string, atUtc: number): string {
  const diff = tzDiffLabel(airportTz(dest), airportTz(trip.homeAirport), atUtc);
  return diff === '0h' ? '' : `${diff} vs ${placeName(trip.homeAirport)}`;
}

interface Onward {
  rows: TimelineRow[];
  /** Reach-the-goal row, when the ride ends there. */
  reach: TimelineRow | null;
}

/** The ride after landing, from the trip's own ground leg (saved times first, else its estimate) or, with none, an estimate to the goal. */
function onward(trip: Trip, last: FlightLeg['refs'][number], ground: GroundLeg | null, fmt: TimeFormat): Onward | null {
  const landUtc = refArrUtc(last);
  const goalTz = trip.goal.tz ?? airportTz(last.dest);
  const reachRow = (utc: number, note: string, overnight = false): TimelineRow => {
    // A ground leg that does not end at the goal is reached under its own name and time zone.
    const at = utcToLocal(utc, ground ? endTz(ground.to) ?? goalTz : goalTz);
    return row({
      id: 'final', kind: 'final', time: formatClock(at.hhmm, fmt), title: `Reach ${ground ? ground.to.name : trip.goal.name}`,
      detail: `${dayLabel(at.dateKey)} · ${overnight ? 'overnight likely · ' : ''}${note}`, atUtc: utc,
    });
  };

  if (ground?.userTimes) {
    const t = ground.userTimes;
    const depUtc = toUtcMs(t.depDateKey, t.depLocal, endTz(ground.from) ?? 'UTC');
    const arrUtc = toUtcMs(t.arrDateKey, t.arrLocal, endTz(ground.to) ?? endTz(ground.from) ?? 'UTC');
    return {
      rows: [row({
        id: 'ground', kind: 'ground', time: formatClock(t.depLocal, fmt),
        title: `${MODE_WORD[ground.mode] ?? 'Transfer'} ${ground.from.name} → ${ground.to.name}`,
        detail: `${dayLabel(t.depDateKey)} · saved by you · arrives ${formatClock(t.arrLocal, fmt)}`, atUtc: depUtc,
      })],
      reach: reachRow(arrUtc, 'saved by you'),
    };
  }

  let g: GroundEstimate;
  let modeWord: string;
  let from: string;
  let to: string;
  if (ground) {
    g = groundEstimate(ground.from, ground.to, { dateKey: last.arrDateKey });
    modeWord = MODE_WORD[ground.mode] ?? 'Transfer';
    from = ground.from.name;
    to = ground.to.name;
  } else {
    const end = airportEnd(last.dest);
    if (!end) return null;
    g = groundEstimate(end, trip.goal, { dateKey: last.arrDateKey });
    if (g.mode === 'unknown' || g.rideMin === null) return null;
    modeWord = MODE_WORD[g.mode] ?? 'Transfer';
    from = placeName(last.dest);
    to = trip.goal.name;
  }

  const arr = g.rideMin !== null ? arrivalAtGoal(landUtc, g, airportTz(last.dest)) : null;
  const readyUtc = landUtc + g.exitMin * MINUTE_MS;
  const parts: string[] = [];
  let atUtc = readyUtc;
  if (g.timetable) {
    const dir = g.timetable.dir;
    const ready = utcToLocal(readyUtc, dir.tz);
    const readyMin = hhmmToMin(ready.hhmm);
    const today = (departuresOn(dir, ready.dateKey) ?? []).filter(d => d.depMin >= readyMin).slice(0, 2);
    if (today.length) parts.push(`next ${today.map(d => formatClock(minToHhmm(d.depMin), fmt)).join(', ')}`);
    else if (arr?.departure) parts.push(`next ${dayLabel(arr.departure.dateKey)} ${formatClock(arr.departure.hhmm, fmt)}`);
    else if (arr?.noService) parts.push('nothing running in the timetable');
    else parts.push(g.label);
    if (arr?.departure) atUtc = toUtcMs(arr.departure.dateKey, arr.departure.hhmm, dir.tz);
    else if (today.length) atUtc = toUtcMs(ready.dateKey, minToHhmm(today[0].depMin), dir.tz);
  } else {
    parts.push(g.label);
  }
  if (arr?.lastDepMissed) parts.push('last one likely gone');
  const scheduled = !!arr?.departure;
  // The trip's own leg carries its estimate; the estimator only adds timetable hints.
  const estMin = ground ? ground.estMinutes : g.totalMin;
  const goalUtc = scheduled && arr?.utc != null ? arr.utc : estMin != null ? landUtc + estMin * MINUTE_MS : arr?.utc ?? null;
  const groundRow = row({
    id: 'ground', kind: 'ground', time: null, title: `${modeWord} ${from} → ${to}`, detail: parts.join(' · ') || null, atUtc,
  });
  return { rows: [groundRow], reach: goalUtc !== null ? reachRow(goalUtc, scheduled ? 'scheduled' : 'estimated', !!arr?.overnightLikely && !ground) : null };
}

/** Flights to count as "flying on": departing `from` within a day of landing (`landUtc`), if given. */
const FLY_ON_MAX_MIN = 24 * 60;

/** The next flight leg after `idx` that leaves `from` (a return flight leaves the goal, so it does not count). */
function laterFlight(trip: Trip, idx: number, from: string, landUtc: number | null): { leg: FlightLeg; at: number } | null {
  for (let i = idx + 1; i < trip.legs.length; i++) {
    const l = trip.legs[i];
    if (l.kind !== 'flight' || l.role === 'return' || !l.refs.length || l.status === 'abandoned' || l.status === 'notBoarded') continue;
    if (l.refs[0].origin !== from) continue;
    if (landUtc !== null && refDepUtc(l.refs[0]) - landUtc > FLY_ON_MAX_MIN * MINUTE_MS) continue;
    return { leg: l, at: i };
  }
  return null;
}

function nextFlightRow(l: FlightLeg, fmt: TimeFormat): TimelineRow {
  const r = l.refs[0];
  return row({
    id: 'next', kind: 'next', time: formatClock(r.depLocal, fmt), title: `Next: ${r.flightNumber} ${r.origin} → ${l.refs[l.refs.length - 1].dest}`,
    detail: `${dayLabel(r.dateKey)} · ${r.origin} time`, atUtc: refDepUtc(r),
  });
}

/**
 * Rows for the active travel day, in order: per flight segment departure,
 * arrival and (between segments) the layover, then the onward ground ride and
 * the final row. Returns [] when the leg is not a flight leg.
 */
export function travelTimeline(input: { trip: Trip; leg: TripLeg | undefined; fmt: TimeFormat; minConnect?: number }): TimelineRow[] {
  const { trip, leg, fmt } = input;
  if (!leg || leg.kind !== 'flight' || !leg.refs.length) return [];
  const minConnect = input.minConnect ?? DEFAULT_MIN_CONNECT;
  const rows: TimelineRow[] = [];

  leg.refs.forEach((ref, i) => {
    const arrUtc = refArrUtc(ref);
    rows.push(row({
      id: `dep:${i}`, kind: 'depart', time: formatClock(ref.depLocal, fmt),
      title: `${ref.flightNumber} departs ${placeName(ref.origin)} (${ref.origin})`,
      detail: `${dayLabel(ref.dateKey)} · ${ref.origin} time`, atUtc: refDepUtc(ref),
    }));
    const diff = diffVsHome(trip, ref.dest, arrUtc);
    const nextDay = ref.arrDateKey !== ref.dateKey ? dayLabel(ref.arrDateKey) : null;
    rows.push(row({
      id: `arr:${i}`, kind: 'arrive', time: formatClock(ref.arrLocal, fmt),
      title: `Arrives ${placeName(ref.dest)} (${ref.dest})`,
      detail: [nextDay, `${ref.dest} time`, diff].filter(Boolean).join(' · '), atUtc: arrUtc,
    }));
    const next = leg.refs[i + 1];
    if (next) {
      const min = Math.round((refDepUtc(next) - arrUtc) / MINUTE_MS);
      const alert = isLayoverAlert(min, minConnect);
      const reason = min < 0 ? 'Next flight leaves before this one lands'
        : min < minConnect ? 'Tight connection' : min > LONG_LAYOVER ? 'Long wait' : null;
      rows.push(row({
        id: `lay:${i}`, kind: 'layover', time: null,
        title: min < 0 ? `Layover at ${ref.dest}` : `Layover at ${ref.dest} · ${hm(min)}`,
        detail: alert ? reason : null, atUtc: refDepUtc(next), alert,
      }));
    }
  });

  const last = leg.refs[leg.refs.length - 1];
  const landUtc = refArrUtc(last);
  if (leg.role === 'return') {
    const deadline = deadlineUtc(trip.homeBy, trip.homeAirport);
    const slack = Math.round((deadline - landUtc) / MINUTE_MS);
    const atHome = last.dest === trip.homeAirport;
    const spare = atHome
      ? (slack >= 0 ? `${spareLabel(slack)} after landing` : `landing ${spareLabel(-slack)} after it`)
      : `landing at ${last.dest}, ${spareLabel(Math.abs(slack))} ${slack >= 0 ? 'before' : 'after'} your ${trip.homeAirport} deadline`;
    rows.push(row({
      id: 'final', kind: 'final', time: formatClock(trip.homeBy.hhmm, fmt),
      title: `Home by ${dayLabel(trip.homeBy.dateKey)}`, detail: `${trip.homeAirport} time · ${spare}`, atUtc: deadline,
    }));
    return rows;
  }

  const idx = trip.legs.findIndex(l => l.id === leg.id);
  const flight = laterFlight(trip, idx, last.dest, landUtc);
  const groundIdx = trip.legs.findIndex((l, i) => i > idx && l.kind === 'ground' && l.from.code === last.dest && l.status !== 'abandoned');
  const ground = groundIdx >= 0 ? trip.legs[groundIdx] as GroundLeg : null;

  if (leg.role === 'positioning') {
    if (flight) rows.push(nextFlightRow(flight.leg, fmt));
    return rows;
  }
  // A flight that comes before the ride (or with no ride) means the traveller flies on first.
  if (flight && (!ground || flight.at < groundIdx)) {
    rows.push(nextFlightRow(flight.leg, fmt));
    return rows;
  }
  const ride = onward(trip, last, ground, fmt);
  if (ride) rows.push(...ride.rows);
  // After the ride, a flight from where it ends means the traveller flies on rather than reaching the goal.
  const viaGround = ground?.to.code ? laterFlight(trip, groundIdx, ground.to.code, null) : null;
  if (viaGround) {
    rows.push(nextFlightRow(viaGround.leg, fmt));
  } else if (ride?.reach) {
    rows.push(ride.reach);
  } else if (!ride) {
    rows.push(row({
      id: 'final', kind: 'final', time: null, title: `Onward to ${trip.goal.name}`,
      detail: 'Onward ride not found in our data', atUtc: landUtc,
    }));
  }
  return rows;
}
