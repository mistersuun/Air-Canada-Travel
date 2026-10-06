/**
 * "Surprise me": a weighted random pick among the destinations Home is
 * showing (pure; the random source is injected so it can be tested).
 */
import type { TripStyle, TravelProfile } from '../../recs/model';
import type { RouteEntry } from '../../utils/routes';
import type { FlightInstance } from '../../utils/week';
import { WEEKDAY_SHORT, formatClock, weekdayIndex } from '../../utils/time';
import type { TimeFormat } from '../../state/prefs.service';

/** How many recent picks are skipped. */
export const SURPRISE_RECENT = 5;
/** Weight multiplier for a destination of a style the traveller likes. */
export const STYLE_NUDGE = 1.5;
/** Candidate arcs flicked through before settling (including the pick). */
export const FLICK_COUNT = 7;

const STORAGE_KEY = 'ac.surprise.recent.v1';

function code(e: RouteEntry): string {
  return e.destination.code;
}

/** Entries with real flights in scope (the only ones that can be picked). */
export function surpriseCandidates(entries: readonly RouteEntry[]): RouteEntry[] {
  return entries.filter(e => e.flights.length > 0);
}

function upcoming(e: RouteEntry, nowMs: number): number {
  return e.flights.filter(f => f.depUtc >= nowMs).length;
}

function weight(e: RouteEntry, profile: Pick<TravelProfile, 'styles'> | null, nowMs: number, live: boolean): number {
  const liked = !!profile?.styles.includes(e.destination.type as TripStyle);
  return (live ? upcoming(e, nowMs) : e.flights.length) * (liked ? STYLE_NUDGE : 1);
}

/**
 * Pick one entry, weighted by its departures (nudged by the profile's styles),
 * skipping the destinations in `recent`. When every candidate is recent the
 * exclusion is dropped rather than returning nothing. Null when no entry has
 * flights.
 */
export function surprisePick(
  entries: readonly RouteEntry[],
  profile: Pick<TravelProfile, 'styles'> | null,
  recent: readonly string[],
  rng: () => number,
  nowMs = -Infinity,
): RouteEntry | null {
  const all = surpriseCandidates(entries);
  if (!all.length) return null;
  // Only flights still to depart count; when none are left, fall back to the whole scope.
  const notDeparted = all.filter(e => upcoming(e, nowMs) > 0);
  const live = notDeparted.length > 0;
  const base = live ? notDeparted : all;
  const skip = new Set(recent);
  const fresh = base.filter(e => !skip.has(code(e)));
  let pool = fresh;
  if (!pool.length) {
    // Everything is recent: still avoid repeating the very last pick when there is a choice.
    const last = recent[recent.length - 1];
    const others = base.filter(e => code(e) !== last);
    pool = others.length ? others : base;
  }
  const total = pool.reduce((s, e) => s + weight(e, profile, nowMs, live), 0);
  let r = Math.min(Math.max(rng(), 0), 0.999999999) * total;
  for (const e of pool) {
    r -= weight(e, profile, nowMs, live);
    if (r < 0) return e;
  }
  return pool[pool.length - 1];
}

/** Up to `n` distinct decoy codes (never `pick`), ending with the pick: the flick sequence. */
export function flickSequence(
  entries: readonly RouteEntry[], pick: string, n: number, rng: () => number,
): string[] {
  const others = surpriseCandidates(entries).map(code).filter(c => c !== pick);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  return [...others.slice(0, Math.max(0, n - 1)), pick];
}

/** The first departure in scope at or after `nowMs`, else the first. */
export function nextDeparture(e: RouteEntry, nowMs: number): FlightInstance | null {
  return e.flights.find(f => f.depUtc >= nowMs) ?? e.flights[0] ?? null;
}

/** 'nonstop Thu 21:40' (empty when there is no flight). */
export function surpriseMeta(e: RouteEntry, nowMs: number, fmt: TimeFormat = '24h'): string {
  const f = nextDeparture(e, nowMs);
  return f ? `nonstop ${WEEKDAY_SHORT[weekdayIndex(f.dateKey)]} ${formatClock(f.depLocal, fmt)}` : '';
}

/** 'Porto · nonstop Thu 21:40'. */
export function surpriseLine(e: RouteEntry, nowMs: number, fmt: TimeFormat = '24h'): string {
  const m = surpriseMeta(e, nowMs, fmt);
  return m ? `${e.destination.city} · ${m}` : e.destination.city;
}

// ── Recent picks (sessionStorage; every access guarded) ──────────────────────

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string').slice(-SURPRISE_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberPick(c: string): string[] {
  const next = [...loadRecent().filter(x => x !== c), c].slice(-SURPRISE_RECENT);
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  return next;
}
