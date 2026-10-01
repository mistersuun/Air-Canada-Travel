/** Random ids for trips, legs, notes and outcomes: base36 from crypto.getRandomValues. */
export function newId(length = 10): string {
  const bytes = new Uint8Array(length);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}
