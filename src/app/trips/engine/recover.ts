/**
 * "What can I still reach?" after a missed flight (spec §2.5). Starts from
 * now, not from the scheduled departure: only options that are physically
 * still possible from where the traveller is. Options that left too early
 * are listed greyed with the reason. Facts only (times, counts), never odds.
 */
import { HUBS } from '../../data/destinations';
import { airportTz } from '../../utils/airports';
import {
  ConnectOptions, DEFAULT_MAX_LAYOVER, DEFAULT_MIN_CONNECT, Itinerary, OVERNIGHT_MAX_LAYOVER, directItinerary,
  hasSegment, segmentFlights,
} from '../../utils/connections';
import { greatCircleKm } from '../../utils/geo';
import { MINUTE_MS, addDays, diffDays, utcToLocal } from '../../utils/time';
import type { FlightInstance } from '../../utils/week';
import { GroundEstimate, airportEnd, arrivalAtGoal, groundEstimate, unknownGround } from '../../places/ground';
import { gatewaysNear } from '../../places/reach';
import { Trip, TripLeg, isFinalStatus } from '../model';
import { buildItinerary, legStartUtc, refDepUtc } from './legs';

export const BOARDING_CLOSED_MIN = 40;   // departures this soon (or sooner) from now are greyed "boarding has likely closed"
/** "Tonight" runs until this local time the next morning. */
export const TONIGHT_UNTIL = '06:00';
/** A leg starting within this distance of the goal "leaves the goal area". */
export const GOAL_AREA_KM = 50;

export type ReachStatus = 'usable' | 'closed' | 'missedConnection';
export interface ReachableOption {
  gateway: string; itinerary: Itinerary;
  status: ReachStatus; reason: string | null;     // 'boarding has likely closed' | 'AC489 lands 19:53, after AC824 leaves at 19:15'
  day: 'tonight' | 'tomorrow';
  ground: GroundEstimate; arriveGoalUtc: number | null;
  nightsAtGoal: number | null;                     // nights until the trip's first leg that leaves the goal area
  returnStillWorks: boolean | null;                // the trip's planned return legs still come after the arrival
}

export const CLOSED_REASON = 'boarding has likely closed';

interface Ctx {
  trip: Trip;
  at: string;
  nowMs: number;
  minConnect: number;
  maxLayover: number;
  overnight: boolean;
  hubs: string[];
}

/** The gateway the trip currently flies into: the last open outbound leg's destination. */
export function currentGateway(trip: Trip): string | null {
  const legs = trip.legs.filter(l => l.kind === 'flight' && l.role !== 'return');
  const open = legs.find(l => !isFinalStatus(l.status)) ?? legs[legs.length - 1];
  if (!open || open.kind !== 'flight' || !open.refs.length) return null;
  return open.refs[open.refs.length - 1].dest;
}

function defaultGateways(trip: Trip, at: string): string[] {
  const set = new Set<string>();
  if (trip.goal.acCode) set.add(trip.goal.acCode);
  for (const g of gatewaysNear(trip.goal)) set.add(g.code);
  const cur = currentGateway(trip);
  if (cur) set.add(cur);
  set.delete(at);
  return [...set];
}

/** Published flights only: an invented hub leg is never a way to recover. */
function published(from: string, to: string, dateKey: string): FlightInstance[] {
  return segmentFlights(from, to, dateKey).filter(f => !f.estimated);
}

/** Every first departure from `at` → gateway on `dateKey`: directs, and one-stops with the earliest onward leg. */
function optionsOn(ctx: Ctx, gateway: string, dateKey: string): Itinerary[] {
  const out = published(ctx.at, gateway, dateKey).map(directItinerary);
  for (const hub of ctx.hubs) {
    if (hub === gateway || !hasSegment(hub, gateway)) continue;
    for (const l1 of published(ctx.at, hub, dateKey)) {
      const days = ctx.overnight ? [l1.arrDateKey, addDays(l1.arrDateKey, 1)] : [l1.arrDateKey];
      let best: FlightInstance | null = null;
      for (const d of days) {
        for (const l2 of published(hub, gateway, d)) {
          const lay = (l2.depUtc - l1.arrUtc) / MINUTE_MS;
          if (lay < ctx.minConnect) continue;
          const max = l2.dateKey !== l1.arrDateKey ? Math.max(ctx.maxLayover, OVERNIGHT_MAX_LAYOVER) : ctx.maxLayover;
          if (lay > max) continue;
          if (!best || l2.depUtc < best.depUtc) best = l2;
        }
      }
      if (best) out.push(buildItinerary([l1, best]));
    }
  }
  return out;
}

function groundFor(trip: Trip, gateway: string): GroundEstimate {
  const end = airportEnd(gateway);
  return end ? groundEstimate(end, trip.goal) : unknownGround();
}

function leavesGoalArea(trip: Trip, leg: TripLeg): boolean {
  if (isFinalStatus(leg.status)) return false;
  if (leg.kind === 'ground') return greatCircleKm(leg.from, trip.goal) <= GOAL_AREA_KM;
  return leg.role === 'return';
}

function legDepartureKey(leg: TripLeg): string {
  if (leg.kind === 'ground') return leg.userTimes?.depDateKey ?? leg.dateKey;
  return leg.refs[0].dateKey;
}

/** Fills ground, arrival at the goal, nights and whether the return still works. */
function decorate(
  ctx: Ctx, gateway: string, itinerary: Itinerary, status: ReachStatus, reason: string | null, day: ReachableOption['day'],
  ground: GroundEstimate,
): ReachableOption {
  const arr = arrivalAtGoal(itinerary.arriveUtc, ground, airportTz(gateway));
  const arriveGoalUtc = arr.utc;
  const goalTz = ctx.trip.goal.tz ?? airportTz(gateway);

  let nightsAtGoal: number | null = null;
  if (arriveGoalUtc !== null) {
    const leave = ctx.trip.legs.find(l => leavesGoalArea(ctx.trip, l) && legStartUtc(l) > arriveGoalUtc);
    if (leave) nightsAtGoal = Math.max(0, diffDays(utcToLocal(arriveGoalUtc, goalTz).dateKey, legDepartureKey(leave)));
  }

  const returns = ctx.trip.legs.filter(l => l.kind === 'flight' && l.role === 'return' && !isFinalStatus(l.status));
  let returnStillWorks: boolean | null = null;
  if (returns.length) {
    const reach = arriveGoalUtc ?? itinerary.arriveUtc;
    returnStillWorks = returns.every(l => l.kind === 'flight' && l.refs.length > 0 && refDepUtc(l.refs[0]) > reach);
  }
  return { gateway, itinerary, status, reason, day, ground, arriveGoalUtc, nightsAtGoal, returnStillWorks };
}

function byArrival(a: ReachableOption, b: ReachableOption): number {
  const ag = a.arriveGoalUtc ?? Number.MAX_SAFE_INTEGER;
  const bg = b.arriveGoalUtc ?? Number.MAX_SAFE_INTEGER;
  return ag - bg || (a.ground.totalMin ?? 1e9) - (b.ground.totalMin ?? 1e9) || a.itinerary.arriveUtc - b.itinerary.arriveUtc;
}

const STATUS_RANK: Record<ReachStatus, number> = { usable: 0, closed: 1, missedConnection: 2 };

function sortGroup(list: ReachableOption[]): ReachableOption[] {
  return list.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byArrival(a, b));
}

function shape(it: Itinerary): string {
  return it.hubs.join('>');
}

/**
 * What is still reachable from `at`, starting now:
 * - tonight: departures on today's local date (or before 06:00 tomorrow),
 *   direct or one-stop via a Canadian hub, one per gateway and route shape;
 *   those leaving within BOARDING_CLOSED_MIN are `closed`; a hub whose next
 *   feeder lands too late for its onward flight is a `missedConnection`
 *   (only when no usable option via that hub exists for the gateway);
 * - tomorrow: the earliest option per gateway the next local day, direct preferred.
 * Within each group: usable (by arrival at the goal), then closed, then missed.
 */
export function stillReachable(input: {
  trip: Trip; at: string /* airport code */; nowMs: number; connect: ConnectOptions;
  gateways?: string[];
}): { tonight: ReachableOption[]; tomorrow: ReachableOption[] } {
  const { trip, at, nowMs, connect } = input;
  const avoid = new Set(connect.avoidHubs ?? []);
  const via = new Set(connect.viaHubs ?? []);
  const ctx: Ctx = {
    trip, at, nowMs,
    minConnect: connect.minConnect ?? DEFAULT_MIN_CONNECT,
    maxLayover: connect.maxLayover ?? DEFAULT_MAX_LAYOVER,
    overnight: connect.allowOvernight ?? false,
    hubs: HUBS.map(h => h.code).filter(h => h !== at && !avoid.has(h) && (!via.size || via.has(h))),
  };
  const today = utcToLocal(nowMs, airportTz(at)).dateKey;
  const tomorrowKey = addDays(today, 1);
  const closedBefore = nowMs + BOARDING_CLOSED_MIN * MINUTE_MS;
  const gateways = (input.gateways ?? defaultGateways(trip, at)).filter(g => g !== at);

  const tonight: ReachableOption[] = [];
  const tomorrow: ReachableOption[] = [];
  for (const gateway of gateways) {
    const ground = groundFor(trip, gateway);
    if (ground.mode === 'unknown' && gateway !== trip.goal.acCode && gateway !== currentGateway(trip)) continue;

    // ── Tonight ──
    const tonightIts = [
      ...optionsOn(ctx, gateway, today),
      ...optionsOn(ctx, gateway, tomorrowKey).filter(it => it.legs[0].depLocal < TONIGHT_UNTIL),
    ].filter(it => it.departUtc > nowMs);
    const byShape = new Map<string, Itinerary>();
    for (const it of tonightIts) {
      const k = shape(it);
      const cur = byShape.get(k);
      const usable = it.departUtc > closedBefore;
      const curUsable = cur ? cur.departUtc > closedBefore : false;
      if (!cur || (usable && !curUsable) || (usable === curUsable && it.arriveUtc < cur.arriveUtc)) byShape.set(k, it);
    }
    const direct = byShape.get('');
    const directUsableArr = direct && direct.departUtc > closedBefore ? direct.arriveUtc : null;
    const gwOptions: ReachableOption[] = [];
    for (const [k, it] of byShape) {
      const usable = it.departUtc > closedBefore;
      // A one-stop that lands after a usable direct to the same gateway adds nothing.
      if (k && directUsableArr !== null && (!usable || it.arriveUtc >= directUsableArr)) continue;
      gwOptions.push(decorate(ctx, gateway, it, usable ? 'usable' : 'closed', usable ? null : CLOSED_REASON, 'tonight', ground));
    }

    // Missed connections: the next feeder to a hub lands after the hub's last onward flight that day.
    for (const hub of ctx.hubs) {
      if (hub === gateway || (byShape.has(hub) && byShape.get(hub)!.departUtc > closedBefore)) continue;
      if (directUsableArr !== null) continue;
      const feeder = [...published(at, hub, today), ...published(at, hub, tomorrowKey).filter(f => f.depLocal < TONIGHT_UNTIL)]
        .find(f => f.depUtc > nowMs);
      if (!feeder) continue;
      const onward = published(hub, gateway, feeder.arrDateKey);
      if (!onward.length) continue;
      const ready = feeder.arrUtc + ctx.minConnect * MINUTE_MS;
      if (onward.some(f => f.depUtc >= ready)) continue;
      const missed = onward[onward.length - 1];
      const reason = missed.depUtc < feeder.arrUtc
        ? `${feeder.flightNumber} lands ${feeder.arrLocal}, after ${missed.flightNumber} leaves at ${missed.depLocal}`
        : `${feeder.flightNumber} lands ${feeder.arrLocal}, too close to ${missed.flightNumber} at ${missed.depLocal}`;
      gwOptions.push(decorate(ctx, gateway, buildItinerary([feeder, missed]), 'missedConnection', reason, 'tonight', ground));
    }
    tonight.push(...gwOptions);

    // ── Tomorrow ──
    const tonightKeys = new Set(tonightIts.map(it => `${it.legs[0].flightNumber}|${it.dateKey}`));
    const next = optionsOn(ctx, gateway, tomorrowKey)
      .filter(it => !tonightKeys.has(`${it.legs[0].flightNumber}|${it.dateKey}`) && it.departUtc > closedBefore);
    const directs = next.filter(it => it.legs.length === 1);
    const pool = directs.length ? directs : next;
    const best = pool.sort((a, b) => a.arriveUtc - b.arriveUtc || a.departUtc - b.departUtc)[0];
    if (best) tomorrow.push(decorate(ctx, gateway, best, 'usable', null, 'tomorrow', ground));
  }
  return { tonight: sortGroup(tonight), tomorrow: sortGroup(tomorrow) };
}

/**
 * The outbound miss-one test: what is still reachable if the leg's first
 * flight leaves without you (stillReachable at its scheduled departure,
 * without that flight itself).
 */
export function missOneOutbound(trip: Trip, legId: string, connect: ConnectOptions): { tonight: ReachableOption[]; tomorrow: ReachableOption[] } {
  const leg = trip.legs.find(l => l.id === legId);
  if (!leg || leg.kind !== 'flight' || !leg.refs.length) return { tonight: [], tomorrow: [] };
  const ref = leg.refs[0];
  const r = stillReachable({ trip, at: ref.origin, nowMs: refDepUtc(ref), connect });
  const isSelf = (o: ReachableOption) => o.itinerary.legs[0].flightNumber === ref.flightNumber && o.itinerary.dateKey === ref.dateKey;
  return { tonight: r.tonight.filter(o => !isSelf(o)), tomorrow: r.tomorrow.filter(o => !isSelf(o)) };
}
