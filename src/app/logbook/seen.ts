/**
 * Which stamps and milestones the logbook has already shown, kept in this
 * browser only (localStorage, every access guarded). Anything not yet seen
 * "inks in" with a short animation the next time it is on screen.
 */
const KEY = 'ac.logbook.seen.v1';

export function loadSeen(): Set<string> | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw == null) return null;
    const v = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return null;
  }
}

/** True when localStorage can be written (it throws or is absent in private windows and some previews). */
export function canStoreSeen(): boolean {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    ls.setItem(KEY + '.probe', '1');
    ls.removeItem(KEY + '.probe');
    return true;
  } catch {
    return false;
  }
}

/** Remembers ids as seen. An empty list is never written, so "nothing stored yet" stays distinguishable. */
export function saveSeen(ids: Iterable<string>): void {
  const add = [...ids];
  if (!add.length) return;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...new Set([...(loadSeen() ?? []), ...add])]));
  } catch {
    /* storage blocked */
  }
}

/**
 * The ids to animate. `seen` null means nothing was ever stored: a whole
 * existing history should not all stamp at once, so only a lone id animates
 * (a first boarded flight). When storage cannot be written nothing animates,
 * since the same stamps would otherwise ink in on every visit.
 */
export function unseen(ids: readonly string[], seen: ReadonlySet<string> | null, storable: boolean): Set<string> {
  if (!storable) return new Set();
  if (seen === null) return new Set(ids.length === 1 ? ids : []);
  return new Set(ids.filter(i => !seen.has(i)));
}
