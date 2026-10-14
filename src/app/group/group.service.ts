import { Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { SharedTripPreview, Trip } from '../trips/model';
import { decodeTripShare, encodeTripShare } from '../trips/share-codec';
import { TripsService } from '../trips/trips.service';
import {
  type GroupLink, buildGroupLink, decryptText, encryptText, generateGroupKey, newGroupId, newMemberId, newOwnerToken, newWriteToken,
} from './group-crypto';
import { type GroupDoc, type MemberStatus, capMembers, forGroup, groupExpiry, mergeGroupDocs, parseGroupDoc, serializeGroupDoc } from './group-doc';

export const GROUP_ENDPOINT = '/.netlify/functions/group';
const STORAGE_KEY = 'ac.groups.v1';
const MAX_CIPHERTEXT = 96 * 1024;
export const POLL_MS = 120_000;

/** What this device remembers about a group (the link's fragment is dropped by the router). */
export interface GroupRecord {
  id: string;
  key: string;
  write: string | null;
  memberId: string;
  name: string;
  /** True when this device created the group ("Stop sharing" is offered). */
  owner: boolean;
  /** Proof of ownership for delete and a longer expiry; only on the creating device, never in a link. Null on groups made before it existed. */
  ownerToken: string | null;
  tripId: string | null;
  /** When the server will delete it (ISO), so expired entries can be dropped from this device. */
  expiresAt: string | null;
}

export type GroupFailure = 'unavailable' | 'gone' | 'invalid' | 'forbidden' | 'too-large' | 'budget';
export type LoadResult = { ok: true; doc: GroupDoc; version: number; expiresAt: string | null } | { ok: false; reason: GroupFailure };
export type SaveResult = { ok: true; doc: GroupDoc; version: number; expiresAt: string | null } | { ok: false; reason: GroupFailure };

interface Reply { status: number; json: Record<string, unknown> | null }

/**
 * Group trips: end-to-end encrypted. Everything the server sees is ciphertext;
 * the key stays in the link fragment (and in this device's storage so a
 * reload still works). All requests go to the same-origin function.
 */
@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly trips = inject(TripsService);
  private readonly doc = inject(DOCUMENT);

  constructor() {
    // Another tab remembered or forgot a group: pick it up, so this tab never writes back a stale list.
    this.doc.defaultView?.addEventListener('storage', e => {
      if (e.key === null || e.key === STORAGE_KEY) this.records.set(this.readStored() ?? this.records());
    });
  }

  /** Highest version seen per group this session: an older answer (a stale cache or replay) is ignored. */
  private readonly seen = new Map<string, number>();
  private readonly records = signal<Record<string, GroupRecord>>(this.readRecords());
  readonly all = this.records.asReadonly();

  recordFor(id: string): GroupRecord | null {
    return this.records()[id] ?? null;
  }

  /** The group this device started from a trip, if any. */
  forTrip(tripId: string): GroupRecord | null {
    return Object.values(this.records()).find(r => r.owner && r.tripId === tripId) ?? null;
  }

  remember(r: GroupRecord): void {
    this.mutate(m => ({ ...m, [r.id]: r }));
  }

  forget(id: string): void {
    this.mutate(m => {
      const { [id]: _gone, ...rest } = m;
      return rest;
    });
  }

  /** Applies a change to what storage holds now (not this tab's copy), so another tab's records survive. */
  private mutate(change: (m: Record<string, GroupRecord>) => Record<string, GroupRecord>): void {
    const next = change(this.readStored() ?? this.records());
    this.records.set(next);
    this.writeRecords(next);
  }

  linkOf(r: GroupRecord, viewOnly = false): GroupLink {
    return { id: r.id, key: r.key, write: viewOnly ? null : r.write };
  }

  urlOf(link: GroupLink): string {
    const o = this.doc.location?.origin;
    return buildGroupLink(o && o !== 'null' ? o : '', link);
  }

  // ── Network ────────────────────────────────────────────────────────────

  private async call(method: 'GET' | 'PUT' | 'DELETE', id: string, write: string | null, body?: unknown, owner?: string | null): Promise<Reply> {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (write) headers['X-Group-Write'] = write;
      if (owner) headers['X-Group-Owner'] = owner;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${GROUP_ENDPOINT}?id=${encodeURIComponent(id)}`, {
        method, headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined,
      });
      // A host without functions answers with a plain 404 page: that is "service unavailable", not "group gone".
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) return { status: 0, json: null };
      return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    } catch {
      return { status: 0, json: null };
    }
  }

  private fail(r: Reply): GroupFailure {
    if (r.status === 503 && r.json?.['error'] === 'budget') return 'budget';
    if (r.status === 404 || r.status === 410) return 'gone';
    if (r.status === 403) return 'forbidden';
    if (r.status === 413) return 'too-large';
    return 'unavailable';
  }

  async load(link: GroupLink): Promise<LoadResult> {
    const r = await this.call('GET', link.id, null);
    if (r.status !== 200 || !r.json) {
      const reason = this.fail(r);
      // The group is gone for good (stopped or expired): forget it here so a trip can start a new one.
      if (reason === 'gone') this.forget(link.id);
      return { ok: false, reason };
    }
    const j = r.json;
    if (typeof j['ciphertext'] !== 'string' || typeof j['iv'] !== 'string' || typeof j['version'] !== 'number') return { ok: false, reason: 'unavailable' };
    if (j['version'] < (this.seen.get(link.id) ?? 0)) return { ok: false, reason: 'unavailable' };
    const text = await decryptText({ ciphertext: j['ciphertext'], iv: j['iv'] }, link.key, link.id);
    const doc = text === null ? null : parseGroupDoc(text);
    if (!doc) return { ok: false, reason: 'invalid' };
    this.seen.set(link.id, j['version']);
    return { ok: true, doc, version: j['version'], expiresAt: typeof j['expiresAt'] === 'string' ? j['expiresAt'] : null };
  }

  /**
   * Writes `doc` on top of `version`. On a 409 the current doc is fetched, merged
   * (member entries by updatedAt) and the write retried, up to three times.
   * `expiresAt` (a later date; the server never shortens) and `ownerToken` come from the creating device only.
   */
  async save(link: GroupLink, doc: GroupDoc, version: number, expiresAt?: string, ownerToken?: string | null): Promise<SaveResult> {
    if (!link.write) return { ok: false, reason: 'forbidden' };
    let mine = doc;
    let base = version;
    for (let attempt = 0; attempt < 4; attempt++) {
      mine = { ...mine, members: capMembers(mine.members) };
      const sealed = await encryptText(serializeGroupDoc(mine), link.key, link.id);
      if (sealed.ciphertext.length > MAX_CIPHERTEXT) return { ok: false, reason: 'too-large' };
      const r = await this.call('PUT', link.id, link.write, { ...sealed, baseVersion: base, ...(expiresAt ? { expiresAt } : {}) }, ownerToken);
      if (r.status === 200 && r.json && typeof r.json['version'] === 'number') {
        this.seen.set(link.id, r.json['version']);
        return { ok: true, doc: mine, version: r.json['version'], expiresAt: typeof r.json['expiresAt'] === 'string' ? r.json['expiresAt'] : null };
      }
      if (r.status !== 409) return { ok: false, reason: this.fail(r) };
      const remote = await this.load(link);
      if (!remote.ok) return remote;
      mine = mergeGroupDocs(mine, remote.doc);
      base = remote.version;
    }
    return { ok: false, reason: 'unavailable' };
  }

  /** "Stop sharing": deletes the group on the server (write token, plus the owner token where the group has one). */
  async stop(link: GroupLink, ownerToken?: string | null): Promise<boolean> {
    if (!link.write) return false;
    const r = await this.call('DELETE', link.id, link.write, undefined, ownerToken);
    return r.status === 200 || r.status === 404 || r.status === 410;
  }

  /**
   * The later expiry to send when the owner saves or opens the group: the trip's own
   * (groupExpiry) when it is more than a day beyond `current`, else undefined (no churn).
   */
  ownerExpiry(rec: GroupRecord | null, current: string | null, nowMs: number = Date.now()): string | undefined {
    if (!rec?.owner || !rec.tripId) return undefined;
    const trip = this.trips.trip(rec.tripId);
    if (!trip) return undefined;
    const want = groupExpiry(trip, nowMs);
    const cur = current ? Date.parse(current) : NaN;
    return Number.isFinite(cur) && Date.parse(want) - cur <= 86_400_000 ? undefined : want;
  }

  // ── Create ──────────────────────────────────────────────────────────────

  /** Starts a group from a trip on this device. The key and token are made here and never leave except in the link. */
  async create(trip: Trip, nickname: string, nowMs: number = Date.now()): Promise<{ ok: true; record: GroupRecord } | { ok: false; reason: GroupFailure }> {
    // Only the plan itself: free-text notes are blanked and load notes are left out.
    const shared = forGroup(trip);
    const at = new Date(nowMs).toISOString();
    const memberId = newMemberId();
    const name = nickname.trim().slice(0, 24) || 'Me';
    const record: GroupRecord = { id: newGroupId(), key: await generateGroupKey(), write: newWriteToken(), memberId, name, owner: true, ownerToken: newOwnerToken(), tripId: trip.id, expiresAt: null };
    // A big trip that does not fit is retried without its backups.
    const variants: Trip[] = [shared, { ...shared, legs: shared.legs.map(l => (l.kind === 'flight' ? { ...l, alternates: [] } : l)) }];
    const expiresAt = groupExpiry(trip, nowMs);
    let last: GroupFailure = 'too-large';
    for (const v of variants) {
      let plan: string;
      try {
        plan = await encodeTripShare(v, [], nowMs);
      } catch {
        continue;
      }
      const doc: GroupDoc = { s: 1, plan, planAt: at, members: { [memberId]: { name, planLabel: '', arrival: null, updatedAt: at } }, meetup: null };
      const saved = await this.save(this.linkOf(record), doc, 0, expiresAt, record.ownerToken);
      if (saved.ok) {
        const rec = { ...record, expiresAt };
        this.remember(rec);
        return { ok: true, record: rec };
      }
      last = saved.reason;
      if (last !== 'too-large') break;
    }
    return { ok: false, reason: last };
  }

  // ── Open ────────────────────────────────────────────────────────────────

  async previewOf(doc: GroupDoc): Promise<SharedTripPreview | null> {
    return decodeTripShare(doc.plan);
  }

  /** My entry in the doc (stamped now), for a status edit. */
  withMember(doc: GroupDoc, memberId: string, patch: Partial<MemberStatus> & { name: string }, nowMs: number = Date.now()): GroupDoc {
    const cur = doc.members[memberId];
    const next: MemberStatus = { name: patch.name, planLabel: patch.planLabel ?? cur?.planLabel ?? '', arrival: patch.arrival === undefined ? (cur?.arrival ?? null) : patch.arrival, updatedAt: new Date(nowMs).toISOString() };
    return { ...doc, members: { ...doc.members, [memberId]: next } };
  }

  newMember(): string {
    return newMemberId();
  }

  // ── Storage ─────────────────────────────────────────────────────────────

  private readRecords(): Record<string, GroupRecord> {
    return this.readStored() ?? {};
  }

  /** What storage holds now; null when storage is blocked. */
  private readStored(): Record<string, GroupRecord> | null {
    try {
      const store = globalThis.localStorage;
      if (!store) return null;
      const raw = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}') as Record<string, Partial<GroupRecord>>;
      const out: Record<string, GroupRecord> = {};
      for (const [id, r] of Object.entries(raw)) {
        if (r && r.id === id && typeof r.key === 'string' && typeof r.memberId === 'string' && typeof r.name === 'string') {
          const expiresAt = typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) ? r.expiresAt : null;
          // The server deletes it at expiry: drop the entry (and its key) from this device too.
          if (expiresAt && Date.parse(expiresAt) <= Date.now()) continue;
          out[id] = { id, key: r.key, write: typeof r.write === 'string' ? r.write : null, memberId: r.memberId, name: r.name, owner: r.owner === true, ownerToken: typeof r.ownerToken === 'string' ? r.ownerToken : null, tripId: typeof r.tripId === 'string' ? r.tripId : null, expiresAt };
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  private writeRecords(records: Record<string, GroupRecord>): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Storage blocked: the group still works until the tab closes.
    }
  }

  /** Saves the shared plan as a copy in My trips. */
  saveCopy(preview: SharedTripPreview): Trip {
    return this.trips.saveShared(preview);
  }
}
