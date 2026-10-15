// Group trip store logic (pure: the Blobs store is injected so it can be tested with a fake).
// The server only ever holds ciphertext. The AES key lives in the group link's URL
// fragment and never reaches this code; the write token is stored only as sha256(token), and so is the owner token
// (made when the group is created, kept only on the creator's device, never in a link; it gates
// DELETE and lengthening the expiry).
import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_CIPHERTEXT = 96 * 1024;
export const DAY_MS = 86_400_000;
export const DEFAULT_TTL_DAYS = 30;
export const MAX_TTL_DAYS = 90;

/** The slice of a Netlify Blobs store the group endpoint needs. */
export interface GroupStore {
  getWithMetadata(key: string): Promise<{ data: string; etag?: string } | null>;
  set(key: string, value: string, options: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
  list(): Promise<{ blobs: { key: string }[] }>;
}

export interface GroupRecord {
  ciphertext: string;
  iv: string;
  version: number;
  updatedAt: string;
  expiresAt: string;
  writeHash: string;
  /** sha256 of the owner token; absent on groups made before it existed (the write token then suffices). */
  ownerHash?: string;
}

export const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v);
export const validToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(v);
const validB64 = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v);

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Requested expiry clamped to [now + 1 day, now + 90 days]; default now + 30 days. */
export function computeExpiry(requested: unknown, nowMs: number): string {
  const t = typeof requested === 'string' ? Date.parse(requested) : NaN;
  const base = Number.isFinite(t) ? t : nowMs + DEFAULT_TTL_DAYS * DAY_MS;
  return new Date(Math.min(Math.max(base, nowMs + DAY_MS), nowMs + MAX_TTL_DAYS * DAY_MS)).toISOString();
}

export const isExpired = (r: Pick<GroupRecord, 'expiresAt'>, nowMs: number): boolean => Date.parse(r.expiresAt) <= nowMs;

export interface PutBody { ciphertext: string; iv: string; baseVersion: number; expiresAt?: string }

export function parsePutBody(raw: unknown): PutBody | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (!validB64(b['ciphertext'], 16, MAX_CIPHERTEXT)) return null;
  if (!validB64(b['iv'], 16, 16)) return null;
  const v = b['baseVersion'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) return null;
  return { ciphertext: b['ciphertext'], iv: b['iv'], baseVersion: v, expiresAt: typeof b['expiresAt'] === 'string' ? b['expiresAt'] : undefined };
}

function parseRecord(text: string): GroupRecord | null {
  try {
    const r = JSON.parse(text) as Partial<GroupRecord>;
    if (typeof r.ciphertext === 'string' && typeof r.iv === 'string' && typeof r.version === 'number'
      && typeof r.updatedAt === 'string' && typeof r.expiresAt === 'string' && typeof r.writeHash === 'string'
      && (r.ownerHash === undefined || typeof r.ownerHash === 'string')) return r as GroupRecord;
  } catch { /* fall through */ }
  return null;
}

export interface Result { status: number; body: unknown }
const res = (status: number, body: unknown): Result => ({ status, body });

/** GET: the ciphertext. 404 unknown, 410 expired (and deleted). */
export async function getGroup(store: GroupStore, id: string, nowMs: number): Promise<Result> {
  const cur = await store.getWithMetadata(id);
  if (!cur) return res(404, { error: 'not-found' });
  const rec = parseRecord(cur.data);
  if (!rec) return res(404, { error: 'not-found' });
  if (isExpired(rec, nowMs)) {
    await store.delete(id);
    return res(410, { error: 'expired' });
  }
  return res(200, { ciphertext: rec.ciphertext, iv: rec.iv, version: rec.version, updatedAt: rec.updatedAt, expiresAt: rec.expiresAt });
}

/**
 * PUT: create (baseVersion 0, id unused) or update (baseVersion = the version read).
 * Optimistic concurrency: the write is conditional on the ETag read here, so a
 * concurrent writer makes this one fail with 409 and the client re-fetches and merges.
 */
export async function putGroup(
  store: GroupStore, id: string, token: string, body: PutBody, nowMs: number,
  /** Called only for a genuine create, after every check passed and right before the write: true to proceed, false = budget spent, 'rate-limited' = this caller made too many. */
  spend?: () => Promise<boolean | 'rate-limited'>,
  /** The owner token (X-Group-Owner): stored (hashed) on create, and required to lengthen the expiry once the group has one. */
  ownerToken?: string,
): Promise<Result> {
  const cur = await store.getWithMetadata(id);
  const existing = cur ? parseRecord(cur.data) : null;
  if (cur && existing && isExpired(existing, nowMs)) {
    await store.delete(id);
    return res(410, { error: 'expired' });
  }
  const at = new Date(nowMs).toISOString();
  if (!cur || !existing) {
    if (cur) return res(409, { error: 'conflict' });
    if (body.baseVersion !== 0) return res(404, { error: 'not-found' });
    if (spend) {
      const ok = await spend();
      if (ok === 'rate-limited') return res(429, { error: 'rate-limited' });
      if (!ok) return res(503, { error: 'budget' });
    }
    const rec: GroupRecord = {
      ciphertext: body.ciphertext, iv: body.iv, version: 1, updatedAt: at,
      expiresAt: computeExpiry(body.expiresAt, nowMs), writeHash: hashToken(token),
      ...(ownerToken ? { ownerHash: hashToken(ownerToken) } : {}),
    };
    const r = await store.set(id, JSON.stringify(rec), { onlyIfNew: true });
    return r.modified ? res(200, { version: 1, updatedAt: at, expiresAt: rec.expiresAt }) : res(409, { error: 'conflict' });
  }
  if (!sameHash(existing.writeHash, hashToken(token))) return res(403, { error: 'forbidden' });
  if (body.baseVersion !== existing.version) return res(409, { error: 'conflict', version: existing.version });
  const next: GroupRecord = { ...existing, ciphertext: body.ciphertext, iv: body.iv, version: existing.version + 1, updatedAt: at };
  // Only the owner can lengthen the group's life (clamped to 90 days from now); it is never shortened.
  if (body.expiresAt && isOwner(existing, token, ownerToken)) {
    const wanted = computeExpiry(body.expiresAt, nowMs);
    if (Date.parse(wanted) > Date.parse(existing.expiresAt)) next.expiresAt = wanted;
  }
  const r = await store.set(id, JSON.stringify(next), { onlyIfMatch: cur.etag ?? '' });
  return r.modified ? res(200, { version: next.version, updatedAt: at, expiresAt: next.expiresAt }) : res(409, { error: 'conflict' });
}

/** The owner token matches; for a group made before owner tokens, the write token (already checked) stands in. */
function isOwner(rec: GroupRecord, _writeToken: string, ownerToken: string | undefined): boolean {
  if (!rec.ownerHash) return true;
  return !!ownerToken && sameHash(rec.ownerHash, hashToken(ownerToken));
}

/** DELETE ("Stop sharing"): the write token, plus the owner token when the group has one. */
export async function deleteGroup(store: GroupStore, id: string, token: string, ownerToken?: string): Promise<Result> {
  const cur = await store.getWithMetadata(id);
  const rec = cur ? parseRecord(cur.data) : null;
  if (!cur || !rec) return res(404, { error: 'not-found' });
  if (!sameHash(rec.writeHash, hashToken(token))) return res(403, { error: 'forbidden' });
  if (!isOwner(rec, token, ownerToken)) return res(403, { error: 'forbidden' });
  await store.delete(id);
  return res(200, { ok: true });
}

/** How many blobs the sweep reads at once. */
export const SWEEP_CONCURRENCY = 8;

/** Deletes every expired group (and unreadable records). Returns how many were removed. */
export async function sweepGroups(store: GroupStore, nowMs: number): Promise<number> {
  const { blobs } = await store.list();
  let removed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < blobs.length) {
      const { key } = blobs[next++];
      try {
        const cur = await store.getWithMetadata(key);
        if (!cur) continue;
        const rec = parseRecord(cur.data);
        if (!rec || isExpired(rec, nowMs)) {
          await store.delete(key);
          removed++;
        }
      } catch { /* leave it for the next run */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, blobs.length) }, worker));
  return removed;
}
