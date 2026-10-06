/**
 * Group trip crypto and links. The AES-GCM 256 key is generated on the device
 * and travels only in the link's URL fragment (`/g/<id>#k=<key>[&w=<token>]`),
 * which browsers never send to a server. The server sees ciphertext and a hash
 * of the write token, nothing else.
 */
import { fromBase64Url, toBase64Url } from '../trips/share-codec';

const rnd = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** 128-bit random group id, base64url (22 chars). */
export const newGroupId = (): string => toBase64Url(rnd(16));
/** 256-bit write token, base64url (43 chars). The server keeps only its sha256. */
export const newWriteToken = (): string => toBase64Url(rnd(32));
/** A short random member id, base64url (12 chars). */
export const newMemberId = (): string => toBase64Url(rnd(9));

/** A fresh AES-GCM 256 key as base64url (43 chars). */
export async function generateGroupKey(): Promise<string> {
  const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return toBase64Url(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key)));
}

function importKey(keyB64: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', fromBase64Url(keyB64) as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface Sealed { ciphertext: string; iv: string }

/** Authenticated (not secret) context binding a ciphertext to its group, so it cannot be replayed into another group. */
const aad = (id: string): BufferSource => new TextEncoder().encode(`ac-group:v1:${id}`) as BufferSource;

/** Encrypts text with a fresh 96-bit IV (never reused); `id` is bound as additional data. */
export async function encryptText(plain: string, keyB64: string, id: string): Promise<Sealed> {
  const iv = rnd(12);
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(id) }, await importKey(keyB64), new TextEncoder().encode(plain));
  return { ciphertext: toBase64Url(new Uint8Array(ct)), iv: toBase64Url(iv) };
}

/** Decrypts; null when the key is wrong or the data was altered (GCM authenticates). Never throws. */
export async function decryptText(sealed: Sealed, keyB64: string, id: string): Promise<string | null> {
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(sealed.iv) as BufferSource, additionalData: aad(id) }, await importKey(keyB64), fromBase64Url(sealed.ciphertext) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export const GROUP_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

export interface GroupLink { id: string; key: string; write: string | null }

/** `${origin}/g/<id>#k=<key>[&w=<token>]`. */
export function buildGroupLink(origin: string, link: GroupLink): string {
  return `${origin.replace(/\/+$/, '')}/g/${link.id}#k=${link.key}${link.write ? `&w=${link.write}` : ''}`;
}

/** The read-only version of a link (drops the write token). */
export const viewOnlyLink = (link: GroupLink): GroupLink => ({ ...link, write: null });

/** Reads the key (and write token) from a fragment ('k=..&w=..' or '#k=..'); null when malformed. */
export function parseGroupFragment(id: string, fragment: string | null | undefined): GroupLink | null {
  if (!GROUP_ID_RE.test(id) || !fragment) return null;
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const key = params.get('k');
  const write = params.get('w');
  if (!key || !KEY_RE.test(key)) return null;
  if (write !== null && !TOKEN_RE.test(write)) return null;
  return { id, key, write };
}
