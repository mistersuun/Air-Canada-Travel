/**
 * Share links (spec §1.3): the trip itself travels in the URL fragment
 * (`/trips/import#t=<payload>`), which never reaches a server. No account.
 *
 * Payload: compact JSON of the trip without its private state (prep,
 * changes, offline/calendar marks, archived) plus the trip's load notes;
 * deflate-raw via CompressionStream when available (prefix 'z'), else raw
 * JSON (prefix 'j'); then base64url.
 */
import { LoadNote, SharedTripPreview, Trip } from './model';
import { sanitizeLoadNote, sanitizeTrip } from './storage';

/** Payloads longer than this are rejected without decoding. */
export const MAX_SHARE_PAYLOAD = 60_000;
const MAX_JSON = 400_000;

interface SharePayload {
  s: 1;
  at: string;
  trip: Omit<Trip, 'prep' | 'changes' | 'offlineSavedAt' | 'calendarExportedAt' | 'calendarRefs' | 'archived'>;
  notes: LoadNote[];
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hasCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** Runs bytes through a (de)compression stream and collects the output. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Not awaited before reading: the readable side must drain for the write to finish.
  const written = writer.write(new Uint8Array(bytes)).then(() => writer.close());
  written.catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_JSON) throw new Error('too large');
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Thrown when even the trimmed trip does not fit in a share link. */
export class ShareTooLargeError extends Error {
  constructor() {
    super('This trip is too large to share as a link.');
  }
}

async function encodePayload(payload: SharePayload): Promise<string | null> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  // The decoder rejects anything that inflates past MAX_JSON, so never emit it.
  if (json.length > MAX_JSON) return null;
  if (hasCompression()) {
    try {
      return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw' as CompressionFormat)));
    } catch {
      // Fall through to raw JSON.
    }
  }
  return 'j' + toBase64Url(json);
}

/**
 * The share payload for a trip (with its load notes). A link the recipient
 * could not import (longer than MAX_SHARE_PAYLOAD) is never produced: the
 * notes are dropped first, then the backups; if it still does not fit,
 * ShareTooLargeError is thrown.
 */
export async function encodeTripShare(trip: Trip, notes: readonly LoadNote[] = [], nowMs: number = Date.now()): Promise<string> {
  const { prep: _p, changes: _c, offlineSavedAt: _o, calendarExportedAt: _k, calendarRefs: _r, archived: _a, ...base } = trip;
  // Usual items come from the private travel profile: never in a share link.
  const rest = { ...base, customPrep: base.customPrep.filter(c => !c.usual) };
  const at = new Date(nowMs).toISOString();
  const noAlternates = { ...rest, legs: rest.legs.map(l => (l.kind === 'flight' ? { ...l, alternates: [] } : l)) };
  const attempts: SharePayload[] = [
    { s: 1, at, trip: rest, notes: [...notes] },
    ...(notes.length ? [{ s: 1 as const, at, trip: rest, notes: [] }] : []),
    { s: 1, at, trip: noAlternates, notes: [] },
  ];
  for (const p of attempts) {
    const out = await encodePayload(p);
    if (out !== null && out.length <= MAX_SHARE_PAYLOAD) return out;
  }
  throw new ShareTooLargeError();
}

/** Decodes a share payload. Null for anything it cannot read; never throws. */
export async function decodeTripShare(payload: string): Promise<SharedTripPreview | null> {
  try {
    if (typeof payload !== 'string' || payload.length < 2 || payload.length > MAX_SHARE_PAYLOAD) return null;
    const kind = payload[0];
    const body = payload.slice(1);
    if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
    let bytes = fromBase64Url(body);
    if (kind === 'z') {
      if (!hasCompression()) return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw' as CompressionFormat));
    } else if (kind !== 'j') {
      return null;
    }
    if (bytes.length > MAX_JSON) return null;
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload> | null;
    if (!raw || typeof raw !== 'object' || raw.s !== 1) return null;
    const trip = sanitizeTrip({ ...(raw.trip as object), prep: {}, changes: [], archived: false, calendarRefs: undefined });
    if (!trip) return null;
    const notes = (Array.isArray(raw.notes) ? raw.notes : []).map(sanitizeLoadNote).filter((n): n is LoadNote => !!n);
    const sharedAt = typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : trip.updatedAt;
    return { trip: { ...trip, offlineSavedAt: null, calendarExportedAt: null }, notes, sharedAt };
  } catch {
    return null;
  }
}

/** `${origin}/trips/import#t=<payload>`. */
export function shareUrl(origin: string, payload: string): string {
  return `${origin.replace(/\/+$/, '')}/trips/import#t=${payload}`;
}

/** The payload from a fragment ('t=…' or '#t=…'), or null. */
export function payloadFromFragment(fragment: string | null | undefined): string | null {
  if (!fragment) return null;
  const m = /(?:^|[#&])t=([^&]+)/.exec(fragment);
  return m ? m[1] : null;
}
