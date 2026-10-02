/**
 * Ground estimates from a gateway airport to the place the traveller wants
 * to reach. A corridor with a real timetable (ground.json, see timetable.ts)
 * that covers the date gives the ride as Scheduled; otherwise corridor rows
 * (corridors.ts) or a distance heuristic, labelled Estimated, or Unknown when
 * we cannot tell (across the sea, between countries without a land link).
 * The airport exit and transfer are always Estimated. Pure, apart from
 * reading the loaded timetables signal.
 */
import type { GroundMode, LegEnd, Place } from '../trips/model';
import { hubDisplayName } from '../ui/format';
import { findDestination, findHub } from '../utils/airports';
import { greatCircleKm } from '../utils/geo';
import { MINUTE_MS, toUtcMs, addDays, hhmmToMin, minToHhmm, todayKey, utcToLocal } from '../utils/time';
import { CORRIDORS, Corridor, corridorTransferMin } from './corridors';
import {
  DAY_KIND_LABEL, Departure, TimetableDir, dayKind, departuresOn, groundTimetables, nextDeparture, timetableFor,
  typicalRide,
} from './timetable';

/**
 * The timetable behind a corridor estimate, for the date asked about:
 * 'ok' (departures that day, the ride is Scheduled), 'empty' (the timetable
 * covers the date but nothing runs), 'ended' (the date is after validTo) or
 * 'notYet' (before validFrom). The last three keep the Estimated row.
 */
export interface GroundTimetableInfo {
  dir: TimetableDir;
  operator: string;
  dateKey: string;
  state: 'ok' | 'empty' | 'ended' | 'notYet';
  departures: readonly Departure[];
  /** '2h39', or '1h01 to 1h55' when that day's rides differ by more than 20 min. */
  rideText: string;
  validTo: string;
  note: string | null;
}

export interface GroundEstimate {
  mode: GroundMode | 'unknown';
  label: string;            // 'Train about 2h40', 'Bus about 6h45', 'Train about 5h30, or a short flight', 'Onward travel unknown'
  rideMin: number | null;   // the ride itself
  exitMin: number;          // airport exit + getting to the station; MAD→Atocha 90
  exitLabel: string;        // 'Passport, exit, get to Atocha'
  totalMin: number | null;  // exitMin + rideMin
  frequency: string | null; // 'trains roughly hourly'
  lastDepLocal: string | null; // usual last departure (corridor only)
  shortFlightToo: boolean;
  source: 'timetable' | 'corridor' | 'heuristic' | 'none';
  /** Of the ride: 'scheduled' only from a timetable that covers the date. */
  provenance: 'scheduled' | 'estimated' | 'unknown';
  /** Present when the corridor has a timetable in ground.json (whatever the date). */
  timetable?: GroundTimetableInfo;
}

/** Road distance ≈ 1.3 × great-circle. */
export const ROAD_FACTOR = 1.3;
export const CAR_MAX_KM = 60;
export const CAR_KMH = 50;
export const BUS_KMH = 70;
export const SHORT_FLIGHT_KM = 700;
export const HEURISTIC_EXIT_MIN = 60;
/** A leg end this close to a corridor city is that city. */
export const CORRIDOR_MATCH_KM = 25;
/** Arriving at the goal after this (gateway-local) counts as overnight. */
export const LATE_ARRIVAL = '23:30';
/** Before this hour, local times count as "late last night", not early today. */
const NIGHT_END_MIN = 5 * 60;
/** Next-morning departure assumed when the last train is missed (no timetable). */
const NEXT_MORNING = '08:00';
/** A day's rides further apart than this are shown as a range. */
const RIDE_RANGE_MIN = 20;

const SCHENGEN_MAINLAND = [
  'AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IT', 'LI', 'LT', 'LU', 'LV',
  'NL', 'NO', 'PL', 'PT', 'SE', 'SI', 'SK', 'BG', 'RO', 'AD', 'MC', 'SM', 'VA',
];

/** Groups of countries joined by land (or the Channel Tunnel); any two in one group are land-connected. */
const LAND_GROUPS: readonly (readonly string[])[] = [
  SCHENGEN_MAINLAND,
  ['GB', 'FR', 'BE'],
  ['US', 'CA', 'MX'],
  ['MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA'],
  ['CO', 'EC', 'PE', 'BO', 'CL', 'AR', 'BR', 'UY', 'PY', 'VE'],
  ['CN', 'HK', 'MO'],
  ['SG', 'MY', 'TH'],
];

/** True when two countries are joined by land (same country included). */
export function landConnected(a: string, b: string): boolean {
  if (a === b) return true;
  return LAND_GROUPS.some(g => g.includes(a) && g.includes(b));
}

/**
 * Gateways on islands of a mainland country, with the island's rough radius:
 * a place beyond it (or a place on the island reached from elsewhere) needs a
 * ferry or a flight, so onward travel is unknown.
 */
export const ISLAND_GATEWAYS: Readonly<Record<string, number>> = {
  PMI: 80, TFS: 60, PDL: 50, CTA: 200, HNL: 50, OGG: 50, KOA: 120, CZM: 20, NAS: 30, GGT: 60,
};

function islandOf(p: { lat: number; lng: number }): string | null {
  for (const [code, km] of Object.entries(ISLAND_GATEWAYS)) {
    const a = findDestination(code);
    if (a && greatCircleKm(p, a) <= km) return code;
  }
  return null;
}

/** The airport code of a leg end, or the AC airport of a Place that AC serves itself. */
function codeOf(end: LegEnd | Place): string | undefined {
  return 'code' in end ? end.code : 'acCode' in end ? end.acCode : undefined;
}

function countryOf(end: LegEnd | Place): string | null {
  if ('iso2' in end && end.iso2) return end.iso2;
  const code = codeOf(end);
  if (code) return findDestination(code)?.iso2 ?? (findHub(code) ? 'CA' : null);
  return null;
}

function geonameIdOf(end: LegEnd | Place): number | null {
  const m = 'id' in end ? /^gn-(\d+)$/.exec(end.id) : null;
  return m ? Number(m[1]) : null;
}

function isAirport(end: LegEnd | Place): boolean {
  const code = 'code' in end ? end.code : undefined;
  return !!code && !!(findDestination(code) || findHub(code));
}

function cityMatches(end: LegEnd | Place, c: Corridor): boolean {
  const id = geonameIdOf(end);
  if (id !== null) return id === c.geonameId;
  return greatCircleKm(end, c) <= CORRIDOR_MATCH_KM;
}

/** The corridor between an airport end and a city end, either direction. */
export function findCorridor(from: LegEnd, to: Place | LegEnd): { row: Corridor; reverse: boolean } | null {
  for (const row of CORRIDORS) {
    if (from.code === row.code && codeOf(to) !== row.code && cityMatches(to, row)) return { row, reverse: false };
    if (codeOf(to) === row.code && from.code !== row.code && cityMatches(from, row)) return { row, reverse: true };
  }
  return null;
}

/** '2h40', '9h', '45 min'. */
export function aboutDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function unknownGround(): GroundEstimate {
  return {
    mode: 'unknown', label: 'Onward travel unknown', rideMin: null, exitMin: 0, exitLabel: '', totalMin: null,
    frequency: null, lastDepLocal: null, shortFlightToo: false, source: 'none', provenance: 'unknown',
  };
}

/**
 * How to get from `from` (usually the gateway airport) to `to` (the goal) on
 * `opts.dateKey` (local at the origin station; today when omitted).
 * A corridor with a timetable covering that date first (Scheduled ride), then
 * the corridor row, then the sea/country check, then the distance heuristic:
 * under 60 km by road a taxi or transit at 50 km/h, up to 700 km a bus or
 * train at 70 km/h, beyond that the same plus "or a short flight". Leaving
 * an airport adds 60 min (passport, exit).
 */
export function groundEstimate(from: LegEnd, to: Place | LegEnd, opts?: { dateKey?: string }): GroundEstimate {
  const hit = findCorridor(from, to);
  if (hit) {
    const { row, reverse } = hit;
    // Towards the airport there is no passport/exit, but the station → airport transfer still counts.
    const exitMin = reverse ? corridorTransferMin(row) : row.exitMin;
    const word = row.modeLabel ?? cap(row.mode);
    const base: GroundEstimate = {
      mode: row.mode,
      label: `${word} about ${aboutDuration(row.rideMin)}${row.shortFlightToo ? ', or a short flight' : ''}`,
      rideMin: row.rideMin,
      exitMin,
      exitLabel: reverse ? (exitMin ? `Get to ${row.code} airport` : '') : row.exitLabel,
      totalMin: exitMin + row.rideMin,
      frequency: row.frequency,
      lastDepLocal: reverse ? null : row.lastDepLocal,
      shortFlightToo: !!row.shortFlightToo,
      source: 'corridor',
      provenance: 'estimated',
    };
    const dir = timetableFor(groundTimetables(), row.code, row.geonameId, reverse);
    return dir ? withTimetable(base, dir, word, reverse, opts?.dateKey ?? todayKey(dir.tz)) : base;
  }

  const a = countryOf(from);
  const b = countryOf(to);
  if (a && b && !landConnected(a, b)) return unknownGround();
  if (islandOf(from) !== islandOf(to)) return unknownGround();

  const roadKm = greatCircleKm(from, to) * ROAD_FACTOR;
  const exitMin = isAirport(from) ? HEURISTIC_EXIT_MIN : 0;
  if (roadKm < CAR_MAX_KM) {
    const ride = round5((roadKm / CAR_KMH) * 60);
    return {
      mode: 'car', label: `Taxi or transit about ${aboutDuration(ride)}`, rideMin: ride, exitMin,
      exitLabel: exitMin ? 'Passport and exit' : '', totalMin: exitMin + ride, frequency: null, lastDepLocal: null,
      shortFlightToo: false, source: 'heuristic', provenance: 'estimated',
    };
  }
  const ride = round5((roadKm / BUS_KMH) * 60);
  const far = roadKm / ROAD_FACTOR > SHORT_FLIGHT_KM;
  return {
    mode: 'bus',
    label: `Bus or train about ${aboutDuration(ride)}${far ? ', or a short flight' : ''}`,
    rideMin: ride, exitMin,
    exitLabel: exitMin ? 'Passport, exit, get to the station' : '',
    totalMin: exitMin + ride, frequency: null, lastDepLocal: null,
    shortFlightToo: far, source: 'heuristic', provenance: 'estimated',
  };
}

/** The corridor estimate with its timetable for `dateKey`: Scheduled when trains or buses run that day. */
function withTimetable(base: GroundEstimate, dir: TimetableDir, word: string, reverse: boolean, dateKey: string): GroundEstimate {
  const deps = departuresOn(dir, dateKey);
  const info: GroundTimetableInfo = {
    dir, operator: dir.op, dateKey, state: 'ok', departures: deps ?? [], rideText: '', validTo: dir.validTo, note: dir.note,
  };
  if (deps === null) return { ...base, timetable: { ...info, state: dateKey > dir.validTo ? 'ended' : 'notYet' } };
  if (!deps.length) return { ...base, timetable: { ...info, state: 'empty' } };
  const rides = deps.map(d => d.rideMin);
  const lo = Math.min(...rides);
  const hi = Math.max(...rides);
  const ride = typicalRide(deps);
  const rideText = hi - lo > RIDE_RANGE_MIN ? `${aboutDuration(lo)} to ${aboutDuration(hi)}` : aboutDuration(ride);
  const first = minToHhmm(deps[0].depMin);
  const last = minToHhmm(deps[deps.length - 1].depMin);
  const noun = base.mode === 'bus' ? (deps.length === 1 ? 'bus' : 'buses') : (deps.length === 1 ? 'train' : 'trains');
  const when = deps.length === 1 ? `at ${first}` : `${first} to ${last}`;
  return {
    ...base,
    label: `${word} ${rideText}${base.shortFlightToo ? ', or a short flight' : ''}`,
    rideMin: ride,
    totalMin: base.exitMin + ride,
    frequency: `${deps.length} ${dir.op} ${noun} on ${DAY_KIND_LABEL[dayKind(dateKey)]}, ${when}`,
    lastDepLocal: reverse ? null : last,
    source: 'timetable',
    provenance: 'scheduled',
    timetable: { ...info, rideText },
  };
}

/** Minutes after local midnight, with 00:00–04:59 counted as the previous night (24:00–28:59). */
function nightMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const v = h * 60 + m;
  return v < NIGHT_END_MIN ? v + 1440 : v;
}

/** The train or bus taken, from a timetable: its local date and time at the origin station. */
export interface GroundDeparture {
  dateKey: string;
  hhmm: string;
  rideMin: number;
  /** Leaves the same day the traveller is ready. */
  sameDay: boolean;
}

export interface GoalArrival {
  utc: number | null;
  overnightLikely: boolean;
  lastDepMissed: boolean;
  /** Set when a timetable gave the departure. */
  departure: GroundDeparture | null;
  /** The timetable covers the next days but lists nothing running (utc is then null). */
  noService?: true;
}

/**
 * When the traveller reaches the goal after landing at `landUtc`.
 * With a timetable covering the day they are out of the airport: the first
 * departure at or after then, with that train's own ride time; none left
 * that day means the first one the next morning (lastDepMissed).
 * Otherwise landing + exit + ride: if they are out after the usual last
 * departure (`lastDepMissed`), or the ride would end after 23:30 or start in
 * the small hours (`overnightLikely`), the ride is assumed to leave at 08:00
 * the next morning. utc is null when the estimate is unknown, or when the
 * timetable covers the next days but lists nothing running (noService).
 */
export function arrivalAtGoal(landUtc: number, g: GroundEstimate, gatewayTz: string): GoalArrival {
  if (g.rideMin === null || g.totalMin === null) return { utc: null, overnightLikely: false, lastDepMissed: false, departure: null };
  const readyUtc = landUtc + g.exitMin * MINUTE_MS;
  const timed = g.timetable ? byTimetable(readyUtc, g.timetable.dir, gatewayTz) : null;
  if (timed) return timed;
  const ready = utcToLocal(readyUtc, gatewayTz);
  const readyMin = nightMin(ready.hhmm);
  const lastDepMissed = !!g.lastDepLocal && readyMin > nightMin(g.lastDepLocal);
  const endUtc = readyUtc + g.rideMin * MINUTE_MS;
  const end = utcToLocal(endUtc, gatewayTz);
  const smallHours = readyMin >= 1440;
  const endsLate = end.dateKey !== ready.dateKey || nightMin(end.hhmm) > nightMin(LATE_ARRIVAL);
  const overnightLikely = lastDepMissed || smallHours || endsLate;
  if (!overnightLikely) return { utc: endUtc, overnightLikely, lastDepMissed, departure: null };
  // The night before 05:00 belongs to the previous evening: leave that same calendar morning.
  const morningKey = smallHours ? ready.dateKey : addDays(ready.dateKey, 1);
  const leaveUtc = toUtcMs(morningKey, NEXT_MORNING, gatewayTz);
  return { utc: leaveUtc + g.rideMin * MINUTE_MS, overnightLikely, lastDepMissed, departure: null };
}

/**
 * arrivalAtGoal from the real departures; null when the timetable does not
 * cover those days. Ready between 00:00 and 04:59 counts as the previous
 * evening (as nightMin does for the estimate): the last departure missed is
 * that evening's, unless a departure still leaves before 05:00. When the
 * timetable covers the next days but lists nothing running, the arrival is
 * unknown (utc null) rather than an estimated next morning.
 */
function byTimetable(readyUtc: number, dir: TimetableDir, gatewayTz: string): GoalArrival | null {
  const ready = utcToLocal(readyUtc, dir.tz);
  const readyMin = hhmmToMin(ready.hhmm);
  const next = nextDeparture(dir, ready.dateKey, readyMin);
  if (next === null) return null;
  const smallHours = readyMin < NIGHT_END_MIN;
  const today = departuresOn(dir, ready.dateKey) ?? [];
  const evening = smallHours
    ? [...(departuresOn(dir, addDays(ready.dateKey, -1)) ?? []), ...today.filter(d => d.depMin < NIGHT_END_MIN)]
    : today;
  if (next === 'none') {
    return { utc: null, overnightLikely: true, lastDepMissed: evening.length > 0, departure: null, noService: true };
  }
  const leaveUtc = toUtcMs(next.dateKey, next.hhmm, dir.tz);
  const utc = leaveUtc + next.dep.rideMin * MINUTE_MS;
  const caughtTonight = next.sameDay && (!smallHours || next.dep.depMin < NIGHT_END_MIN);
  const lastDepMissed = !caughtTonight && evening.length > 0;
  const waitsOutTheNight = smallHours && next.dep.depMin >= NIGHT_END_MIN;
  const leave = utcToLocal(leaveUtc, gatewayTz);
  const end = utcToLocal(utc, gatewayTz);
  const endsLate = end.dateKey !== leave.dateKey || nightMin(end.hhmm) > nightMin(LATE_ARRIVAL);
  return {
    utc,
    overnightLikely: !next.sameDay || waitsOutTheNight || endsLate,
    lastDepMissed,
    departure: { dateKey: next.dateKey, hhmm: next.hhmm, rideMin: next.dep.rideMin, sameDay: next.sameDay },
  };
}

function rome2rioName(end: LegEnd): string {
  const name = end.code && isAirport(end) ? `${end.name} ${end.code} Airport` : end.name;
  return encodeURIComponent(name.trim().replace(/\s+/g, '-'));
}

/** Where to look up real trains and buses (external sites; need internet). */
export function onwardLinks(from: LegEnd, to: LegEnd): { google: string; rome2rio: string; omio: string; skyscanner: string } {
  const ll = (p: LegEnd) => `${round4(p.lat)},${round4(p.lng)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=transit`,
    rome2rio: `https://www.rome2rio.com/map/${rome2rioName(from)}/${rome2rioName(to)}`,
    omio: 'https://www.omio.com/',
    skyscanner: 'https://www.skyscanner.ca/',
  };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A gateway airport as a leg end ('Madrid', MAD). */
export function airportEnd(code: string): LegEnd | null {
  const d = findDestination(code);
  if (d) return { name: d.city, lat: d.lat, lng: d.lng, code: d.code, tz: d.tz };
  const h = findHub(code);
  if (h) return { name: hubDisplayName(h.code), lat: h.lat, lng: h.lng, code: h.code, tz: h.tz };
  return null;
}

/** A place as a leg end. */
export function placeEnd(p: Place): LegEnd {
  const end: LegEnd = { name: p.name, lat: p.lat, lng: p.lng, tz: p.tz };
  if (p.acCode) end.code = p.acCode;
  return end;
}
