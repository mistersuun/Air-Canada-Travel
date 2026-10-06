/**
 * Trips persistence (spec §1.1): localStorage['ac.trips.v1'] and
 * localStorage['ac.flightlog.v1'], every access in try/catch.
 *
 * - Sanitising never throws: invalid legs and trips are dropped, party is
 *   clamped and defaults are filled. sanitizeTrip() is shared by migration,
 *   backup import and share decoding.
 * - A file written by a newer app version (schema > TRIPS_SCHEMA) is shown
 *   read-only and never overwritten.
 * - Corrupt JSON loads as an empty file; the raw text is copied to
 *   ac.trips.corrupt (ac.flightlog.corrupt) first, so nothing is lost. The
 *   same copy is made when valid JSON loses trips, legs, notes or outcomes to
 *   sanitising, or carries a schema that is not a number, before the next
 *   save can overwrite it.
 */
import { InjectionToken } from '@angular/core';
import { isDateKey, isValidTimeZone } from '../utils/time';
import {
  Alternate, FLIGHTLOG_CORRUPT_KEY, FLIGHTLOG_KEY, FlightLeg, FlightLog, FlightRef, GROUND_MODES, GroundLeg,
  GroundMode, GroundTimes, LEG_STATUSES, LegEnd, LegStatus, LoadNote, OUTCOME_KINDS, Outcome, OutcomeKind,
  PendingChange, Place, PrepState, TRIPS_CORRUPT_KEY, TRIPS_KEY, TRIPS_SCHEMA, Trip, TripLeg, TripsFile,
  emptyFlightLog, emptyTripsFile,
} from './model';

/** Storage backing trips and the flight log. Tests provide MemoryStorage, or null for "blocked". */
export const TRIPS_STORAGE = new InjectionToken<Storage | null>('TRIPS_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null; // SecurityError when site data is blocked
    }
  },
});

// ── Primitive guards ────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE = /^[A-Z0-9]{3}$/;
const MAX_TEXT = 2000;

function obj(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}
function str(v: unknown, fallback = '', max = MAX_TEXT): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}
function nonEmpty(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() ? v.slice(0, max) : null;
}
/** A non-empty, loadable IANA zone (max 64 chars), else null: bad zones would throw later in toUtcMs. */
function validTz(v: unknown): string | null {
  const tz = nonEmpty(v, 64);
  return tz && isValidTimeZone(tz) ? tz : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function iso(v: unknown): string | null {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
}
function hhmm(v: unknown): string | null {
  return typeof v === 'string' && HHMM.test(v) ? v : null;
}
function dateKey(v: unknown): string | null {
  return isDateKey(v) ? v : null;
}
function code(v: unknown): string | null {
  return typeof v === 'string' && CODE.test(v) ? v : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = num(v);
  return n === null ? fallback : Math.min(max, Math.max(min, Math.round(n)));
}
function latLng(v: unknown, lim: number): number | null {
  const n = num(v);
  return n !== null && Math.abs(n) <= lim ? n : null;
}

// ── Entities ────────────────────────────────────────────────────────────────

export function sanitizePlace(raw: unknown): Place | null {
  const r = obj(raw);
  if (!r) return null;
  const id = nonEmpty(r['id'], 40);
  const name = nonEmpty(r['name'], 120);
  const lat = latLng(r['lat'], 90);
  const lng = latLng(r['lng'], 180);
  if (!id || !name || lat === null || lng === null) return null;
  const p: Place = {
    id, name,
    country: str(r['country'], '', 120),
    iso2: typeof r['iso2'] === 'string' && /^[A-Z]{2}$/.test(r['iso2']) ? r['iso2'] : '',
    lat, lng,
    tz: validTz(r['tz']),
  };
  const admin1 = nonEmpty(r['admin1'], 120);
  if (admin1) p.admin1 = admin1;
  const ac = code(r['acCode']);
  if (ac) p.acCode = ac;
  return p;
}

export function sanitizeRef(raw: unknown): FlightRef | null {
  const r = obj(raw);
  if (!r) return null;
  const flightNumber = nonEmpty(r['flightNumber'], 12);
  const origin = code(r['origin']);
  const dest = code(r['dest']);
  const dk = dateKey(r['dateKey']);
  const dep = hhmm(r['depLocal']);
  const arrL = hhmm(r['arrLocal']);
  const arrK = dateKey(r['arrDateKey']);
  if (!flightNumber || !origin || !dest || !dk || !dep || !arrL || !arrK) return null;
  return {
    flightNumber, origin, dest, dateKey: dk, depLocal: dep, arrLocal: arrL, arrDateKey: arrK,
    aircraft: nonEmpty(r['aircraft'], 8),
  };
}

function sanitizeRefs(raw: unknown): FlightRef[] | null {
  const list = arr(raw).slice(0, 4);
  const refs = list.map(sanitizeRef);
  if (!refs.length || refs.some(r => !r)) return null;
  return refs as FlightRef[];
}

function sanitizeEnd(raw: unknown): LegEnd | null {
  const r = obj(raw);
  if (!r) return null;
  const name = nonEmpty(r['name'], 120);
  const lat = latLng(r['lat'], 90);
  const lng = latLng(r['lng'], 180);
  if (!name || lat === null || lng === null) return null;
  const e: LegEnd = { name, lat, lng };
  const c = code(r['code']);
  if (c) e.code = c;
  if (r['tz'] === null || typeof r['tz'] === 'string') e.tz = validTz(r['tz']);
  return e;
}

function sanitizeTimes(raw: unknown): GroundTimes | null {
  const r = obj(raw);
  if (!r) return null;
  const a = dateKey(r['depDateKey']), b = hhmm(r['depLocal']), c = dateKey(r['arrDateKey']), d = hhmm(r['arrLocal']);
  return a && b && c && d ? { depDateKey: a, depLocal: b, arrDateKey: c, arrLocal: d } : null;
}

function status(v: unknown): LegStatus {
  return LEG_STATUSES.includes(v as LegStatus) ? (v as LegStatus) : 'planned';
}

function sanitizeAlternate(raw: unknown): Alternate | null {
  const r = obj(raw);
  const refs = r && sanitizeRefs(r['refs']);
  const id = r && nonEmpty(r['id'], 40);
  if (!r || !refs || !id) return null;
  return { id, refs, addedAt: iso(r['addedAt']) ?? new Date(0).toISOString() };
}

export function sanitizeLeg(raw: unknown): TripLeg | null {
  const r = obj(raw);
  if (!r) return null;
  const id = nonEmpty(r['id'], 40);
  if (!id) return null;
  const base = { id, status: status(r['status']), statusAt: iso(r['statusAt']), note: str(r['note']) };
  if (r['kind'] === 'flight') {
    const refs = sanitizeRefs(r['refs']);
    if (!refs) return null;
    const roles: FlightLeg['role'][] = ['outbound', 'return', 'positioning', 'onward'];
    const leg: FlightLeg = {
      ...base,
      kind: 'flight',
      role: roles.includes(r['role'] as FlightLeg['role']) ? (r['role'] as FlightLeg['role']) : 'outbound',
      refs,
      provenance: r['provenance'] === 'unknown' ? 'unknown' : 'scheduled',
      alternates: arr(r['alternates']).slice(0, 20).map(sanitizeAlternate).filter((a): a is Alternate => !!a),
    };
    return leg;
  }
  if (r['kind'] === 'ground') {
    const from = sanitizeEnd(r['from']);
    const to = sanitizeEnd(r['to']);
    const dk = dateKey(r['dateKey']);
    if (!from || !to || !dk) return null;
    const userTimes = sanitizeTimes(r['userTimes']);
    const est = num(r['estMinutes']);
    const provs: GroundLeg['provenance'][] = ['estimated', 'saved', 'unknown'];
    let provenance = provs.includes(r['provenance'] as GroundLeg['provenance'])
      ? (r['provenance'] as GroundLeg['provenance']) : 'estimated';
    if (provenance === 'saved' && !userTimes) provenance = est === null ? 'unknown' : 'estimated';
    if (provenance === 'estimated' && est === null) provenance = 'unknown';
    const leg: GroundLeg = {
      ...base,
      kind: 'ground',
      mode: GROUND_MODES.includes(r['mode'] as GroundMode) ? (r['mode'] as GroundMode) : 'other',
      from, to, dateKey: dk,
      estMinutes: est !== null && est >= 0 ? Math.round(est) : null,
      provenance,
      userTimes,
    };
    return leg;
  }
  return null;
}

function sanitizeChange(raw: unknown): PendingChange | null {
  const r = obj(raw);
  if (!r) return null;
  const id = nonEmpty(r['id'], 40);
  const legId = nonEmpty(r['legId'], 40);
  const old = sanitizeRef(r['old']);
  const kinds = ['retimed', 'notFound', 'outsideCoverage'];
  if (!id || !legId || !old || !kinds.includes(r['kind'] as string)) return null;
  const next = r['next'] == null ? null : sanitizeRef(r['next']);
  const kind = r['kind'] as PendingChange['kind'];
  if (kind === 'retimed' && !next) return null;
  const states = ['open', 'accepted', 'kept'];
  return {
    id, legId,
    refIndex: int(r['refIndex'], 0, 3, 0),
    kind, old, next,
    generatedAt: nonEmpty(r['generatedAt'], 40),
    detectedAt: iso(r['detectedAt']) ?? new Date(0).toISOString(),
    state: states.includes(r['state'] as string) ? (r['state'] as PendingChange['state']) : 'open',
  };
}

/** Coerces anything into a valid Trip, or null when it cannot be one. Never throws. */
export function sanitizeTrip(raw: unknown): Trip | null {
  try {
    const r = obj(raw);
    if (!r) return null;
    const id = nonEmpty(r['id'], 40);
    const goal = sanitizePlace(r['goal']);
    const fromHub = code(r['fromHub']);
    const outboundDate = dateKey(r['outboundDate']);
    const hb = obj(r['homeBy']);
    const homeBy = hb && dateKey(hb['dateKey']) && hhmm(hb['hhmm'])
      ? { dateKey: hb['dateKey'] as string, hhmm: hb['hhmm'] as string } : null;
    if (!id || !goal || !fromHub || !outboundDate || !homeBy) return null;

    const p = obj(r['party']) ?? {};
    const prep: Record<string, PrepState> = {};
    const rp = obj(r['prep']);
    if (rp) {
      for (const [k, v] of Object.entries(rp).slice(0, 200)) {
        const s = obj(v);
        if (s && typeof s['done'] === 'boolean') prep[k.slice(0, 120)] = { done: s['done'], at: iso(s['at']) ?? new Date(0).toISOString() };
      }
    }
    const legs = arr(r['legs']).slice(0, 60).map(sanitizeLeg).filter((l): l is TripLeg => !!l);
    const legIds = new Set<string>();
    const uniqueLegs = legs.filter(l => !legIds.has(l.id) && legIds.add(l.id));
    const now = new Date(0).toISOString();
    const createdAt = iso(r['createdAt']) ?? now;
    const shared = obj(r['sharedFrom']);
    return {
      v: 1,
      id,
      name: nonEmpty(r['name'], 120) ?? `${goal.name} trip`,
      createdAt,
      updatedAt: iso(r['updatedAt']) ?? createdAt,
      goal,
      party: {
        count: int(p['count'], 1, 9, 1),
        stayTogether: typeof p['stayTogether'] === 'boolean' ? p['stayTogether'] : true,
        splitNote: str(p['splitNote'], '', 500),
      },
      fromHub,
      homeAirport: code(r['homeAirport']) ?? fromHub,
      outboundDate,
      homeBy,
      legs: uniqueLegs,
      prep,
      customPrep: arr(r['customPrep']).slice(0, 50).map(c => {
        const o = obj(c);
        const cid = o && nonEmpty(o['id'], 40);
        const text = o && nonEmpty(o['text'], 300);
        return cid && text ? { id: cid, text } : null;
      }).filter((c): c is { id: string; text: string } => !!c),
      changes: arr(r['changes']).slice(0, 100).map(sanitizeChange)
        .filter((c): c is PendingChange => !!c && legIds.has(c.legId)),
      scheduleGeneratedAt: nonEmpty(r['scheduleGeneratedAt'], 40),
      offlineSavedAt: iso(r['offlineSavedAt']),
      calendarExportedAt: iso(r['calendarExportedAt']),
      ...(Array.isArray(r['calendarRefs'])
        ? { calendarRefs: arr(r['calendarRefs']).filter((k): k is string => typeof k === 'string').map(k => k.slice(0, 80)).slice(0, 200) }
        : {}),
      sharedFrom: shared && iso(shared['at']) ? { at: shared['at'] as string } : null,
      archived: r['archived'] === true,
    };
  } catch {
    return null;
  }
}

export function sanitizeLoadNote(raw: unknown): LoadNote | null {
  const r = obj(raw);
  if (!r) return null;
  const id = nonEmpty(r['id'], 40);
  const flightNumber = nonEmpty(r['flightNumber'], 12);
  const origin = code(r['origin']);
  const dest = code(r['dest']);
  const dk = dateKey(r['dateKey']);
  const at = iso(r['at']);
  if (!id || !flightNumber || !origin || !dest || !dk || !at) return null;
  const count = (v: unknown) => { const n = num(v); return n === null || n < 0 ? null : Math.min(999, Math.round(n)); };
  return { id, flightNumber, origin, dest, dateKey: dk, open: count(r['open']), listed: count(r['listed']), text: str(r['text'], '', 500), at };
}

export function sanitizeOutcome(raw: unknown): Outcome | null {
  const r = obj(raw);
  if (!r) return null;
  const id = nonEmpty(r['id'], 40);
  const flightNumber = nonEmpty(r['flightNumber'], 12);
  const origin = code(r['origin']);
  const dest = code(r['dest']);
  const dk = dateKey(r['dateKey']);
  const recordedAt = iso(r['recordedAt']);
  if (!id || !flightNumber || !origin || !dest || !dk || !recordedAt || !OUTCOME_KINDS.includes(r['kind'] as OutcomeKind)) return null;
  return {
    id, flightNumber, origin, dest, dateKey: dk,
    kind: r['kind'] as OutcomeKind,
    partySize: int(r['partySize'], 1, 9, 1),
    tripId: nonEmpty(r['tripId'], 40),
    note: str(r['note'], '', 500),
    recordedAt,
  };
}

function uniqueById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter(x => !seen.has(x.id) && seen.add(x.id));
}

// ── Files ───────────────────────────────────────────────────────────────────

function schemaOf(r: Rec | null): number | null {
  if (!r || r['schema'] === undefined) return null;
  return typeof r['schema'] === 'number' ? r['schema'] : NaN;
}

/** Parsed JSON → a valid TripsFile. readOnly when a newer app version wrote it. Never throws. */
export function migrateTrips(raw: unknown): { file: TripsFile; readOnly: boolean } {
  const r = obj(raw);
  const schema = schemaOf(r);
  const readOnly = schema !== null && schema > TRIPS_SCHEMA;
  const trips = uniqueById(arr(r?.['trips']).map(sanitizeTrip).filter((t): t is Trip => !!t));
  return { file: { schema: 1, trips }, readOnly };
}

/** Parsed JSON → a valid FlightLog. Never throws. */
export function migrateFlightLog(raw: unknown): { file: FlightLog; readOnly: boolean } {
  const r = obj(raw);
  const schema = schemaOf(r);
  const readOnly = schema !== null && schema > TRIPS_SCHEMA;
  return {
    file: {
      schema: 1,
      notes: uniqueById(arr(r?.['notes']).map(sanitizeLoadNote).filter((n): n is LoadNote => !!n)),
      outcomes: uniqueById(arr(r?.['outcomes']).map(sanitizeOutcome).filter((o): o is Outcome => !!o)),
      dismissed: [...new Set(arr(r?.['dismissed']).filter((k): k is string => typeof k === 'string').map(k => k.slice(0, 80)))].slice(-500),
    },
    readOnly,
  };
}

function load<T>(
  storage: Storage | null,
  key: string,
  corruptKey: string,
  migrate: (raw: unknown) => { file: T; readOnly: boolean },
  empty: () => T,
  lossy: (raw: unknown, file: T) => boolean = () => false,
): { file: T; readOnly: boolean } {
  let text: string | null = null;
  try {
    text = storage?.getItem(key) ?? null;
  } catch {
    return { file: empty(), readOnly: false };
  }
  if (text === null) return { file: empty(), readOnly: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      storage?.setItem(corruptKey, text);
    } catch {
      // Blocked or full: nothing more we can do; the next save will overwrite.
    }
    return { file: empty(), readOnly: false };
  }
  const out = migrate(parsed);
  const schema = schemaOf(obj(parsed));
  if ((schema !== null && Number.isNaN(schema)) || lossy(parsed, out.file)) {
    try {
      storage?.setItem(corruptKey, text);
    } catch {
      // Blocked or full: nothing more we can do.
    }
  }
  return out;
}

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** True when sanitising dropped a trip or a leg that the raw file had. */
export function tripsLossy(raw: unknown, file: TripsFile): boolean {
  const trips = arr(obj(raw)?.['trips']);
  if (trips.length > file.trips.length) return true;
  const rawLegs = trips.reduce<number>((n, t) => n + count(obj(t)?.['legs']), 0);
  const legs = file.trips.reduce((n, t) => n + t.legs.length, 0);
  return rawLegs > legs;
}

/** True when sanitising dropped a load note or an outcome. */
export function flightLogLossy(raw: unknown, file: FlightLog): boolean {
  const r = obj(raw);
  return count(r?.['notes']) > file.notes.length || count(r?.['outcomes']) > file.outcomes.length;
}

function save(storage: Storage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadTrips(storage: Storage | null): { file: TripsFile; readOnly: boolean } {
  return load(storage, TRIPS_KEY, TRIPS_CORRUPT_KEY, migrateTrips, emptyTripsFile, tripsLossy);
}

/** Writes the trips file. False when storage is blocked or full (the app keeps it in memory). */
export function saveTrips(storage: Storage | null, file: TripsFile): boolean {
  return save(storage, TRIPS_KEY, file);
}

export function loadFlightLog(storage: Storage | null): { file: FlightLog; readOnly: boolean } {
  return load(storage, FLIGHTLOG_KEY, FLIGHTLOG_CORRUPT_KEY, migrateFlightLog, emptyFlightLog, flightLogLossy);
}

export function saveFlightLog(storage: Storage | null, log: FlightLog): boolean {
  return save(storage, FLIGHTLOG_KEY, log);
}
