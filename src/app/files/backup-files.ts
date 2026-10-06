/**
 * "Backup with files" (extras spec §4.4): the same `routes-backup` file as
 * "Export trips", plus a `files` key with the attachments and their bytes as
 * base64. Built as Blob parts so a large backup is never one huge string.
 *
 * Boarding passes are never included: not their records, raw text or images.
 * Nothing in this file reads passes.
 */
import { Attachment, AttachmentKind, AttachmentScope, RASTER_IMAGE_MIMES } from './model';

export const FILES_BACKUP_SCHEMA = 1;

export interface BackupFileEntry { meta: Attachment; data: string | null }

/** 'routes-backup-with-files-2026-10-01.json' (local date of `now`, like the app's date keys). */
export function backupWithFilesFilename(now: number): string {
  const d = new Date(now);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `routes-backup-with-files-${key}.json`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of a byte array (no line breaks). */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Bytes of a base64 string; null when it isn't valid base64. */
export function base64Decode(s: string): Uint8Array | null {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12)
      | ((clean[i + 2] === '=' ? 0 : B64.indexOf(clean[i + 2])) << 6) | (clean[i + 3] === '=' ? 0 : B64.indexOf(clean[i + 3]));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Bytes per base64 chunk read from a blob (a multiple of 3, so chunks concatenate). */
const CHUNK = 3 * 256 * 1024;

/** A blob's base64, as string parts of at most ~1 MB each. */
export async function base64Parts(blob: Blob): Promise<string[]> {
  const parts: string[] = [];
  for (let at = 0; at < blob.size; at += CHUNK) {
    parts.push(base64Encode(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer())));
  }
  return parts;
}

/**
 * The backup file as Blob parts: the trips backup object (already parsed from
 * TripsService.exportBackup()) with `files` appended. `blobFor` returns the
 * content of an attachment (null for notes and addresses, or a lost blob).
 */
export async function buildBackupWithFiles(
  base: Record<string, unknown>, attachments: readonly Attachment[], blobFor: (a: Attachment) => Promise<Blob | null>,
): Promise<Blob> {
  const { files: _ignored, passes: _never, ...rest } = base as Record<string, unknown> & { files?: unknown; passes?: unknown };
  const head = JSON.stringify(rest);
  const parts: BlobPart[] = [head.slice(0, -1), `${head.length > 2 ? ',' : ''}"files":{"schema":${FILES_BACKUP_SCHEMA},"attachments":[`];
  let first = true;
  for (const a of attachments) {
    const blob = a.blobId ? await blobFor(a) : null;
    // previews are made again on import: only the file itself goes in
    parts.push(`${first ? '' : ','}{"meta":${JSON.stringify({ ...a, thumbBlobId: null })},"data":`);
    if (blob) {
      parts.push('"');
      parts.push(...(await base64Parts(blob)));
      parts.push('"');
    } else {
      parts.push('null');
    }
    parts.push('}');
    first = false;
  }
  parts.push(']}}');
  return new Blob(parts, { type: 'application/json' });
}

// ── Import ────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const KINDS: readonly AttachmentKind[] = ['pdf', 'image', 'file', 'note', 'address'];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeScope(x: unknown): AttachmentScope | null {
  if (!isRec(x)) return null;
  if (x['kind'] === 'trip') return { kind: 'trip' };
  if (x['kind'] === 'leg' && str(x['legId']) && x['legId']) return { kind: 'leg', legId: x['legId'] };
  if (x['kind'] === 'day' && str(x['dateKey']) && DATE_KEY.test(x['dateKey'])) return { kind: 'day', dateKey: x['dateKey'] };
  return null;
}

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/**
 * kind and mime from untrusted JSON that agree with each other: 'pdf' only
 * with application/pdf, 'image' only with a raster image type (never SVG).
 * Anything else with content becomes a plain 'file' with a well-formed mime
 * (application/octet-stream when malformed); notes and addresses have none.
 */
function kindAndMime(kind: AttachmentKind, raw: unknown): { kind: AttachmentKind; mime: string | null } {
  if (kind === 'note' || kind === 'address') return { kind, mime: null };
  const m = str(raw) ? raw.toLowerCase().trim() : '';
  const mime = MIME.test(m) ? m : 'application/octet-stream';
  if (mime === 'application/pdf') return { kind: 'pdf', mime };
  if (RASTER_IMAGE_MIMES.includes(mime)) return { kind: 'image', mime };
  return { kind: 'file', mime };
}

/** A well-formed Attachment from untrusted JSON, or null. Never throws. */
export function sanitizeAttachment(x: unknown): Attachment | null {
  if (!isRec(x)) return null;
  const scope = sanitizeScope(x['scope']);
  const kind = x['kind'] as AttachmentKind;
  if (!scope || !KINDS.includes(kind) || !str(x['id']) || !x['id'] || !str(x['tripId']) || !x['tripId']) return null;
  const nullableStr = (v: unknown): string | null => (str(v) ? v : null);
  const createdAt = str(x['createdAt']) ? x['createdAt'] : new Date(0).toISOString();
  const km = kindAndMime(kind, x['mime']);
  return {
    v: 1,
    id: x['id'],
    tripId: x['tripId'],
    scope,
    kind: km.kind,
    title: str(x['title']) ? x['title'].slice(0, 200) : '',
    text: nullableStr(x['text']),
    blobId: nullableStr(x['blobId']),
    thumbBlobId: nullableStr(x['thumbBlobId']),
    mime: km.mime,
    bytes: typeof x['bytes'] === 'number' && x['bytes'] >= 0 ? x['bytes'] : 0,
    pages: typeof x['pages'] === 'number' ? x['pages'] : null,
    createdAt,
    updatedAt: str(x['updatedAt']) ? x['updatedAt'] : createdAt,
  };
}

/** The `files.attachments` entries of a parsed backup (missing or malformed → []). */
export function readBackupFiles(parsed: unknown): { meta: Attachment; data: string | null }[] {
  if (!isRec(parsed) || !isRec(parsed['files'])) return [];
  const list = (parsed['files'] as Rec)['attachments'];
  if (!Array.isArray(list)) return [];
  const out: { meta: Attachment; data: string | null }[] = [];
  for (const e of list) {
    if (!isRec(e)) continue;
    const meta = sanitizeAttachment(e['meta']);
    if (meta) out.push({ meta, data: str(e['data']) ? e['data'] : null });
  }
  return out;
}
