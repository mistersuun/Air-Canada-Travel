/**
 * Sending the share text or image out (extras spec §6.4): the phone's share
 * sheet (Web Share) when it can take it, otherwise the clipboard or a
 * download. Every browser API comes in through `env`, so specs stub it.
 */

export type TextResult = 'shared' | 'copied' | 'cancelled' | 'failed';
export type ImageResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

export interface ShareEnv {
  navigator?: Partial<Pick<Navigator, 'share' | 'canShare' | 'clipboard'>> | null;
  document?: Document | null;
}

function defaultEnv(): ShareEnv {
  return {
    navigator: typeof navigator === 'undefined' ? null : navigator,
    document: typeof document === 'undefined' ? null : document,
  };
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

/** Writes `text` to the clipboard. */
export async function copyText(text: string, env: ShareEnv = defaultEnv()): Promise<'copied' | 'failed'> {
  try {
    if (env.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // Fall through to the textarea copy below.
  }
  const doc = env.document;
  if (!doc?.body) return 'failed';
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  doc.body.appendChild(ta);
  try {
    ta.select();
    return doc.execCommand?.('copy') ? 'copied' : 'failed';
  } catch {
    return 'failed';
  } finally {
    ta.remove();
  }
}

/** Saves `blob` as a file through a temporary download link. */
export function downloadBlob(blob: Blob, filename: string, env: ShareEnv = defaultEnv()): 'downloaded' | 'failed' {
  const doc = env.document;
  if (!doc?.body || typeof URL.createObjectURL !== 'function') return 'failed';
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** The share sheet with the text; the clipboard when there is no share sheet (or it refuses). */
export async function shareText(text: string, title: string, env: ShareEnv = defaultEnv()): Promise<TextResult> {
  const nav = env.navigator;
  if (nav?.share) {
    const data = { title, text };
    if (!nav.canShare || nav.canShare(data)) {
      try {
        await nav.share(data);
        return 'shared';
      } catch (e) {
        if (isAbort(e)) return 'cancelled';
      }
    }
  }
  return copyText(text, env);
}

/** The share sheet with the PNG when it accepts files (navigator.canShare({ files })); a download otherwise. */
export async function shareImage(blob: Blob, filename: string, title: string, env: ShareEnv = defaultEnv()): Promise<ImageResult> {
  const nav = env.navigator;
  if (nav?.share && nav.canShare && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    const data = { files: [file], title };
    let ok = false;
    try {
      ok = nav.canShare(data);
    } catch {
      ok = false;
    }
    if (ok) {
      try {
        await nav.share(data);
        return 'shared';
      } catch (e) {
        if (isAbort(e)) return 'cancelled';
      }
    }
  }
  return downloadBlob(blob, filename, env);
}

/** True when "Share…" will open a share sheet for files (else it saves the image). */
export function canShareFiles(env: ShareEnv = defaultEnv()): boolean {
  const nav = env.navigator;
  if (!nav?.share || !nav.canShare || typeof File === 'undefined') return false;
  try {
    return nav.canShare({ files: [new File([''], 'card.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}
