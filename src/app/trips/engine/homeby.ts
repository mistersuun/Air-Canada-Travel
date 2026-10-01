/**
 * Home-by deadline and the miss-one chain (spec §2.4). Pure.
 *
 * A "try" is one distinct first departure from the gateway on a date that
 * still gets home by the deadline: a direct flight, or a first leg to a
 * Canadian hub plus the EARLIEST onward flight that respects minConnect
 * (dropped when even that lands after the deadline). Only published flights
 * count (an estimated hub leg is never a try). Facts only: counts and times,
 * never odds.
 */
import { HUBS } from '../../data/destinations';
import { isCovered } from '../../data/schedule-index';
import { airportTz } from '../../utils/airports';
import {
  ConnectOptions, DEFAULT_MAX_LAYOVER, DEFAULT_MIN_CONNECT, Itinerary, OVERNIGHT_MAX_LAYOVER, compareItineraries,
  directItinerary, hasSegment, segmentFlights,
} from '../../utils/connections';
import { MINUTE_MS, addDays, diffDays, toUtcMs } from '../../utils/time';
import { coverageHubFor, type FlightInstance } from '../../utils/week';
import { buildItinerary } from './legs';

export const MISS_GAP_MIN = 30;   // a later try must leave ≥ 30 min after the previous try's departure
/** How many days past the deadline nextAfterDeadline searches. */
export const AFTER_DEADLINE_DAYS = 7;
/** homeByPlan never spans more than this many days. */
export const MAX_PLAN_DAYS = 21;

export interface Try {
  index: number;                  // 1-based within the day
  itinerary: Itinerary;           // direct or one-stop from the gateway to home
  standbyLegs: number;            // itinerary.legs.length
  slackMin: number;               // deadline − arrival
}
export interface DayTries { dateKey: string; tries: Try[] }
export interface HomeByPlan {
  deadlineUtc: number;
  days: DayTries[];               // from `fromKey` to the deadline date
  nextAfterDeadline: Itinerary | null;  // first option that lands after the deadline (searched up to 7 days past it)
  covered: boolean;               // false if any day is outside coverage → show "Unknown"
}
export interface MissStep { label: string; itinerary: Itinerary | null; kind: 'try' | 'fallback' | 'late'; slackMin: number | null }

/** The deadline instant: wall-clock `hhmm` on `dateKey` at the home airport. */
export function deadlineUtc(homeBy: { dateKey: string; hhmm: string }, homeAirport: string): number {
  return toUtcMs(homeBy.dateKey, homeBy.hhmm, airportTz(homeAirport));
}

/**
 * Every way from → home leaving on `dateKey`: each direct flight, and for each
 * first leg to a hub the earliest onward flight that respects minConnect
 * (and the layover limits). One per distinct first departure, sorted by
 * departure. Not filtered by any deadline.
 */
export function departuresHome(from: string, home: string, dateKey: string, opts: ConnectOptions): Itinerary[] {
  if (from === home) return [];
  const minConnect = opts.minConnect ?? DEFAULT_MIN_CONNECT;
  const maxLayover = opts.maxLayover ?? DEFAULT_MAX_LAYOVER;
  const overnight = opts.allowOvernight ?? false;
  const avoid = new Set(opts.avoidHubs ?? []);
  const via = new Set(opts.viaHubs ?? []);

  const out: Itinerary[] = segmentFlights(from, home, dateKey).filter(f => !f.estimated).map(directItinerary);
  for (const { code: hub } of HUBS) {
    if (hub === from || hub === home || avoid.has(hub) || (via.size && !via.has(hub))) continue;
    if (!hasSegment(hub, home)) continue;
    for (const l1 of segmentFlights(from, hub, dateKey)) {
      if (l1.estimated) continue;
      const onwardDays = overnight ? [l1.arrDateKey, addDays(l1.arrDateKey, 1)] : [l1.arrDateKey];
      let best: FlightInstance | null = null;
      for (const d of onwardDays) {
        for (const l2 of segmentFlights(hub, home, d)) {
          if (l2.estimated) continue;
          const lay = (l2.depUtc - l1.arrUtc) / MINUTE_MS;
          if (lay < minConnect) continue;
          const isOvernight = l2.dateKey !== l1.arrDateKey;
          const max = isOvernight ? Math.max(maxLayover, OVERNIGHT_MAX_LAYOVER) : maxLayover;
          if (lay > max) continue;
          if (!best || l2.depUtc < best.depUtc) best = l2;
        }
      }
      if (best) out.push(buildItinerary([l1, best]));
    }
  }
  return dedupeByFirstLeg(out);
}

/** One itinerary per first-leg flight (number + departure), the earliest arrival; sorted by departure. */
function dedupeByFirstLeg(list: Itinerary[]): Itinerary[] {
  const byFirst = new Map<string, Itinerary>();
  for (const it of list) {
    const f = it.legs[0];
    const key = `${f.flightNumber ?? 'EST'}|${f.depUtc}`;
    const cur = byFirst.get(key);
    if (!cur || compareItineraries(it, cur) < 0) byFirst.set(key, it);
  }
  return [...byFirst.values()].sort((a, b) => a.departUtc - b.departUtc || a.arriveUtc - b.arriveUtc);
}

/** The tries on one date that land home by the deadline, sorted by departure. */
export function triesOnDay(from: string, home: string, dateKey: string, deadline: number, opts: ConnectOptions): Try[] {
  return departuresHome(from, home, dateKey, opts)
    .filter(it => it.arriveUtc <= deadline)
    .map((itinerary, i) => ({
      index: i + 1,
      itinerary,
      standbyLegs: itinerary.legs.length,
      slackMin: Math.round((deadline - itinerary.arriveUtc) / MINUTE_MS),
    }));
}

/** Tries per day from `fromKey` to the deadline date, and the first option after it. */
export function homeByPlan(
  from: string,
  home: string,
  homeBy: { dateKey: string; hhmm: string },
  fromKey: string,
  opts: ConnectOptions,
): HomeByPlan {
  const deadline = deadlineUtc(homeBy, home);
  const hub = coverageHubFor(from, home) ?? home;
  const days: DayTries[] = [];
  let covered = true;
  const span = Math.min(diffDays(fromKey, homeBy.dateKey), MAX_PLAN_DAYS - 1);
  for (let i = 0; i <= span; i++) {
    const k = addDays(fromKey, i);
    if (!isCovered(k, hub)) covered = false;
    days.push({ dateKey: k, tries: triesOnDay(from, home, k, deadline, opts) });
  }
  let nextAfterDeadline: Itinerary | null = null;
  for (let i = 0; i <= AFTER_DEADLINE_DAYS && !nextAfterDeadline; i++) {
    const k = addDays(homeBy.dateKey, i);
    if (k < fromKey) continue;
    const late = departuresHome(from, home, k, opts).filter(it => it.arriveUtc > deadline);
    if (late.length) nextAfterDeadline = [...late].sort(compareItineraries)[0];
  }
  return { deadlineUtc: deadline, days, nextAfterDeadline, covered };
}

/** Number of tries on startKey..the deadline date. */
export function triesFrom(plan: HomeByPlan, startKey: string): number {
  return plan.days.filter(d => d.dateKey >= startKey).reduce((n, d) => n + d.tries.length, 0);
}

/** '8h', '1h30', '45m': the spare time before the deadline. */
export function spareLabel(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * The miss-one chain for a date: Try 1, then each later try leaving at least
 * MISS_GAP_MIN after the previous one ("If you miss it"), then the first
 * option after the deadline ("If you miss both"). No tries → one late step.
 */
export function missOneChain(plan: HomeByPlan, dateKey: string): MissStep[] {
  const tries = plan.days.find(d => d.dateKey === dateKey)?.tries ?? [];
  const steps: MissStep[] = [];
  let prevDep = -Infinity;
  for (const t of tries) {
    if (steps.length && t.itinerary.departUtc - prevDep < MISS_GAP_MIN * MINUTE_MS) continue;
    const first = !steps.length;
    steps.push({
      label: first ? 'Try 1' : 'If you miss it',
      itinerary: t.itinerary,
      kind: first ? 'try' : 'fallback',
      slackMin: t.slackMin,
    });
    prevDep = t.itinerary.departUtc;
  }
  const n = steps.length;
  steps.push({
    label: n === 0 ? 'No try found before your deadline' : n === 1 ? 'If you miss it' : n === 2 ? 'If you miss both' : 'If you miss them all',
    itinerary: plan.nextAfterDeadline,
    kind: 'late',
    slackMin: null,
  });
  return steps;
}
