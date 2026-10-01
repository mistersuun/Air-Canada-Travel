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
  trip: Omit<Trip, 'prep' | 'changes' | 'offlineSavedAt' | 'calendarExportedAt' | 'archived'>;
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
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** The share payload for a trip (with its load notes). */
export async function encodeTripShare(trip: Trip, notes: readonly LoadNote[] = [], nowMs: number = Date.now()): Promise<string> {
  const { prep: _p, changes: _c, offlineSavedAt: _o, calendarExportedAt: _k, archived: _a, ...rest } = trip;
  const payload: SharePayload = { s: 1, at: new Date(nowMs).toISOString(), trip: rest, notes: [...notes] };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (hasCompression()) {
    try {
      return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw' as CompressionFormat)));
    } catch {
      // Fall through to raw JSON.
    }
  }
  return 'j' + toBase64Url(json);
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
    const trip = sanitizeTrip({ ...(raw.trip as object), prep: {}, changes: [], archived: false });
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
