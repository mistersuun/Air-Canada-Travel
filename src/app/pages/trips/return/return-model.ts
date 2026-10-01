/**
 * Return tab view model (mockup g3). Pure: everything comes from the trip,
 * the connection prefs and the schedule engine through the FT/FD modules.
 *
 * Facts only: counts of tries, times and "lands after your deadline". No odds,
 * no ratings. Every count is from published schedules ("Scheduled"); days
 * outside the published window make the counts "Unknown".
 */
import { HUBS } from '../../../data/destinations';
import { airportEnd, groundEstimate, placeEnd } from '../../../places/ground';
import { gatewaysNear, homeOptionsByAirport } from '../../../places/reach';
import type { TimeFormat } from '../../../state/prefs.service';
import { HomeByPlan, MissStep, homeByPlan, missOneChain, triesFrom } from '../../../trips/engine/homeby';
import { placeName } from '../../../trips/engine/today';
import { type FlightLeg, type GroundLeg, type GroundMode, type Trip, isFinalStatus } from '../../../trips/model';
import { GROUND_BEFORE_DEPARTURE_MIN } from '../../../trips/engine/legs';
import { airportTz } from '../../../utils/airports';
import { prettyFlight } from '../../../ui/format';
import type { ConnectOptions, Itinerary } from '../../../utils/connections';
import { MINUTE_MS, WEEKDAY_LONG, WEEKDAY_SHORT, addDays, formatClock, formatKey, utcToLocal, weekdayIndex } from '../../../utils/time';
import type { FlightInstance } from '../../../utils/week';

/** How many other airports "Other airports home" lists at most. */
export const OTHER_AIRPORTS_MAX = 3;

/** 'Tue Oct 13'. */
export function dayLabel(key: string): string {
  return `${WEEKDAY_SHORT[weekdayIndex(key)]} ${formatKey(key, { month: 'short', day: 'numeric' })}`;
}

/** 'Oct 12'. */
export function monthDay(key: string): string {
  return formatKey(key, { month: 'short', day: 'numeric' });
}

/** 'Home by Tue Oct 13, 22:00'. */
export function deadlineLabel(trip: Trip, fmt: TimeFormat = '24h'): string {
  return `Home by ${dayLabel(trip.homeBy.dateKey)}, ${formatClock(trip.homeBy.hhmm, fmt)}`;
}

/** '2 tries', '1 try'. */
export function triesLabel(n: number): string {
  return `${n} ${n === 1 ? 'try' : 'tries'}`;
}

/**
 * The return leg the plan counts on: the last flight leg with role 'return'
 * that has not been dropped or missed. Null when there is none yet.
 */
export function activeReturnLeg(trip: Trip): FlightLeg | null {
  const dead = new Set<string>(['abandoned', 'notBoarded', 'didntTry']);
  const legs = trip.legs.filter((l): l is FlightLeg => l.kind === 'flight' && l.role === 'return' && l.refs.length > 0);
  for (let i = legs.length - 1; i >= 0; i--) if (!dead.has(legs[i].status)) return legs[i];
  return null;
}

/**
 * Where the trip flies home from: the return leg's first airport; else the
 * airport of the last ground leg (where it goes, for the trip back to an
 * airport, else where it starts, i.e. the airport the trip came in through);
 * else the last outbound flight's airport; else the goal itself when AC flies
 * there; else the gateway with the shortest estimated trip to the goal.
 */
export function returnGateway(trip: Trip): string | null {
  const leg = activeReturnLeg(trip);
  if (leg) return leg.refs[0].origin;
  const ok = (c: string | undefined): c is string => !!c && c !== trip.homeAirport;
  const ground = [...trip.legs].reverse().find(l => l.kind === 'ground' && l.status !== 'abandoned' && (ok(l.to.code) || ok(l.from.code)));
  if (ground?.kind === 'ground') {
    if (ok(ground.to.code)) return ground.to.code;
    if (ok(ground.from.code)) return ground.from.code;
  }
  const flight = [...trip.legs].reverse().find((l): l is FlightLeg =>
    l.kind === 'flight' && l.role !== 'return' && l.status !== 'abandoned' && l.refs.length > 0);
  if (flight && ok(flight.refs[flight.refs.length - 1].dest)) return flight.refs[flight.refs.length - 1].dest;
  if (ok(trip.goal.acCode ?? undefined)) return trip.goal.acCode!;
  const ranked = gatewaysNear(trip.goal)
    .filter(g => g.code !== trip.homeAirport)
    .map(g => {
      const end = airportEnd(g.code);
      return { code: g.code, min: end ? groundEstimate(end, trip.goal).totalMin : null };
    })
    .sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity));
  return ranked[0]?.code ?? null;
}

/**
 * The Estimated ground leg from the goal to the return airport that "Use as
 * return" adds with the flight, or null when none is needed (AC flies to the
 * goal itself, or an open ground leg already ends at that airport). Dated the
 * day before when it would have to leave before 06:00 on the flight day.
 */
export function groundToGateway(trip: Trip, it: Itinerary): Omit<GroundLeg, 'id' | 'status' | 'statusAt' | 'note'> | null {
  const gw = it.origin;
  if (trip.goal.acCode === gw) return null;
  if (trip.legs.some(l => l.kind === 'ground' && !isFinalStatus(l.status) && l.to.code === gw)) return null;
  const to = airportEnd(gw);
  if (!to) return null;
  const from = placeEnd(trip.goal);
  const g = groundEstimate(from, to);
  const known = g.mode !== 'unknown' && g.totalMin !== null;
  const tz = from.tz ?? airportTz(gw);
  const leaveBy = it.departUtc - (GROUND_BEFORE_DEPARTURE_MIN + (known ? g.totalMin! : 0)) * MINUTE_MS;
  const local = utcToLocal(leaveBy, tz);
  const dateKey = local.dateKey < it.dateKey || local.hhmm < '06:00' ? addDays(it.dateKey, -1) : it.dateKey;
  return {
    kind: 'ground', mode: known ? (g.mode as GroundMode) : 'other', from, to, dateKey,
    estMinutes: known ? g.totalMin : null, provenance: known ? 'estimated' : 'unknown', userTimes: null,
  };
}

/** "AC813 and AC811", "AC813, AC811 and AC1". */
export function joinFlights(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export interface OtherAirportRow {
  code: string;
  city: string;
  /** 'Mon: AC835 to YUL, AC825 to YYZ · Tue: AC825 only'. */
  text: string;
}

/**
 * One day's direct flights home: 'AC835 to YUL, AC825 to YYZ', 'AC825 only'
 * (a flight already named that row), 'AC73 to YUL only', or none found.
 */
function dayFlightsText(flights: readonly FlightInstance[], named: Set<string>): string {
  const seen = new Set<string>();
  const uniq = flights.filter(f => {
    const k = `${f.flightNumber}|${f.dest}`;
    if (!f.flightNumber || f.estimated || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!uniq.length) return 'none in our schedule data';
  const text = uniq.length === 1
    ? (named.has(`${uniq[0].flightNumber}|${uniq[0].dest}`)
      ? `${prettyFlight(uniq[0].flightNumber)} only`
      : `${prettyFlight(uniq[0].flightNumber)} to ${uniq[0].dest} only`)
    : uniq.map(f => `${prettyFlight(f.flightNumber)} to ${f.dest}`).join(', ');
  for (const k of seen) named.add(k);
  return text;
}

/**
 * "Other airports home": other gateways near the goal with direct flights to
 * any Canadian hub on the given days. Airports with nothing on every day,
 * and airports with no known way back from the goal (Casablanca for Seville),
 * are left out.
 */
export function otherAirportsHome(trip: Trip, gateway: string | null, dateKeys: readonly string[]): OtherAirportRow[] {
  const home = new Set(HUBS.map(h => h.code));
  const reachable = (c: string) => {
    const end = airportEnd(c);
    return !!end && groundEstimate(end, trip.goal).mode !== 'unknown';
  };
  const codes = gatewaysNear(trip.goal).map(g => g.code).filter(c => c !== gateway && !home.has(c) && reachable(c));
  if (trip.goal.acCode && trip.goal.acCode !== gateway && !home.has(trip.goal.acCode) && !codes.includes(trip.goal.acCode)) {
    codes.unshift(trip.goal.acCode);
  }
  const rows: OtherAirportRow[] = [];
  for (const opt of homeOptionsByAirport(codes, [...home], [...dateKeys])) {
    if (!opt.days.some(d => d.flights.some(f => !f.estimated))) continue;
    const named = new Set<string>();
    const text = opt.days.map(d => `${WEEKDAY_SHORT[weekdayIndex(d.dateKey)]}: ${dayFlightsText(d.flights, named)}`).join(' · ');
    rows.push({ code: opt.code, city: placeName(opt.code), text });
    if (rows.length >= OTHER_AIRPORTS_MAX) break;
  }
  return rows;
}

export interface ReturnView {
  gateway: string | null;
  /** The airport the trip would fly home from without an override (returnGateway). */
  defaultGateway: string | null;
  /** 'Lisbon'. */
  gatewayCity: string;
  /** 'Seville trip · from Lisbon'. */
  context: string;
  deadline: string;
  hasReturn: boolean;
  /** The day the return flies (the return leg's date, else the deadline date). */
  flyKey: string;
  /** The day before, when it is not before the outbound date. */
  startKey: string | null;
  flyTries: number;
  startTries: number | null;
  /** 'If you try Tuesday'. */
  chainTitle: string;
  steps: MissStep[];
  /** 'Being in Lisbon by Monday morning adds AC813 and AC811 on Oct 12: 4 tries before the deadline instead of 2.' */
  info: string | null;
  others: OtherAirportRow[];
  /** False when some day in the plan is outside the published schedules. */
  covered: boolean;
  plan: HomeByPlan | null;
}

/** Everything the Return tab shows. `from` overrides the gateway (the destination page asks about its own airport). */
export function buildReturnView(trip: Trip, connect: ConnectOptions, fmt: TimeFormat = '24h', from?: string): ReturnView {
  const leg = activeReturnLeg(trip);
  const gateway = from ?? returnGateway(trip);
  const gatewayCity = gateway ? placeName(gateway) : trip.goal.name;
  const flyKey = leg ? leg.refs[0].dateKey : trip.homeBy.dateKey;
  const prev = addDays(flyKey, -1);
  const startKey = prev >= trip.outboundDate ? prev : null;
  const plan = gateway ? homeByPlan(gateway, trip.homeAirport, trip.homeBy, startKey ?? flyKey, connect) : null;
  const flyTries = plan ? triesFrom(plan, flyKey) : 0;
  const startTries = plan && startKey ? triesFrom(plan, startKey) : null;

  let info: string | null = null;
  if (plan && startKey && startTries !== null && startTries > flyTries) {
    const day = plan.days.find(d => d.dateKey === startKey);
    const nums = [...new Set((day?.tries ?? []).map(t => prettyFlight(t.itinerary.legs[0].flightNumber)).filter(Boolean))];
    if (nums.length) {
      info = `Being in ${gatewayCity} by ${WEEKDAY_LONG[weekdayIndex(startKey)]} morning adds ${joinFlights(nums)} on ${monthDay(startKey)}: `
        + `${triesLabel(startTries)} before the deadline instead of ${flyTries}.`;
    }
  }

  return {
    gateway,
    defaultGateway: returnGateway(trip),
    gatewayCity,
    context: gateway ? `${trip.name} · from ${gatewayCity}` : trip.name,
    deadline: deadlineLabel(trip, fmt),
    hasReturn: !!leg,
    flyKey,
    startKey,
    flyTries,
    startTries,
    chainTitle: `If you try ${WEEKDAY_LONG[weekdayIndex(flyKey)]}`,
    steps: plan ? missOneChain(plan, flyKey) : [],
    info,
    others: otherAirportsHome(trip, gateway, startKey ? [startKey, flyKey] : [flyKey]),
    covered: plan?.covered ?? false,
    plan,
  };
}

