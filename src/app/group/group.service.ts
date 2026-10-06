import { Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { SharedTripPreview, Trip } from '../trips/model';
import { decodeTripShare, encodeTripShare } from '../trips/share-codec';
import { TripsService } from '../trips/trips.service';
import {
  type GroupLink, buildGroupLink, decryptText, encryptText, generateGroupKey, newGroupId, newMemberId, newWriteToken,
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
  tripId: string | null;
  /** When the server will delete it (ISO), so expired entries can be dropped from this device. */
  expiresAt: string | null;
}

export type GroupFailure = 'unavailable' | 'gone' | 'invalid' | 'forbidden' | 'too-large' | 'budget';
export type LoadResult = { ok: true; doc: GroupDoc; version: number; expiresAt: string | null } | { ok: false; reason: GroupFailure };
export type SaveResult = { ok: true; doc: GroupDoc; version: number } | { ok: false; reason: GroupFailure };

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
    this.records.update(m => ({ ...m, [r.id]: r }));
    this.writeRecords();
  }

  forget(id: string): void {
    this.records.update(m => {
      const { [id]: _gone, ...rest } = m;
      return rest;
    });
    this.writeRecords();
  }

  linkOf(r: GroupRecord, viewOnly = false): GroupLink {
    return { id: r.id, key: r.key, write: viewOnly ? null : r.write };
  }

  urlOf(link: GroupLink): string {
    const o = this.doc.location?.origin;
    return buildGroupLink(o && o !== 'null' ? o : '', link);
  }

  // ── Network ────────────────────────────────────────────────────────────

  private async call(method: 'GET' | 'PUT' | 'DELETE', id: string, write: string | null, body?: unknown): Promise<Reply> {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (write) headers['X-Group-Write'] = write;
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
   */
  async save(link: GroupLink, doc: GroupDoc, version: number, expiresAt?: string): Promise<SaveResult> {
    if (!link.write) return { ok: false, reason: 'forbidden' };
    let mine = doc;
    let base = version;
    for (let attempt = 0; attempt < 4; attempt++) {
      mine = { ...mine, members: capMembers(mine.members) };
      const sealed = await encryptText(serializeGroupDoc(mine), link.key, link.id);
      if (sealed.ciphertext.length > MAX_CIPHERTEXT) return { ok: false, reason: 'too-large' };
      const r = await this.call('PUT', link.id, link.write, { ...sealed, baseVersion: base, ...(expiresAt ? { expiresAt } : {}) });
      if (r.status === 200 && r.json && typeof r.json['version'] === 'number') {
        this.seen.set(link.id, r.json['version']);
        return { ok: true, doc: mine, version: r.json['version'] };
      }
      if (r.status !== 409) return { ok: false, reason: this.fail(r) };
      const remote = await this.load(link);
      if (!remote.ok) return remote;
      mine = mergeGroupDocs(mine, remote.doc);
      base = remote.version;
    }
    return { ok: false, reason: 'unavailable' };
  }

  /** "Stop sharing": deletes the group on the server (write token required). */
  async stop(link: GroupLink): Promise<boolean> {
    if (!link.write) return false;
    const r = await this.call('DELETE', link.id, link.write);
    return r.status === 200 || r.status === 404 || r.status === 410;
  }

  // ── Create ──────────────────────────────────────────────────────────────

  /** Starts a group from a trip on this device. The key and token are made here and never leave except in the link. */
  async create(trip: Trip, nickname: string, nowMs: number = Date.now()): Promise<{ ok: true; record: GroupRecord } | { ok: false; reason: GroupFailure }> {
    // Only the plan itself: free-text notes are blanked and load notes are left out.
    const shared = forGroup(trip);
    const at = new Date(nowMs).toISOString();
    const memberId = newMemberId();
    const name = nickname.trim().slice(0, 24) || 'Me';
    const record: GroupRecord = { id: newGroupId(), key: await generateGroupKey(), write: newWriteToken(), memberId, name, owner: true, tripId: trip.id, expiresAt: null };
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
      const saved = await this.save(this.linkOf(record), doc, 0, expiresAt);
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
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}') as Record<string, Partial<GroupRecord>>;
      const out: Record<string, GroupRecord> = {};
      for (const [id, r] of Object.entries(raw)) {
        if (r && r.id === id && typeof r.key === 'string' && typeof r.memberId === 'string' && typeof r.name === 'string') {
          const expiresAt = typeof r.expiresAt === 'string' && Number.isFinite(Date.parse(r.expiresAt)) ? r.expiresAt : null;
          // The server deletes it at expiry: drop the entry (and its key) from this device too.
          if (expiresAt && Date.parse(expiresAt) <= Date.now()) continue;
          out[id] = { id, key: r.key, write: typeof r.write === 'string' ? r.write : null, memberId: r.memberId, name: r.name, owner: r.owner === true, tripId: typeof r.tripId === 'string' ? r.tripId : null, expiresAt };
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private writeRecords(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.records()));
    } catch {
      // Storage blocked: the group still works until the tab closes.
    }
  }

  /** Saves the shared plan as a copy in My trips. */
  saveCopy(preview: SharedTripPreview): Trip {
    return this.trips.saveShared(preview);
  }
}
