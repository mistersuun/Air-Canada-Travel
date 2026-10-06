/**
 * Trips v2 data model (spec §1). Plain JSON-safe types: everything here is
 * persisted to localStorage, exported in backups and encoded in share links.
 *
 * Times: flight times stay origin/dest-local (FlightRef local fields), user
 * timestamps are ISO instants, and `homeBy` is wall-clock at `homeAirport`.
 */
export const TRIPS_KEY = 'ac.trips.v1';          // { schema, trips }
export const FLIGHTLOG_KEY = 'ac.flightlog.v1';  // { schema, notes, outcomes, dismissed }
export const TRIPS_CORRUPT_KEY = 'ac.trips.corrupt';
export const FLIGHTLOG_CORRUPT_KEY = 'ac.flightlog.corrupt';
export const TRIPS_SCHEMA = 1;

export type Provenance = 'scheduled' | 'estimated' | 'saved' | 'unknown';
export const PROVENANCE_LABEL: Record<Provenance, string> =
  { scheduled: 'Scheduled', estimated: 'Estimated', saved: 'Saved by you', unknown: 'Unknown' };

export type LegStatus = 'planned' | 'listed' | 'checkedIn' | 'boarded' | 'notBoarded' | 'didntTry' | 'abandoned';
export const LEG_STATUS_LABEL: Record<LegStatus, string> = {
  planned: 'Planned', listed: 'Listed', checkedIn: 'Checked in', boarded: 'Boarded',
  notBoarded: 'Not boarded', didntTry: "Didn't try", abandoned: 'Dropped',
};
export const LEG_STATUSES: readonly LegStatus[] =
  ['planned', 'listed', 'checkedIn', 'boarded', 'notBoarded', 'didntTry', 'abandoned'];
/** Statuses after which a leg is "done" (no more prompts, excluded from Today's "next flight"). */
export const FINAL_STATUSES: readonly LegStatus[] = ['boarded', 'notBoarded', 'didntTry', 'abandoned'];

export function isFinalStatus(s: LegStatus): boolean {
  return FINAL_STATUSES.includes(s);
}

/** A place the traveller wants to reach. id: 'gn-<geonameId>' (GeoNames) or 'ac-<IATA>' (an AC destination/hub). */
export interface Place {
  id: string;
  name: string;            // 'Seville'
  country: string;         // English country name, 'Spain'
  iso2: string;            // 'ES'
  lat: number;
  lng: number;
  tz: string | null;       // IANA, from GeoNames or the AC airport
  admin1?: string;         // region name when known ('Andalusia'); optional
  acCode?: string;         // set when AC flies to this place itself (ac-LIS → 'LIS')
}

export interface Party {
  count: number;           // 1..9
  stayTogether: boolean;   // "stay together" = same flight, not adjacent seats
  splitNote: string;       // "If we split up" note, shared with companions
}

/** A snapshot of one scheduled flight instance, enough to show it offline and to diff it later. */
export interface FlightRef {
  flightNumber: string;    // 'AC834'
  origin: string;          // 'YUL'
  dest: string;            // 'MAD'
  dateKey: string;         // local departure date at origin
  depLocal: string;        // 'HH:MM' origin-local
  arrLocal: string;        // 'HH:MM' dest-local
  arrDateKey: string;      // local arrival date
  aircraft: string | null; // IATA equipment code
}

export interface GroundTimes { depDateKey: string; depLocal: string; arrDateKey: string; arrLocal: string }
export type GroundMode = 'train' | 'bus' | 'car' | 'ferry' | 'flight' | 'other';
export const GROUND_MODES: readonly GroundMode[] = ['train', 'bus', 'car', 'ferry', 'flight', 'other'];
export interface LegEnd { name: string; lat: number; lng: number; code?: string; tz?: string | null }

interface LegBase {
  id: string;
  status: LegStatus;
  statusAt: string | null;           // ISO instant of the last status change
  note: string;                      // free text (shown as "your note")
}

export interface FlightLeg extends LegBase {
  kind: 'flight';
  role: 'outbound' | 'return' | 'positioning' | 'onward';
  /** 1 entry for a nonstop, 2 for a one-stop itinerary (each segment is its own standby leg). */
  refs: FlightRef[];
  /** 'scheduled' when resolved in current data; 'unknown' when not found / outside coverage (set by change detection). */
  provenance: 'scheduled' | 'unknown';
  /** Backups folded under this leg (each an itinerary as refs). */
  alternates: Alternate[];
}

export interface GroundLeg extends LegBase {
  kind: 'ground';
  mode: GroundMode;
  from: LegEnd;
  to: LegEnd;
  dateKey: string;                   // planned day (local at `from`)
  estMinutes: number | null;         // door-to-door estimate incl. airport exit; null = unknown
  provenance: 'estimated' | 'saved' | 'unknown';
  userTimes: GroundTimes | null;     // set when the user saved a real train/bus → provenance 'saved'
}

export type TripLeg = FlightLeg | GroundLeg;

export interface Alternate { id: string; refs: FlightRef[]; addedAt: string }

export interface PrepState { done: boolean; at: string }   // keyed by PrepItem.id

export type ChangeKind = 'retimed' | 'notFound' | 'outsideCoverage';
export interface PendingChange {
  id: string;
  legId: string;
  refIndex: number;                  // which segment of the leg
  kind: ChangeKind;
  old: FlightRef;
  next: FlightRef | null;            // null for notFound / outsideCoverage
  generatedAt: string | null;        // schedules meta.generatedAt that produced it
  detectedAt: string;
  state: 'open' | 'accepted' | 'kept';
}

export interface Trip {
  v: 1;
  id: string;                        // 10 chars base36 from crypto.getRandomValues
  name: string;                      // 'Seville trip'
  createdAt: string; updatedAt: string;
  goal: Place;
  party: Party;
  fromHub: string;                   // 'YUL', one of HUBS
  homeAirport: string;               // where "home" is; defaults to fromHub
  outboundDate: string;              // dateKey
  homeBy: { dateKey: string; hhmm: string };   // local at homeAirport's tz
  legs: TripLeg[];                   // chronological; replaced legs stay (status notBoarded/abandoned)
  prep: Record<string, PrepState>;
  /** `usual`: copied from the travel profile's usual items; never leaves the device in a share link. */
  customPrep: { id: string; text: string; usual?: true }[];
  changes: PendingChange[];
  scheduleGeneratedAt: string | null; // meta.generatedAt last compared against
  offlineSavedAt: string | null;
  calendarExportedAt: string | null;
  /** calendarKey() of every flight in the last calendar export (absent on trips exported before this was kept). */
  calendarRefs?: string[];
  sharedFrom: { at: string } | null; // set on an imported shared copy
  archived: boolean;
}

export interface LoadNote {
  id: string;
  flightNumber: string; origin: string; dest: string; dateKey: string;
  open: number | null;               // seats open, as the user read them
  listed: number | null;             // people listed
  text: string;
  at: string;                        // ISO instant written
}

export type OutcomeKind = 'allBoarded' | 'someBoarded' | 'noneBoarded' | 'didntTry';
export const OUTCOME_LABEL: Record<OutcomeKind, string> =
  { allBoarded: 'Everyone boarded', someBoarded: 'Some of us', noneBoarded: "Didn't board", didntTry: "Didn't try" };
export const OUTCOME_KINDS: readonly OutcomeKind[] = ['allBoarded', 'someBoarded', 'noneBoarded', 'didntTry'];

export interface Outcome {
  id: string;
  flightNumber: string; origin: string; dest: string; dateKey: string;
  kind: OutcomeKind;
  partySize: number;
  tripId: string | null;
  note: string;
  recordedAt: string;
}

export interface FlightLog { schema: 1; notes: LoadNote[]; outcomes: Outcome[]; dismissed: string[] /* prompt keys */ }
export interface TripsFile { schema: 1; trips: Trip[] }

/** Input of TripsService.create. */
export interface NewTrip {
  goal: Place;
  fromHub: string;
  outboundDate: string;
  homeBy: { dateKey: string; hhmm: string };
  party?: Partial<Party>;
  legs?: TripLeg[];
  name?: string;
  homeAirport?: string;
}

/** A decoded share link, before the user saves it. */
export interface SharedTripPreview { trip: Trip; notes: LoadNote[]; sharedAt: string }

/** Key of a flight instance, for notes/outcomes/prompts: 'AC834|YUL|2026-10-08'. */
/** A flight as it was written to a calendar file: number, route, date and times. */
export function calendarKey(r: FlightRef): string {
  return `${r.flightNumber}|${r.origin}|${r.dest}|${r.dateKey} ${r.depLocal}|${r.arrDateKey} ${r.arrLocal}`;
}

export function instanceKey(r: { flightNumber: string; origin: string; dateKey: string }): string {
  return `${r.flightNumber}|${r.origin}|${r.dateKey}`;
}

export function emptyTripsFile(): TripsFile {
  return { schema: 1, trips: [] };
}

export function emptyFlightLog(): FlightLog {
  return { schema: 1, notes: [], outcomes: [], dismissed: [] };
}

/** 'Seville trip'. */
export function defaultTripName(goal: Place): string {
  return `${goal.name} trip`;
}
