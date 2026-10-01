/**
 * Trips and the flight log as signals, plus every action the trip screens
 * take (spec §1.4). Persists to TRIPS_STORAGE after each change; works in
 * memory when storage is blocked; never writes a file a newer app version
 * produced (readOnly).
 *
 * Schedule changes are proposals (PendingChange): checkChanges() records
 * them, and nothing in a plan changes until acceptChange().
 */
import { DOCUMENT, Injectable, Injector, Signal, computed, inject, signal } from '@angular/core';
import { getSchedulesMeta } from '../data/schedule-index';
import { findDestination, findHub } from '../utils/airports';
import type { Itinerary } from '../utils/connections';
import { AppStateService, NOW } from '../state/app-state.service';
import { deadlineUtc } from './engine/homeby';
import { changeKey, detectChanges, looksLikeBadData, refreshAircraft, scanTrip } from './engine/changes';
import { refsFromItinerary, sameRefs, sortLegs } from './engine/legs';
import { OutcomePrompt, pendingOutcomePrompts } from './engine/today';
import { backupFilename, exportBackup, mergeBackup, parseBackup } from './export';
import { newId } from './ids';
import {
  Alternate, FlightLeg, FlightLog, GroundLeg, GroundMode, GroundTimes, LegEnd, LegStatus, LoadNote, NewTrip,
  Outcome, OutcomeKind, SharedTripPreview, Trip, TripLeg, TripsFile, defaultTripName, instanceKey, isFinalStatus,
} from './model';
import { decodeTripShare, encodeTripShare, shareUrl } from './share-codec';
import { TRIPS_STORAGE, loadFlightLog, loadTrips, saveFlightLog, saveTrips, sanitizeLeg } from './storage';

/** What swapLeg needs from a ground estimate (places/ground GroundEstimate fits). */
export interface GroundEstimateLike {
  mode: GroundMode | 'unknown';
  totalMin: number | null;
  provenance: 'estimated' | 'unknown';
}

export const BAD_DATA_NOTICE = 'The latest schedules look incomplete. Your plans are unchanged.';

/** Leg status an outcome implies for the traveller's own leg. */
export const OUTCOME_STATUS: Record<OutcomeKind, LegStatus> = {
  allBoarded: 'boarded', someBoarded: 'boarded', noneBoarded: 'notBoarded', didntTry: 'didntTry',
};

@Injectable({ providedIn: 'root' })
export class TripsService {
  private readonly storage = inject(TRIPS_STORAGE);
  private readonly now = inject(NOW);
  private readonly injector = inject(Injector);
  private readonly doc = inject(DOCUMENT);

  private readonly file = signal<TripsFile>({ schema: 1, trips: [] });
  private readonly log = signal<FlightLog>({ schema: 1, notes: [], outcomes: [], dismissed: [] });
  private readonly readOnlyState = signal(false);
  /** Epoch ms of the last check (refreshes the time-based lists). */
  private readonly tick = signal(0);
  private badDataNoticeFor: string | null = null;

  /** All trips, newest outbound first. */
  readonly trips: Signal<Trip[]> = computed(() =>
    [...this.file().trips].sort((a, b) => b.outboundDate.localeCompare(a.outboundDate) || b.createdAt.localeCompare(a.createdAt)));
  /** Not archived and the home-by deadline is less than a day ago; soonest outbound first. */
  readonly activeTrips: Signal<Trip[]> = computed(() => {
    const now = this.tick();
    return this.trips().filter(t => isActive(t, now)).reverse();
  });
  readonly pastTrips: Signal<Trip[]> = computed(() => {
    const now = this.tick();
    return this.trips().filter(t => !isActive(t, now));
  });
  readonly readOnly: Signal<boolean> = this.readOnlyState.asReadonly();
  readonly notes: Signal<LoadNote[]> = computed(() => this.log().notes);
  readonly outcomes: Signal<Outcome[]> = computed(() => this.log().outcomes);
  readonly dismissed: Signal<string[]> = computed(() => this.log().dismissed);
  readonly pendingOutcomes: Signal<OutcomePrompt[]> = computed(() =>
    pendingOutcomePrompts(this.file().trips, this.log(), this.tick()));
  /** Set while the latest schedules look incomplete (see looksLikeBadData). */
  readonly scheduleNotice = signal<string | null>(null);

  constructor() {
    const t = loadTrips(this.storage);
    const l = loadFlightLog(this.storage);
    this.file.set(t.file);
    this.log.set(l.file);
    this.readOnlyState.set(t.readOnly || l.readOnly);
    this.tick.set(this.now());
    this.checkChanges();
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  trip(id: string): Trip | null {
    return this.file().trips.find(t => t.id === id) ?? null;
  }

  /** Load notes for a flight (or every flight of that origin/date when null), newest first. */
  notesFor(flightNumber: string | null, origin: string, dateKey: string): LoadNote[] {
    return this.log().notes
      .filter(n => n.origin === origin && n.dateKey === dateKey && (flightNumber === null || n.flightNumber === flightNumber))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  // ── Trips ─────────────────────────────────────────────────────────────────

  create(input: NewTrip): Trip {
    const at = this.iso();
    const trip: Trip = {
      v: 1,
      id: newId(),
      name: input.name?.trim() || defaultTripName(input.goal),
      createdAt: at,
      updatedAt: at,
      goal: input.goal,
      party: {
        count: Math.min(9, Math.max(1, Math.round(input.party?.count ?? 1))),
        stayTogether: input.party?.stayTogether ?? true,
        splitNote: input.party?.splitNote ?? '',
      },
      fromHub: input.fromHub,
      homeAirport: input.homeAirport ?? input.fromHub,
      outboundDate: input.outboundDate,
      homeBy: { ...input.homeBy },
      legs: sortLegs(input.legs ?? []),
      prep: {},
      customPrep: [],
      changes: [],
      scheduleGeneratedAt: getSchedulesMeta()?.generatedAt ?? null,
      offlineSavedAt: null,
      calendarExportedAt: null,
      sharedFrom: null,
      archived: false,
    };
    this.setTrips([...this.file().trips, trip]);
    return trip;
  }

  /** Replaces a trip with fn(trip), stamps updatedAt and persists. */
  update(id: string, fn: (t: Trip) => Trip): void {
    const cur = this.trip(id);
    if (!cur) return;
    const next = { ...fn(cur), id: cur.id, updatedAt: this.iso() };
    this.setTrips(this.file().trips.map(t => (t.id === id ? next : t)));
  }

  /** Deletes a trip, with Undo. */
  remove(id: string): void {
    const trips = this.file().trips;
    const idx = trips.findIndex(t => t.id === id);
    if (idx < 0) return;
    const removed = trips[idx];
    this.setTrips(trips.filter(t => t.id !== id));
    this.flash('Trip deleted', {
      label: 'Undo',
      run: () => {
        if (this.trip(id)) return;
        const list = [...this.file().trips];
        list.splice(Math.min(idx, list.length), 0, removed);
        this.setTrips(list);
      },
    });
  }

  // ── Legs ──────────────────────────────────────────────────────────────────

  /** Adds an itinerary as a flight leg (chronological). Returns the leg id ('' when the trip is unknown). */
  addFlightLeg(id: string, it: Itinerary, role: FlightLeg['role'], status: LegStatus = 'planned'): string {
    if (!this.trip(id) || !it.legs.length) return '';
    const leg: FlightLeg = {
      kind: 'flight', id: newId(), role, status, statusAt: status === 'planned' ? null : this.iso(), note: '',
      refs: refsFromItinerary(it), provenance: 'scheduled', alternates: [],
    };
    this.update(id, t => ({ ...t, legs: sortLegs([...t.legs, leg]) }));
    return leg.id;
  }

  addGroundLeg(id: string, g: Omit<GroundLeg, 'id' | 'status' | 'statusAt' | 'note'> & { note?: string }): string {
    if (!this.trip(id)) return '';
    const leg: GroundLeg = { ...g, kind: 'ground', id: newId(), status: 'planned', statusAt: null, note: g.note ?? '' };
    this.update(id, t => ({ ...t, legs: sortLegs([...t.legs, leg]) }));
    return leg.id;
  }

  /** Merges a patch into a leg (its id and kind stay). Invalid results are ignored. */
  updateLeg(id: string, legId: string, patch: Partial<FlightLeg> | Partial<GroundLeg>): void {
    this.mapLeg(id, legId, leg => {
      const next = sanitizeLeg({ ...leg, ...patch, id: leg.id, kind: leg.kind });
      return next ?? leg;
    });
  }

  setLegStatus(id: string, legId: string, status: LegStatus): void {
    this.mapLeg(id, legId, leg => (leg.status === status ? leg : { ...leg, status, statusAt: this.iso() }));
  }

  /** The user found the real train/bus: the leg becomes "Saved by you". */
  saveGroundTimes(id: string, legId: string, times: GroundTimes, mode: GroundMode, note: string): void {
    this.mapLeg(id, legId, leg => leg.kind !== 'ground' ? leg : {
      ...leg, mode, note, userTimes: { ...times }, dateKey: times.depDateKey, provenance: 'saved',
    });
  }

  addAlternate(id: string, legId: string, it: Itinerary): void {
    const refs = refsFromItinerary(it);
    if (!refs.length) return;
    this.mapLeg(id, legId, leg => {
      if (leg.kind !== 'flight' || sameRefs(leg.refs, refs) || leg.alternates.some(a => sameRefs(a.refs, refs))) return leg;
      const alt: Alternate = { id: newId(), refs, addedAt: this.iso() };
      return { ...leg, alternates: [...leg.alternates, alt] };
    });
  }

  removeAlternate(id: string, legId: string, altId: string): void {
    this.mapLeg(id, legId, leg => leg.kind !== 'flight' ? leg : { ...leg, alternates: leg.alternates.filter(a => a.id !== altId) });
  }

  /**
   * Recovery: the old leg becomes Not boarded (or Dropped when it was still
   * open), `it` is inserted as a new Planned leg with the remaining backups,
   * and the ground leg that left the old gateway is re-estimated from the
   * new one. Flashes "Swapped to AC812 · Listing is still your step" with Undo.
   */
  swapLeg(id: string, legId: string, it: Itinerary, ground: GroundEstimateLike | null): void {
    const before = this.trip(id);
    const old = before?.legs.find(l => l.id === legId);
    if (!before || !old || old.kind !== 'flight' || !it.legs.length) return;
    const refs = refsFromItinerary(it);
    const at = this.iso();
    const oldGateway = old.refs[old.refs.length - 1].dest;
    const newGateway = it.dest;
    const fresh: FlightLeg = {
      kind: 'flight', id: newId(), role: old.role, status: 'planned', statusAt: null, note: '',
      refs, provenance: 'scheduled',
      alternates: old.alternates.filter(a => !sameRefs(a.refs, refs)),
    };
    const arrDate = it.arrDateKey;

    this.update(id, t => {
      const legs = t.legs.map((l): TripLeg => {
        if (l.id === legId && l.kind === 'flight') {
          return isFinalStatus(l.status)
            ? { ...l, alternates: [] }
            : { ...l, status: 'abandoned', statusAt: at, alternates: [] };
        }
        if (l.kind === 'ground' && !isFinalStatus(l.status) && l.from.code === oldGateway) {
          return regroundLeg(l, newGateway, arrDate, oldGateway === newGateway, ground);
        }
        return l;
      });
      return { ...t, legs: sortLegs([...legs, fresh]), changes: t.changes.filter(c => c.legId !== legId || c.state !== 'open') };
    });

    const label = it.legs.map(l => l.flightNumber ?? 'an estimated leg').join(' + ');
    this.flash(`Swapped to ${label} · Listing is still your step`, {
      label: 'Undo',
      run: () => this.setTrips(this.file().trips.map(t => (t.id === id ? before : t))),
    });
  }

  // ── Prep ──────────────────────────────────────────────────────────────────

  setPrep(id: string, itemId: string, done: boolean): void {
    this.update(id, t => ({ ...t, prep: { ...t.prep, [itemId]: { done, at: this.iso() } } }));
  }

  addCustomPrep(id: string, text: string): void {
    const clean = text.trim().slice(0, 300);
    if (!clean) return;
    this.update(id, t => ({ ...t, customPrep: [...t.customPrep, { id: newId(), text: clean }] }));
  }

  removeCustomPrep(id: string, itemId: string): void {
    this.update(id, t => {
      const { [`custom:${itemId}`]: _drop, ...prep } = t.prep;
      return { ...t, customPrep: t.customPrep.filter(c => c.id !== itemId), prep };
    });
  }

  // ── Schedule changes ──────────────────────────────────────────────────────

  /** Applies a retime to the leg (the user accepted it). */
  acceptChange(id: string, changeId: string): void {
    this.update(id, t => {
      const c = t.changes.find(x => x.id === changeId);
      if (!c || c.state !== 'open') return t;
      const legs = t.legs.map(l => {
        if (l.id !== c.legId || l.kind !== 'flight' || !c.next || !l.refs[c.refIndex]) return l;
        const refs = l.refs.map((r, i) => (i === c.refIndex ? { ...c.next!, flightNumber: r.flightNumber } : r));
        return { ...l, refs, provenance: 'scheduled' as const };
      });
      return { ...t, legs, changes: t.changes.map(x => (x.id === changeId ? { ...x, state: 'accepted' as const } : x)) };
    });
  }

  /** Keeps the plan as it was; a leg not found becomes "Unknown". */
  keepChange(id: string, changeId: string): void {
    this.update(id, t => {
      const c = t.changes.find(x => x.id === changeId);
      if (!c || c.state !== 'open') return t;
      const legs = c.kind === 'retimed' ? t.legs : t.legs.map(l =>
        l.id === c.legId && l.kind === 'flight' ? { ...l, provenance: 'unknown' as const } : l);
      return { ...t, legs, changes: t.changes.map(x => (x.id === changeId ? { ...x, state: 'kept' as const } : x)) };
    });
  }

  /**
   * Compares every active trip with the current schedules. New findings are
   * stored as open changes (never applied); open ones that no longer hold are
   * dropped; aircraft are refreshed silently. When the data looks broken
   * (looksLikeBadData) nothing is stored and scheduleNotice says so.
   */
  checkChanges(): void {
    const now = this.now();
    this.tick.set(now);
    if (this.readOnlyState()) return;
    const nowIso = new Date(now).toISOString();
    const generatedAt = getSchedulesMeta()?.generatedAt ?? null;
    const active = this.file().trips.filter(t => isActive(t, now));
    if (!active.length) return;

    const found = active.flatMap(t => detectChanges(t, nowIso));
    if (looksLikeBadData(active, found)) {
      this.scheduleNotice.set(BAD_DATA_NOTICE);
      if (this.badDataNoticeFor !== generatedAt) {
        this.badDataNoticeFor = generatedAt;
        this.flash(BAD_DATA_NOTICE);
      }
      return;
    }
    this.scheduleNotice.set(null);

    let changed = false;
    const next = this.file().trips.map(trip => {
      if (!isActive(trip, now)) return trip;
      let t = refreshAircraft(trip);
      const { findings } = scanTrip(t);
      const current = new Set(findings.map(changeKey));
      const live = new Set(findings.map(f => `${f.legId}|${f.refIndex}`));
      // Open changes that no longer hold (data restored, or superseded by a newer finding) are dropped.
      const fresh = detectChanges(t, nowIso);
      const freshSlots = new Set(fresh.map(f => `${f.legId}|${f.refIndex}`));
      const kept = t.changes.filter(c => c.state !== 'open'
        || (current.has(changeKey(c)) && !freshSlots.has(`${c.legId}|${c.refIndex}`)));
      const changes = [...kept, ...fresh];
      const legs = t.legs.map(l => {
        if (l.kind !== 'flight' || isFinalStatus(l.status)) return l;
        const outside = findings.some(f => f.legId === l.id && f.kind === 'outsideCoverage');
        const keptNotFound = changes.some(c => c.legId === l.id && c.kind === 'notFound' && c.state === 'kept' && current.has(changeKey(c)));
        const anyLive = l.refs.some((_, i) => live.has(`${l.id}|${i}`));
        const provenance = outside || keptNotFound ? 'unknown' as const : !anyLive ? 'scheduled' as const : l.provenance;
        return provenance === l.provenance ? l : { ...l, provenance };
      });
      const sameChanges = changes.length === t.changes.length && changes.every((c, i) => c === t.changes[i]);
      const sameLegs = legs.every((l, i) => l === t.legs[i]);
      if (t === trip && sameChanges && sameLegs && trip.scheduleGeneratedAt === generatedAt) return trip;
      changed = true;
      t = { ...t, legs, changes, scheduleGeneratedAt: generatedAt };
      return t;
    });
    if (changed) this.setTrips(next);
  }

  // ── Flight log ────────────────────────────────────────────────────────────

  addLoadNote(n: Omit<LoadNote, 'id' | 'at'>): void {
    const note: LoadNote = { ...n, id: newId(), at: this.iso() };
    this.setLog({ ...this.log(), notes: [...this.log().notes, note] });
  }

  removeLoadNote(noteId: string): void {
    this.setLog({ ...this.log(), notes: this.log().notes.filter(n => n.id !== noteId) });
  }

  /**
   * Records how a flight went (replacing an earlier record for the same
   * flight and trip) and sets the matching trip leg's status. For a one-stop
   * leg, a boarding on the first segment leaves the leg open for the second.
   */
  recordOutcome(o: Omit<Outcome, 'id' | 'recordedAt'>): void {
    const key = instanceKey(o);
    const outcome: Outcome = { ...o, id: newId(), recordedAt: this.iso() };
    const outcomes = this.log().outcomes.filter(x => !(instanceKey(x) === key && x.tripId === o.tripId));
    this.setLog({ ...this.log(), outcomes: [...outcomes, outcome] });

    const status = OUTCOME_STATUS[o.kind];
    for (const trip of this.file().trips) {
      if (o.tripId && trip.id !== o.tripId) continue;
      const leg = trip.legs.find(l => l.kind === 'flight' && !isFinalStatus(l.status) && l.refs.some(r => instanceKey(r) === key));
      if (!leg || leg.kind !== 'flight') continue;
      const isLast = instanceKey(leg.refs[leg.refs.length - 1]) === key;
      if (isLast || status !== 'boarded') this.setLegStatus(trip.id, leg.id, status);
    }
  }

  removeOutcome(outcomeId: string): void {
    this.setLog({ ...this.log(), outcomes: this.log().outcomes.filter(o => o.id !== outcomeId) });
  }

  dismissOutcome(key: string): void {
    if (this.log().dismissed.includes(key)) return;
    this.setLog({ ...this.log(), dismissed: [...this.log().dismissed, key].slice(-500) });
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  exportBackup(): string {
    return exportBackup(this.file(), this.log(), this.now());
  }

  /** 'routes-trips-2026-10-01.json'. */
  backupFilename(): string {
    return backupFilename(this.now());
  }

  importBackup(text: string): { added: number; updated: number } | { error: string } {
    if (this.readOnlyState()) return { error: 'Your trips were saved by a newer version of the app, so they cannot be changed here.' };
    const parsed = parseBackup(text);
    if ('error' in parsed) return parsed;
    const merged = mergeBackup({ trips: this.file().trips, log: this.log() }, parsed);
    this.setTrips(merged.trips);
    this.setLog(merged.log);
    return { added: merged.added, updated: merged.updated };
  }

  // ── Sharing and offline ───────────────────────────────────────────────────

  /** The trip's load notes: every flight in its legs and backups. */
  tripNotes(trip: Trip): LoadNote[] {
    const keys = new Set<string>();
    for (const l of trip.legs) {
      if (l.kind !== 'flight') continue;
      for (const r of l.refs) keys.add(instanceKey(r));
      for (const a of l.alternates) for (const r of a.refs) keys.add(instanceKey(r));
    }
    return this.log().notes.filter(n => keys.has(instanceKey(n)));
  }

  /** `${origin}/trips/import#t=<payload>`; '' for an unknown trip. */
  async shareLink(id: string): Promise<string> {
    const trip = this.trip(id);
    if (!trip) return '';
    const payload = await encodeTripShare(trip, this.tripNotes(trip), this.now());
    const origin = this.doc.location?.origin && this.doc.location.origin !== 'null' ? this.doc.location.origin : '';
    return shareUrl(origin, payload);
  }

  decodeShared(payload: string): Promise<SharedTripPreview | null> {
    return decodeTripShare(payload);
  }

  /** Saves a shared trip as a new copy (new id, sharedFrom set) with its notes. */
  saveShared(preview: SharedTripPreview): Trip {
    const at = this.iso();
    const trip: Trip = {
      ...preview.trip,
      id: newId(),
      createdAt: at,
      updatedAt: at,
      prep: {},
      changes: [],
      offlineSavedAt: null,
      calendarExportedAt: null,
      archived: false,
      sharedFrom: { at: preview.sharedAt },
    };
    this.setTrips([...this.file().trips, trip]);
    const ids = new Set(this.log().notes.map(n => n.id));
    const notes = preview.notes.filter(n => !ids.has(n.id));
    if (notes.length) this.setLog({ ...this.log(), notes: [...this.log().notes, ...notes] });
    this.checkChanges();
    return this.trip(trip.id) ?? trip;
  }

  markOfflineSaved(id: string): void {
    this.update(id, t => ({ ...t, offlineSavedAt: this.iso() }));
  }

  markCalendarExported(id: string): void {
    this.update(id, t => ({ ...t, calendarExportedAt: this.iso() }));
  }

  archive(id: string, archived = true): void {
    this.update(id, t => ({ ...t, archived }));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private mapLeg(id: string, legId: string, fn: (leg: TripLeg) => TripLeg): void {
    const trip = this.trip(id);
    const leg = trip?.legs.find(l => l.id === legId);
    if (!trip || !leg) return;
    const next = fn(leg);
    if (next === leg) return;
    this.update(id, t => ({ ...t, legs: sortLegs(t.legs.map(l => (l.id === legId ? next : l))) }));
  }

  private setTrips(trips: Trip[]): void {
    const file: TripsFile = { schema: 1, trips };
    this.file.set(file);
    if (!this.readOnlyState()) saveTrips(this.storage, file);
  }

  private setLog(log: FlightLog): void {
    this.log.set(log);
    if (!this.readOnlyState()) saveFlightLog(this.storage, log);
  }

  private flash(message: string, action?: { label: string; run: () => void }): void {
    try {
      this.injector.get(AppStateService).flash(message, action);
    } catch {
      // No shell (unit tests without a router): the change itself still happened.
    }
  }
}

/** Not archived and the deadline is less than a day ago. */
export function isActive(t: Trip, nowMs: number): boolean {
  return !t.archived && deadlineUtc(t.homeBy, t.homeAirport) > nowMs - 86_400_000;
}

/** A ground leg after its flight leg changed gateway (see swapLeg). */
function regroundLeg(
  leg: GroundLeg, gateway: string, arrDate: string, sameGateway: boolean, ground: GroundEstimateLike | null,
): GroundLeg {
  if (sameGateway) {
    return leg.provenance === 'saved' ? leg : { ...leg, dateKey: arrDate };
  }
  const d = findDestination(gateway);
  const h = findHub(gateway);
  const from: LegEnd = {
    name: d?.city ?? h?.name ?? gateway, code: gateway,
    lat: d?.lat ?? h?.lat ?? leg.from.lat, lng: d?.lng ?? h?.lng ?? leg.from.lng,
    tz: d?.tz ?? h?.tz ?? null,
  };
  const known = ground && ground.mode !== 'unknown' && ground.totalMin !== null && ground.provenance === 'estimated';
  return {
    ...leg,
    from,
    dateKey: arrDate,
    mode: known ? (ground!.mode as GroundMode) : 'other',
    estMinutes: known ? ground!.totalMin : null,
    provenance: known ? 'estimated' : 'unknown',
    userTimes: null,
  };
}
