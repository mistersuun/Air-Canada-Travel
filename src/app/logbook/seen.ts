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

export function saveSeen(ids: Iterable<string>): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...new Set([...(loadSeen() ?? []), ...ids])]));
  } catch {
    /* storage blocked */
  }
}

/**
 * The ids to animate. `seen` null means nothing was ever stored: a whole
 * existing history should not all stamp at once, so only a lone id animates
 * (a first boarded flight). With storage blocked nothing animates either way.
 */
export function unseen(ids: readonly string[], seen: ReadonlySet<string> | null): Set<string> {
  if (seen === null) return new Set(ids.length === 1 ? ids : []);
  return new Set(ids.filter(i => !seen.has(i)));
}
