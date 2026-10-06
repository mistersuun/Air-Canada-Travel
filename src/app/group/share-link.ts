/** Shares a link with the Web Share sheet when there is one, else copies it. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareOrCopy(win: Window | null | undefined, url: string, title: string, text: string, preferShare = true): Promise<ShareOutcome> {
  const nav = win?.navigator;
  if (preferShare && nav?.share) {
    try {
      await nav.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (!nav?.clipboard) return 'failed';
    await nav.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
