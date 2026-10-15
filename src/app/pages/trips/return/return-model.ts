/**
 * Return tab view model (mockup g3). Pure: everything comes from the trip,
 * the connection prefs and the schedule engine through the FT/FD modules.
 *
 * Facts only: counts of tries, times and "lands after your deadline". No odds,
 * no ratings. Every count is from published schedules ("Scheduled"); days
 * outside the published window make the counts "Unknown".
 */
import { t } from '../../../i18n/t';
import { HUBS } from '../../../data/destinations';
import { airportEnd, groundEstimate, placeEnd } from '../../../places/ground';
import { gatewaysNear, homeOptionsByAirport } from '../../../places/reach';
import type { TimeFormat } from '../../../state/prefs.service';
import { HomeByPlan, MissStep, homeByPlan, missOneChain, triesFrom } from '../../../trips/engine/homeby';
import { placeName } from '../../../trips/engine/today';
import { type FlightLeg, type GroundLeg, type GroundMode, type LegEnd, type Trip, isFinalStatus } from '../../../trips/model';
import { greatCircleKm } from '../../../utils/geo';
import { isMultiStop, lastStopPlace } from '../../../trips/stops';
import { GROUND_BEFORE_DEPARTURE_MIN } from '../../../trips/engine/legs';
import { airportTz } from '../../../utils/airports';
import { prettyFlight } from '../../../ui/format';
import type { ConnectOptions, Itinerary } from '../../../utils/connections';
import { MINUTE_MS, addDays, formatClock, formatKey, utcToLocal, weekdayIndex, weekdayLong, weekdayShort } from '../../../utils/time';
import type { FlightInstance } from '../../../utils/week';

/** A ground leg starting this close to the last stop starts at it. */
const LAST_STOP_KM = 40;

/** How many other airports "Other airports home" lists at most. */
export const OTHER_AIRPORTS_MAX = 3;

/** 'Tue Oct 13'. */
export function dayLabel(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** 'Oct 12'. */
export function monthDay(key: string): string {
  return formatKey(key, { month: 'short', day: 'numeric' });
}

/** 'Home by Tue Oct 13, 22:00'. */
export function deadlineLabel(trip: Trip, fmt: TimeFormat = '24h'): string {
  return t('trips.ret.homeBy', { day: dayLabel(trip.homeBy.dateKey), time: formatClock(trip.homeBy.hhmm, fmt) });
}

/** '2 tries', '1 try'. */
export function triesLabel(n: number): string {
  return t('trips.ret.tries', { n });
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
 * there; else the gateway with the shortest estimated trip to the goal. On a
 * multi-stop trip "the goal" is the LAST stop and only airports serving it count.
 */
export function returnGateway(trip: Trip): string | null {
  const leg = activeReturnLeg(trip);
  if (leg) return leg.refs[0].origin;
  // On a multi-stop trip a leg's airport only counts when it serves the last stop: that stop's own airport (one near it only when it has none),
  // or the far end of a ground leg that starts at the last stop (Lisbon by train to Porto). Legs between earlier stops don't.
  const multi = isMultiStop(trip);
  const last = lastStopPlace(trip);
  const nearLast = new Set(last.acCode ? [last.acCode] : gatewaysNear(last).map(g => g.code));
  const ok = (c: string | undefined): c is string => !!c && c !== trip.homeAirport && (!multi || nearLast.has(c));
  const startsAtLast = (e: LegEnd) => multi && ((!!e.code && e.code === last.acCode) || greatCircleKm(e, last) <= LAST_STOP_KM);
  const ground = [...trip.legs].reverse().find(l => l.kind === 'ground' && l.status !== 'abandoned'
    && (ok(l.to.code) || ok(l.from.code) || (startsAtLast(l.from) && !!l.to.code && l.to.code !== trip.homeAirport)));
  if (ground?.kind === 'ground') {
    if (ok(ground.to.code) || (startsAtLast(ground.from) && ground.to.code && ground.to.code !== trip.homeAirport)) return ground.to.code!;
    if (ok(ground.from.code)) return ground.from.code;
  }
  const flight = [...trip.legs].reverse().find((l): l is FlightLeg =>
    l.kind === 'flight' && l.role !== 'return' && l.status !== 'abandoned' && l.refs.length > 0);
  if (flight && ok(flight.refs[flight.refs.length - 1].dest)) return flight.refs[flight.refs.length - 1].dest;
  if (ok(lastStopPlace(trip).acCode ?? undefined)) return lastStopPlace(trip).acCode!;
  const ranked = gatewaysNear(lastStopPlace(trip))
    .filter(g => g.code !== trip.homeAirport)
    .map(g => {
      const end = airportEnd(g.code);
      return { code: g.code, min: end ? groundEstimate(end, lastStopPlace(trip)).totalMin : null };
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
  if (lastStopPlace(trip).acCode === gw) return null;
  if (trip.legs.some(l => l.kind === 'ground' && !isFinalStatus(l.status) && l.to.code === gw)) return null;
  const to = airportEnd(gw);
  if (!to) return null;
  const from = placeEnd(lastStopPlace(trip));
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
  return t('trips.stopNames', { list: list.slice(0, -1).join(', '), last: list[list.length - 1] });
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
  if (!uniq.length) return t('trips.ret.none');
  const text = uniq.length === 1
    ? (named.has(`${uniq[0].flightNumber}|${uniq[0].dest}`)
      ? t('trips.ret.only', { flight: prettyFlight(uniq[0].flightNumber) })
      : t('trips.ret.toOnly', { flight: prettyFlight(uniq[0].flightNumber), dest: uniq[0].dest }))
    : uniq.map(f => t('trips.ret.to', { flight: prettyFlight(f.flightNumber), dest: f.dest })).join(', ');
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
    return !!end && groundEstimate(end, lastStopPlace(trip)).mode !== 'unknown';
  };
  const last = lastStopPlace(trip);
  const codes = gatewaysNear(last).map(g => g.code).filter(c => c !== gateway && !home.has(c) && reachable(c));
  if (last.acCode && last.acCode !== gateway && !home.has(last.acCode) && !codes.includes(last.acCode)) {
    codes.unshift(last.acCode);
  }
  const rows: OtherAirportRow[] = [];
  for (const opt of homeOptionsByAirport(codes, [...home], [...dateKeys])) {
    if (!opt.days.some(d => d.flights.some(f => !f.estimated))) continue;
    const named = new Set<string>();
    const text = opt.days.map(d => t('trips.ret.dayLine', { day: weekdayShort(weekdayIndex(d.dateKey)), flights: dayFlightsText(d.flights, named) })).join(' · ');
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

/** The day the return flies: the active return leg's date, else the deadline date. */
export function returnFlyKey(trip: Trip): string {
  const leg = activeReturnLeg(trip);
  return leg ? leg.refs[0].dateKey : trip.homeBy.dateKey;
}

/** Everything the Return tab shows. `from` overrides the gateway (the destination page asks about its own airport). */
export function buildReturnView(trip: Trip, connect: ConnectOptions, fmt: TimeFormat = '24h', from?: string): ReturnView {
  const leg = activeReturnLeg(trip);
  const gateway = from ?? returnGateway(trip);
  const gatewayCity = gateway ? placeName(gateway) : lastStopPlace(trip).name;
  const flyKey = returnFlyKey(trip);
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
      info = t('trips.ret.info', {
        city: gatewayCity, day: weekdayLong(weekdayIndex(startKey)), flights: joinFlights(nums), date: monthDay(startKey),
        tries: triesLabel(startTries), n: flyTries,
      });
    }
  }

  return {
    gateway,
    defaultGateway: returnGateway(trip),
    gatewayCity,
    context: gateway ? t('trips.ret.context', { name: trip.name, city: gatewayCity }) : trip.name,
    deadline: deadlineLabel(trip, fmt),
    hasReturn: !!leg,
    flyKey,
    startKey,
    flyTries,
    startTries,
    chainTitle: t('trips.ret.chain', { day: weekdayLong(weekdayIndex(flyKey)) }),
    steps: plan ? missOneChain(plan, flyKey) : [],
    info,
    others: otherAirportsHome(trip, gateway, startKey ? [startKey, flyKey] : [flyKey]),
    covered: plan?.covered ?? false,
    plan,
  };
}

