/**
 * The round-trip planner model (dates-spec §4): which scheduled flights go out
 * on a day, which come home on another after you land, and how many of each.
 * One source for every surface (the picker, /plan, the Dates bar on
 * Destination, the Flight page's return card), so a count always equals the
 * number of rows a list shows. Pure functions, no Angular imports.
 *
 * Rules:
 * - nights = diffDays(depKey, retKey), both local departure dates (D1);
 * - a count follows the connection setting: nonstops only, or nonstops and
 *   one-stop itineraries; connections left out are counted as `hidden` (D2);
 * - a way home leaves at least minConnect minutes after the outbound lands:
 *   the picked one, else the earliest-arriving one that day (D3).
 * Counts are scheduled flights. Nothing here is a seat or load figure.
 */
import type { Coverage } from '../data/schedule-index';
import { scheduleVersion } from '../data/schedule-index';
import { t } from '../i18n/t';
import type { TimeFormat } from '../state/prefs.service';
import type { Trip } from '../trips/model';
import type { TripsService } from '../trips/trips.service';
import { placeFromDestination } from '../places/place';
import { allItineraries, DEFAULT_MIN_CONNECT, type ConnectOptions, type Itinerary } from '../utils/connections';
import { addDays, diffDays, formatClock, formatKey, isDateKey, MINUTE_MS } from '../utils/time';
import { DEFAULT_NIGHTS, MAX_NIGHTS, NIGHT_PRESETS, parseNights } from '../pages/flight/flight-model';
import { dayLabel, isOutside } from '../ui/format';
import { matchSlug } from '../ui/links';

export { NIGHT_PRESETS, MAX_NIGHTS };

export interface CountCtx {
  /** Hub-local today (state.todayKey()). */
  today: string;
  /** Math.floor(nowMs / 60_000) * 60_000; used only when key === today. */
  nowMinute: number;
  coverage: Coverage | null;
  showConnections: boolean;
  /** Identity-memoised (connections.ts NO_OPTS note). */
  connect: ConnectOptions;
  /** state.dataLoad() === 'loading'. */
  loading?: boolean;
}

export type DayState = 'ok' | 'none' | 'past' | 'unpublished' | 'before-dep' | 'loading';

export interface DayCount {
  key: string;
  state: DayState;
  total: number;
  direct: number;
  connecting: number;
  /** Connections left out by the setting (0 when connections are shown). */
  hidden: number;
  /** First / last departure, formatted in the time-format preference. */
  first: string | null;
  last: string | null;
  /** Set on return-side counts (days from the departure). */
  nights?: number;
}

/** minute floor of a clock reading, for CountCtx.nowMinute. */
export function minuteOf(nowMs: number): number {
  return Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
}

// ── One memoised source ─────────────────────────────────────────────────────

const MEMO_MAX = 2000;
const memo = new Map<string, readonly Itinerary[]>();
let memoVersion = -1;
const connectIds = new WeakMap<ConnectOptions, number>();
let nextConnectId = 1;
const stats = { hits: 0, misses: 0 };

function connectId(c: ConnectOptions): number {
  let id = connectIds.get(c);
  if (!id) connectIds.set(c, (id = nextConnectId++));
  return id;
}

/**
 * allItineraries(from, to, key, connect), memoised (LRU of 2000, keyed
 * `${from}|${to}|${key}|${connectId}`, cleared when the schedules change).
 * The arrays are shared: never mutate them.
 */
export function itinerariesOn(from: string, to: string, key: string, connect: ConnectOptions): readonly Itinerary[] {
  if (memoVersion !== scheduleVersion()) {
    memo.clear();
    memoVersion = scheduleVersion();
  }
  const id = `${from}|${to}|${key}|${connectId(connect)}`;
  const hit = memo.get(id);
  if (hit) {
    stats.hits++;
    memo.delete(id);
    memo.set(id, hit);
    return hit;
  }
  stats.misses++;
  const its = Object.freeze(allItineraries(from, to, key, connect)) as readonly Itinerary[];
  memo.set(id, its);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return its;
}

/** Memo hits and misses since the last reset (specs and perf checks). */
export function itinerariesMemoStats(): { hits: number; misses: number; size: number } {
  return { ...stats, size: memo.size };
}

/** Empties the memo and its counters (specs). */
export function resetItinerariesMemo(): void {
  memo.clear();
  stats.hits = 0;
  stats.misses = 0;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** A date key that can be picked: valid, not past, inside the window. */
export function pickable(key: unknown, today: string, coverage: Coverage | null): key is string {
  return isDateKey(key) && key >= today && !isOutside(key, coverage);
}

/** Nights between the outbound's and the return's local departure dates. */
export function nightsBetween(dep: string, ret: string): number {
  return diffDays(dep, ret);
}

/** The return day: `ret` when it is a date on or after `dep`, else dep + nights when nights is given, else null. */
export function retFrom(dep: string, ret?: string | null, nights?: string | null): string | null {
  if (isDateKey(ret) && ret >= dep) return ret;
  if (nights !== null && nights !== undefined && nights !== '') return addDays(dep, parseNights(nights));
  return null;
}

/** dep − before … center + after, starting no earlier than `min`. */
export function stripKeys(center: string, before: number, after: number, min?: string): string[] {
  let start = addDays(center, -before);
  if (min && start < min) start = min;
  const end = addDays(center, after);
  const out: string[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}

// ── Itineraries ─────────────────────────────────────────────────────────────

function closed(key: string, ctx: CountCtx): boolean {
  return !!ctx.loading || key < ctx.today || isOutside(key, ctx.coverage);
}

/** The day's itineraries still to come (today: from this minute), before the connection setting. */
function upcoming(from: string, to: string, key: string, ctx: CountCtx, afterUtc: number | null): Itinerary[] {
  if (closed(key, ctx)) return [];
  const floor = key === ctx.today ? ctx.nowMinute : -Infinity;
  const min = afterUtc === null ? floor : Math.max(floor, afterUtc);
  return itinerariesOn(from, to, key, ctx.connect).filter(it => it.departUtc >= min);
}

/**
 * Which itineraries a count or list takes: 'setting' follows the connection
 * setting; 'direct' and 'via' follow a page's Nonstop / Via seg (Destination),
 * so a strip or chip counts exactly the kind the list under it shows.
 */
export type CountKind = 'setting' | 'direct' | 'via';

function bySetting(its: readonly Itinerary[], ctx: CountCtx, kind: CountKind = 'setting'): Itinerary[] {
  if (kind === 'direct') return its.filter(it => !it.hubs.length);
  if (kind === 'via') return its.filter(it => it.hubs.length > 0);
  return ctx.showConnections ? [...its] : its.filter(it => !it.hubs.length);
}

/** hub → code on `key`, filtered by the connection setting; [] when past, outside the window or loading. */
export function outboundsOn(hub: string, code: string, key: string, ctx: CountCtx): Itinerary[] {
  return bySetting(upcoming(hub, code, key, ctx, null), ctx);
}

/** The outbound that lands first, or null. */
export function earliestArrival(outs: readonly Itinerary[]): Itinerary | null {
  let best: Itinerary | null = null;
  for (const it of outs) if (!best || it.arriveUtc < best.arriveUtc) best = it;
  return best;
}

/**
 * The earliest a way home may leave: the picked outbound's arrival (else the
 * earliest arrival among `outs`, the best case) plus the minimum connection
 * time. Null when there is no outbound.
 */
export function homeAfterUtc(picked: Itinerary | null, outs: readonly Itinerary[], connect: ConnectOptions): number | null {
  const base = picked ?? earliestArrival(outs);
  if (!base) return null;
  return base.arriveUtc + (connect.minConnect ?? DEFAULT_MIN_CONNECT) * MINUTE_MS;
}

/**
 * code → hub on `key`: inside the window, not past, allowed by the connection
 * setting, and leaving at or after `afterUtc` when it is set (D3).
 */
export function waysHome(code: string, hub: string, key: string, ctx: CountCtx, afterUtc: number | null): Itinerary[] {
  return bySetting(upcoming(code, hub, key, ctx, afterUtc), ctx);
}

// ── Counts ──────────────────────────────────────────────────────────────────

/**
 * The count for `key` from the rows a list shows (`its`) and the same day
 * before the connection setting (`all`, for `hidden`). State precedence:
 * loading > past > unpublished > before-dep > none > ok; any state but
 * none/ok counts zero.
 */
export function countDay(
  key: string,
  its: readonly Itinerary[],
  all: readonly Itinerary[],
  ctx: CountCtx,
  fmt: TimeFormat,
  opts: { dep?: string | null } = {},
): DayCount {
  const dep = opts.dep ?? null;
  const state: DayState = ctx.loading ? 'loading'
    : key < ctx.today ? 'past'
    : isOutside(key, ctx.coverage) ? 'unpublished'
    : dep && key < dep ? 'before-dep'
    : its.length ? 'ok' : 'none';
  const base = { key, state, first: null, last: null, ...(dep && key >= dep ? { nights: nightsBetween(dep, key) } : {}) };
  if (state !== 'ok' && state !== 'none') return { ...base, total: 0, direct: 0, connecting: 0, hidden: 0 };
  const direct = its.filter(it => !it.hubs.length).length;
  const hidden = ctx.showConnections ? 0 : all.filter(it => it.hubs.length > 0).length;
  if (!its.length) return { ...base, total: 0, direct: 0, connecting: 0, hidden };
  let first = its[0];
  let last = its[0];
  for (const it of its) {
    if (it.departUtc < first.departUtc) first = it;
    if (it.departUtc > last.departUtc) last = it;
  }
  return {
    ...base,
    total: its.length,
    direct,
    connecting: its.length - direct,
    hidden,
    first: formatClock(first.legs[0].depLocal, fmt),
    last: formatClock(last.legs[0].depLocal, fmt),
  };
}

/** Flights out (hub → code) per day; `kind` narrows them to one kind (default: the connection setting). */
export function outCounts(
  hub: string, code: string, keys: readonly string[], ctx: CountCtx, fmt: TimeFormat, kind: CountKind = 'setting',
): DayCount[] {
  return keys.map(k => {
    const all = upcoming(hub, code, k, ctx, null);
    return countDay(k, bySetting(all, ctx, kind), all, ctx, fmt);
  });
}

/** Ways home (code → hub) per day, with nights from `dep`; days before `dep` are 'before-dep'. */
export function homeCounts(
  code: string,
  hub: string,
  keys: readonly string[],
  dep: string,
  ctx: CountCtx,
  afterUtc: number | null,
  fmt: TimeFormat,
  kind: CountKind = 'setting',
): DayCount[] {
  return keys.map(k => {
    const all = k < dep ? [] : upcoming(code, hub, k, ctx, afterUtc);
    return countDay(k, bySetting(all, ctx, kind), all, ctx, fmt, { dep });
  });
}

export interface StayOption {
  nights: number;
  key: string;
  count: DayCount;
}

/** One option per stay length: the return day dep + n and its ways home. Exactly `nights`, in order. */
export function stayOptions(
  dep: string,
  code: string,
  hub: string,
  ctx: CountCtx,
  afterUtc: number | null,
  fmt: TimeFormat,
  nights: readonly number[] = NIGHT_PRESETS,
  kind: CountKind = 'setting',
): StayOption[] {
  const keys = nights.map(n => addDays(dep, n));
  const counts = homeCounts(code, hub, keys, dep, ctx, afterUtc, fmt, kind);
  return nights.map((n, i) => ({ nights: n, key: keys[i], count: counts[i] }));
}

/**
 * Up to `max` days within `span` of `ret` (on or after `dep`) that have ways
 * home, nearest first (the earlier on a tie), returned in date order.
 */
export function nearestHomeDays(
  code: string,
  hub: string,
  ret: string,
  dep: string,
  ctx: CountCtx,
  afterUtc: number | null,
  span = 3,
  max = 2,
): { key: string; n: number }[] {
  const found: { key: string; n: number; d: number }[] = [];
  for (let d = 1; d <= span; d++) {
    for (const k of [addDays(ret, -d), addDays(ret, d)]) {
      if (k < dep) continue;
      const n = waysHome(code, hub, k, ctx, afterUtc).length;
      if (n) found.push({ key: k, n, d });
    }
  }
  return found
    .slice(0, max)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(({ key, n }) => ({ key, n }));
}

// ── Picks across date changes (D6) ──────────────────────────────────────────

/**
 * Keeps a picked flight when the same flight number(s) fly on the new day;
 * otherwise picks nothing and offers the earliest-leaving itinerary of the
 * same kind (nonstop or connection) as a suggestion only.
 */
export function carryPick(
  prevSlug: string | null,
  its: readonly Itinerary[],
  wasNonstop: boolean,
): { it: Itinerary | null; kept: boolean; suggestion: Itinerary | null } {
  if (!prevSlug) return { it: null, kept: false, suggestion: null };
  const same = matchSlug(prevSlug, its);
  if (same) return { it: same, kept: true, suggestion: null };
  let suggestion: Itinerary | null = null;
  for (const it of its) {
    if (!it.hubs.length !== wasNonstop) continue;
    if (!suggestion || it.departUtc < suggestion.departUtc) suggestion = it;
  }
  return { it: null, kept: false, suggestion };
}

/**
 * The picked way home, and why it no longer fits: 'gone' when it does not fly
 * that day, 'beforeLanding' when it leaves before `afterUtc`. `all` is the
 * day's itineraries before the arrival filter.
 */
export function staleBack(
  backSlug: string | null,
  all: readonly Itinerary[],
  afterUtc: number | null,
): { it: Itinerary | null; stale: 'gone' | 'beforeLanding' | null } {
  if (!backSlug) return { it: null, stale: null };
  const it = matchSlug(backSlug, all);
  if (!it) return { it: null, stale: 'gone' };
  if (afterUtc !== null && it.departUtc < afterUtc) return { it, stale: 'beforeLanding' };
  return { it, stale: null };
}

/** Moving the departure to or past the return keeps the nights: ret = dep + (ret − prevDep). */
export function shiftRet(dep: string, prevDep: string, ret: string | null): { ret: string | null; moved: boolean } {
  if (!ret || dep === prevDep || dep < ret) return { ret, moved: false };
  const nights = Math.max(0, diffDays(prevDep, ret));
  const next = addDays(dep, nights);
  return { ret: next, moved: next !== ret };
}

// ── URL state (D4) ──────────────────────────────────────────────────────────

export interface PlanState {
  dep: string | null;
  ret: string | null;
  out: string | null;
  back: string | null;
}

const SLUG_RE = /^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/;

function str(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : null;
}

function slug(v: unknown): string | null {
  const s = str(v);
  return s && s.length <= 40 && SLUG_RE.test(s) ? s : null;
}

/**
 * The plan in a URL: unpickable dates are dropped, a return before the
 * departure is dropped, a same-day return is kept when `dayTrip(dep)` allows
 * it (default: always), `?nights=` gives ret = dep + N. Flight slugs are kept
 * even when they no longer match (the page shows a notice, D6); `back` needs
 * a return day.
 */
export function readPlan(
  p: Partial<Record<'dep' | 'ret' | 'out' | 'back' | 'nights', unknown>>,
  today: string,
  coverage: Coverage | null,
  dayTrip: (dep: string) => boolean = () => true,
): PlanState {
  const depRaw = str(p.dep);
  const dep = pickable(depRaw, today, coverage) ? depRaw : null;
  if (!dep) return { dep: null, ret: null, out: null, back: null };
  let ret = retFrom(dep, str(p.ret), str(p.nights));
  if (ret && (!pickable(ret, today, coverage) || (ret === dep && !dayTrip(dep)))) ret = null;
  return { dep, ret, out: slug(p.out), back: ret ? slug(p.back) : null };
}

/** Query params for a plan, without the null fields. */
export function planParams(s: PlanState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['dep', 'ret', 'out', 'back'] as const) {
    const v = s[k];
    if (v) out[k] = v;
  }
  return out;
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** 'Sat, Nov 21 08:15': an itinerary's local arrival day and time. */
export function landingLabel(it: Itinerary, today: string, fmt: TimeFormat): string {
  const last = it.legs[it.legs.length - 1];
  return `${dayLabel(it.arrDateKey, today)} ${formatClock(last.arrLocal, fmt)}`;
}

/**
 * Screen-reader text for a day count: 'Saturday, November 28, 2026, 3 ways
 * home, 2 nonstop and 1 with a connection, 8 nights'.
 */
export function dayCountAria(c: DayCount, variant: 'out' | 'home'): string {
  const date = formatKey(c.key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `${date}, ${countWords(c, variant)}`;
}

/** The words of a day count without the date: '3 ways home, 2 nonstop and 1 with a connection, 8 nights'. */
export function countWords(c: DayCount, variant: 'out' | 'home'): string {
  const parts: string[] = [];
  switch (c.state) {
    case 'loading': parts.push(t('planner.cell.loading')); break;
    case 'past': parts.push(t('planner.cell.past')); break;
    case 'unpublished': parts.push(t('planner.cell.unpublished')); break;
    case 'before-dep': parts.push(t('planner.cell.beforeDep')); break;
    case 'none': parts.push(t('planner.cell.none')); break;
    default:
      parts.push(variant === 'home' ? t('planner.count.waysHome', { n: c.total }) : t('planner.cell.out', { n: c.total }));
      if (c.connecting) parts.push(t('planner.cell.split', { direct: c.direct, connecting: c.connecting }));
  }
  if (c.hidden) parts.push(t('planner.conn.hidden', { n: c.hidden }));
  if (c.nights !== undefined) parts.push(t('planner.nights', { n: c.nights }));
  return parts.join(', ');
}

// ── Trips ───────────────────────────────────────────────────────────────────

/**
 * The home-by deadline for a return: its arrival date, 22:00, or end of day
 * when it lands after 22:00. A small-hours arrival (before 05:00) would
 * otherwise give a deadline already past, so the deadline is 08:00 that
 * morning.
 */
export function homeByFor(ret: Itinerary): { dateKey: string; hhmm: string } {
  const arr = ret.legs[ret.legs.length - 1].arrLocal;
  if (arr < '05:00') return { dateKey: ret.arrDateKey, hhmm: '08:00' };
  return { dateKey: ret.arrDateKey, hhmm: arr > '22:00' ? '23:59' : '22:00' };
}

/** The home-by for a return day with no flight picked: 22:00, on or after the outbound's arrival day. */
export function retDeadline(out: Itinerary, ret: string | null): { dateKey: string; hhmm: string } {
  const arr = out.arrDateKey;
  if (!ret) return { dateKey: addDays(arr, DEFAULT_NIGHTS), hhmm: '22:00' };
  if (ret > arr) return { dateKey: ret, hhmm: '22:00' };
  const lands = out.legs[out.legs.length - 1].arrLocal;
  return { dateKey: arr, hhmm: lands >= '22:00' ? '23:59' : '22:00' };
}

/**
 * A new trip with the outbound and (when picked) the return: home by the
 * return's homeByFor, else the return day (else the default stay after
 * landing) at 22:00. The return day is never before the outbound lands (a
 * same-day return whose picked outbound arrives the next day): it is moved
 * to the arrival day, so the deadline is never before arrival.
 */
export function startRoundTrip(
  trips: TripsService,
  a: { hub: string; code: string; out: Itinerary; back: Itinerary | null; ret: string | null },
): Trip {
  const homeBy = a.back ? homeByFor(a.back) : retDeadline(a.out, a.ret);
  const trip = trips.create({
    goal: placeFromDestination(a.code),
    fromHub: a.hub,
    outboundDate: a.out.dateKey,
    homeBy,
  });
  trips.addFlightLeg(trip.id, a.out, 'outbound');
  if (a.back) trips.addFlightLeg(trip.id, a.back, 'return');
  return trips.trip(trip.id) ?? trip;
}
