/**
 * Reach screens (/reach/:place, /reach/:place/:code): the URL fields, the
 * gateway row text, the door-to-door wording and "Start this trip". Pure
 * except startTripFromGateway, which writes through TripsService.
 */
import { HUBS } from '../../data/destinations';
import { MsgKey, t } from '../../i18n/t';
import { GroundDeparture, GroundEstimate, aboutDuration, airportEnd, placeEnd } from '../../places/ground';
import { shortDate } from '../../places/timetable';
import { Gateway, ReachSort } from '../../places/reach';
import type { GroundLeg, GroundMode, Place } from '../../trips/model';
import type { TripsService } from '../../trips/trips.service';
import { prettyFlight, supOffset } from '../../ui/format';
import type { Itinerary } from '../../utils/connections';
import { MINUTE_MS, addDays, formatKey, isDateKey, utcToLocal, weekdayIndex, weekdayShort } from '../../utils/time';

/** Default departure: a week from today. Default return: 5 days after leaving, 22:00. */
export const DEFAULT_LEAD_DAYS = 7;
export const DEFAULT_STAY_DAYS = 5;
export const DEFAULT_HOME_HHMM = '22:00';

export interface ReachParams {
  dep: string;                               // dateKey
  home: { dateKey: string; hhmm: string };   // wall clock at the home airport
  sort: ReachSort;
  hubs: boolean;                             // include itineraries via other Canadian hubs
  hub: string;                               // this search's hub (not the global one)
}

export interface RawReachParams {
  dep?: string | null;
  home?: string | null;
  sort?: string | null;
  hubs?: string | null;
  hub?: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'YYYY-MM-DDTHH:MM' → parts; null when malformed. */
export function parseHome(v: string | null | undefined): { dateKey: string; hhmm: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v ?? '');
  return m && isDateKey(m[1]) && HHMM.test(m[2]) ? { dateKey: m[1], hhmm: m[2] } : null;
}

export function formatHome(h: { dateKey: string; hhmm: string }): string {
  return `${h.dateKey}T${h.hhmm}`;
}

/** URL query → params with defaults (today + 7; home 5 days later at 22:00; the global hub). */
export function readReachParams(raw: RawReachParams, todayKey: string, globalHub: string): ReachParams {
  const dep = raw.dep && isDateKey(raw.dep) ? raw.dep : addDays(todayKey, DEFAULT_LEAD_DAYS);
  let home = parseHome(raw.home);
  if (!home || home.dateKey < dep) home = { dateKey: addDays(dep, DEFAULT_STAY_DAYS), hhmm: DEFAULT_HOME_HHMM };
  const hub = raw.hub && HUBS.some(h => h.code === raw.hub) ? raw.hub : globalHub;
  return { dep, home, sort: raw.sort === 'flights' ? 'flights' : 'onward', hubs: raw.hubs === '1', hub };
}

/** Params → query (every key written, so links are stable and shareable). */
export function reachQueryParams(p: ReachParams): Record<string, string | null> {
  return {
    dep: p.dep,
    home: formatHome(p.home),
    sort: p.sort === 'flights' ? 'flights' : null,
    hubs: p.hubs ? '1' : null,
    hub: p.hub,
  };
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** 'Thu Oct 8'. */
export function dayLabel(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** 'AC834' or 'AC489 + AC824'. */
export function itinFlights(it: Itinerary): string {
  return it.legs.map(l => prettyFlight(l.flightNumber) || t('places.reach.flightWord')).join(' + ');
}

export function hubCity(code: string): string {
  return airportEnd(code)?.name ?? code;
}

/** The text of one gateway row. `flight` is null for a row without a flight that date. */
export interface GatewayRow {
  code: string;
  city: string;
  flight: string | null;     // 'AC834 17:55 · 1 flight that day'
  standby: string | null;    // '2 standby legs' (only for itineraries via another hub)
  ground: string;            // 'Train about 2h40', or 'Train 2h39' from a timetable
  provenance: 'scheduled' | 'estimated' | 'unknown';
  night: boolean;            // a night on the way is likely
  idle: string | null;       // 'Not found in our schedule data Thu Oct 8 · next Fri Oct 9'
  /** The next date with a flight (idle rows link there). */
  nextDateKey: string | null;
}

export function gatewayRow(g: Gateway, dateKey: string): GatewayRow {
  const best = g.itineraries[0] ?? null;
  let flight: string | null = null;
  let standby: string | null = null;
  let idle: string | null = null;
  if (best) {
    const first = best.legs[0];
    const viaIts = g.itineraries.filter(i => i.legs.length > 1);
    if (g.directCount) {
      flight = t('places.reach.flightLine', { flights: itinFlights(best), time: first.depLocal, n: g.directCount });
      if (viaIts.length) {
        standby = t('places.reach.standbyVia', { n: viaIts.length, city: hubCity(viaIts[0].hubs[0] ?? ''), legs: viaIts[0].legs.length });
      }
    } else {
      flight = `${itinFlights(best)} ${first.depLocal} · ${t('format.via', { hubs: hubCity(best.hubs[0] ?? '') })}`;
      standby = t('places.reach.standbyLegs', { legs: best.legs.length });
    }
  } else if (!g.covered) {
    idle = t('places.reach.notPublished', { day: dayLabel(dateKey) });
  } else {
    idle = g.nextDateKey
      ? t('places.reach.notFoundNext', { day: dayLabel(dateKey), next: dayLabel(g.nextDateKey) })
      : t('places.reach.notFoundNone', { day: dayLabel(dateKey) });
  }
  return {
    code: g.code, city: g.city, flight, standby, idle, nextDateKey: !best && g.covered ? g.nextDateKey ?? null : null,
    ground: g.ground.label, provenance: g.ground.provenance, night: !!best && g.overnightLikely,
  };
}

/** 'morning', 'midday', 'afternoon', 'evening', 'late evening', 'early morning' for a local HH:MM. */
export function partOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const min = h * 60 + m;
  if (min < 5 * 60) return t('places.part.earlyMorning');
  if (min < 10 * 60 + 30) return t('places.part.morning');
  if (min < 13 * 60 + 30) return t('places.part.midday');
  if (min < 17 * 60) return t('places.part.afternoon');
  if (min < 21 * 60) return t('places.part.evening');
  return t('places.part.lateEvening');
}

/** 'Seville around midday, Fri Oct 9' (in the goal's time zone, else the gateway's). */
export function arrivalLine(place: Place, utc: number | null, gatewayTz: string): string {
  if (utc === null) return t('places.reach.arrivalUnknown', { place: place.name });
  const local = utcToLocal(utc, place.tz || gatewayTz);
  return t('places.reach.arrival', { place: place.name, part: partOfDay(local.hhmm), day: dayLabel(local.dateKey) });
}

/** 'YUL 17:55 → MAD 06:50⁺¹' for one flight segment. */
export function segmentLine(l: Itinerary['legs'][number]): string {
  return `${l.origin} ${l.depLocal} → ${l.dest} ${l.arrLocal}${supOffset(l.arrDayOffset)}`;
}

/** 'Train to Seville', 'Bus to Seville', 'Taxi or transit to Seville', 'Onward to Seville'. */
export function groundTitle(g: GroundEstimate, place: Place): string {
  const key: MsgKey = g.mode === 'train' ? 'places.reach.toTrain'
    : g.mode === 'bus' ? (g.source === 'heuristic' ? 'places.reach.toBusTrain' : 'places.reach.toBus')
    : g.mode === 'car' ? 'places.reach.toTaxi' : g.mode === 'ferry' ? 'places.reach.toFerry' : 'places.reach.toOnward';
  return t(key, { place: place.name });
}

/**
 * 'about 2h40 · trains roughly hourly' (the label's own duration, then the
 * frequency). From a timetable: '2h39 · next 16:00, last 21:05', where next
 * is the departure the traveller would catch (`next`, from arrivalAtGoal).
 */
export function groundDetail(g: GroundEstimate, next?: GroundDeparture | null): string {
  if (g.mode === 'unknown' || g.rideMin === null) return t('places.reach.notFoundLinks');
  if (g.source === 'timetable' && g.timetable) {
    const flight = g.shortFlightToo ? t('places.reach.orFlight') : '';
    const last = g.lastDepLocal ? t('places.reach.last', { time: g.lastDepLocal }) : '';
    const when = next
      ? next.sameDay
        ? [t('places.reach.next', { time: next.hhmm }), last].filter(Boolean).join(', ')
        : t('places.reach.nextDay', { day: weekdayShort(weekdayIndex(next.dateKey)), time: next.hhmm })
      : last;
    return [g.timetable.rideText + flight, when].filter(Boolean).join(' · ');
  }
  const about = t('places.reach.about', { dur: aboutDuration(g.rideMin) });
  const extra = g.shortFlightToo ? t('places.reach.orFlight') : '';
  return [about + extra, g.frequency].filter(Boolean).join(' · ');
}

/**
 * The lines under the ground leg about its timetable: trips that day,
 * 'Timetable · Renfe · valid to Dec 20' and the corridor note; or why the
 * times are estimated ('Timetable ends Dec 20, times estimated', 'Not found
 * in our timetable data for Sat Oct 17'). [] without a timetable.
 */
export function groundTimetableLines(g: GroundEstimate): string[] {
  const tm = g.timetable;
  if (!tm) return [];
  const note = tm.note ? [tm.note] : [];
  switch (tm.state) {
    case 'ok':
      return [g.frequency ?? '', t('places.reach.ttValid', { op: tm.operator, date: shortDate(tm.validTo) }), ...note].filter(Boolean);
    case 'empty':
      return [t('places.reach.ttNone', { day: dayLabel(tm.dateKey) }), ...note];
    case 'ended':
      return [t('places.reach.ttEnds', { date: shortDate(tm.validTo) })];
    default:
      return [];
  }
}

/** 'I found a train' / 'I found a bus' / 'I found a ride' / 'I found a way there'. */
export function foundLabel(mode: GroundEstimate['mode']): string {
  switch (mode) {
    case 'train': return t('places.reach.foundTrain');
    case 'bus': return t('places.reach.foundBus');
    case 'car': return t('places.reach.foundRide');
    default: return t('places.reach.foundWay');
  }
}

/** A warning when the usual last train/bus is likely gone, or a night on the way is likely; else null. */
export function lastTrainWarning(g: Gateway): string | null {
  if (!g.itineraries.length) return null;
  const what = g.ground.mode === 'bus' ? 'bus' : g.ground.mode === 'train' ? 'train' : 'other';
  if (g.lastDepMissed) {
    const last = !g.ground.lastDepLocal ? ''
      : t(g.ground.source === 'timetable' ? 'places.reach.lastLeaves' : 'places.reach.lastUsually', { time: g.ground.lastDepLocal });
    return t('places.reach.late', { what, last, city: g.city });
  }
  if (g.overnightLikely) return t('places.reach.arriveLate', { city: g.city });
  return null;
}

// ── Start this trip ─────────────────────────────────────────────────────────

/** The day the ground leg starts (gateway-local): the morning after when the night is likely. */
export function groundDateKey(g: Gateway, it: Itinerary): string {
  const tz = airportEnd(g.code)?.tz ?? 'UTC';
  if (g.arriveGoalUtc !== null && g.ground.rideMin !== null) {
    return utcToLocal(g.arriveGoalUtc - g.ground.rideMin * MINUTE_MS, tz).dateKey;
  }
  return it.arrDateKey;
}

export interface StartInput {
  place: Place;
  params: ReachParams;
  gateway: Gateway;
  itinerary: Itinerary;
  /** Every gateway of the same search; same-day options to the others become backups. */
  others: readonly Gateway[];
}

/** The ground leg for a gateway (Estimated, or Unknown when onward travel is unknown). */
export function groundLegFor(g: Gateway, it: Itinerary, place: Place): Omit<GroundLeg, 'id' | 'status' | 'statusAt' | 'note'> {
  const from = airportEnd(g.code)!;
  const mode: GroundMode = g.ground.mode === 'unknown' ? 'other' : g.ground.mode;
  return {
    kind: 'ground', mode, from, to: placeEnd(place), dateKey: groundDateKey(g, it),
    estMinutes: g.ground.totalMin, provenance: g.ground.provenance === 'unknown' ? 'unknown' : 'estimated', userTimes: null,
  };
}

/** The backups for a start: the best same-day itinerary to each other gateway, in list order. */
export function backupItineraries(chosen: Gateway, it: Itinerary, others: readonly Gateway[]): Itinerary[] {
  return others
    .filter(o => o.code !== chosen.code && o.itineraries.length)
    .map(o => o.itineraries[0])
    .filter(b => b.dateKey === it.dateKey);
}

/**
 * Creates the trip: the outbound flight (Planned), the ground leg
 * (Estimated) and same-day backups to the other gateways. Returns the trip
 * and ground leg ids.
 */
export function startTripFromGateway(trips: TripsService, s: StartInput): { tripId: string; flightLegId: string; groundLegId: string } {
  const trip = trips.create({
    goal: s.place, fromHub: s.params.hub, outboundDate: s.itinerary.dateKey, homeBy: { ...s.params.home },
  });
  const flightLegId = trips.addFlightLeg(trip.id, s.itinerary, 'outbound');
  const groundLegId = trips.addGroundLeg(trip.id, groundLegFor(s.gateway, s.itinerary, s.place));
  for (const b of backupItineraries(s.gateway, s.itinerary, s.others)) trips.addAlternate(trip.id, flightLegId, b);
  return { tripId: trip.id, flightLegId, groundLegId };
}
