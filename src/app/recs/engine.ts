/**
 * On-device recommendation engine (extras spec §5.3). Pure and deterministic.
 *
 * Inputs: published schedules (through flightsOn / allItineraries /
 * getSchedulesForRoute / getCoverage / isCovered only), the user's stars, the
 * user's own outcome log, the travel profile and optional climate normals.
 *
 * Honesty: every fact line carries a label (Scheduled, Estimated, Saved by
 * you, Typical); lines show counts and times, never odds, chances or
 * percentages, and never imply a free seat. `rank` is an internal sort key
 * that no string helper ever renders. Party size only prefers days with more
 * departures; it never guesses seats.
 */
import { DESTINATIONS, Destination } from '../data/destinations';
import { getCoverage, getSchedulesForRoute, isCovered } from '../data/schedule-index';
import { CORRIDORS } from '../places/corridors';
import type { TimeFormat } from '../state/prefs.service';
import { refsFromItinerary } from '../trips/engine/legs';
import type { Outcome } from '../trips/model';
import { destPath, flightPath, reachPath } from '../ui/links';
import { findDestination } from '../utils/airports';
import { ConnectOptions, Itinerary, allItineraries, directItinerary } from '../utils/connections';
import { WEEKDAY_LONG, WEEKDAY_SHORT, addDays, diffDays, formatClock, formatKey, hhmmToMin, weekdayIndex } from '../utils/time';
import { flightsOn } from '../utils/week';
import { climateFor } from './climate';
import { LongWeekend, longWeekends, pickDays } from './long-weekends';
import { ClimateIndex, Reason, RecGroup, RecLine, Recommendation, TravelProfile, TripStyle } from './model';
import { daysRange, joinAnd, stylesDisplay } from './profile';

export interface RecInput {
  profile: TravelProfile;
  hub: string;
  todayKey: string;
  nowMs: number;
  favourites: readonly string[];
  outcomes: readonly Outcome[];
  /** AC codes of active trips' goals/gateways (excluded from the 'trips' context). */
  activeGoalCodes: readonly string[];
  climate: ClimateIndex | null;
  showConnections: boolean;
  connect: ConnectOptions;
  context: 'explore' | 'trips';
  /** Clock format for the time lines (prefs.timeFormat). Default '24h'. */
  fmt?: TimeFormat;
}

/** Max long weekends considered, and the look-ahead for them (days). */
export const LW_MAX = 2;
export const LW_HORIZON = 60;
/** With an empty profile, holiday ideas keep to flights of 7h or less. */
export const EMPTY_PROFILE_MAX_HOURS = 7;
/** Season endings: how far ahead the last flight may be. */
export const SEASON_AHEAD_DAYS = 45;
/** Style / log schedule window (days from today). */
export const NEXT_DAYS = 14;
/** Explore shows at most this many recommendations in total. */
export const EXPLORE_MAX = 7;

// ── Small helpers ───────────────────────────────────────────────────────────

const CANDIDATES: readonly Destination[] = (() => {
  const seen = new Set<string>();
  return DESTINATIONS.filter(d => d.type !== 'Hub' && !seen.has(d.code) && !!seen.add(d.code));
})();

function isEmptyProfile(p: TravelProfile): boolean {
  return p.updatedAt === null;
}

/** Max flight minutes, or null for any. An empty profile uses 7h. */
function maxMinutes(p: TravelProfile): number | null {
  if (p.maxFlightHours !== null) return p.maxFlightHours * 60;
  return isEmptyProfile(p) ? EMPTY_PROFILE_MAX_HOURS * 60 : null;
}

function styleOk(p: TravelProfile, d: Destination): boolean {
  return isEmptyProfile(p) || !p.styles.length || p.styles.includes(d.type as TripStyle);
}

/** 'Fri Oct 9'. */
export function shortDay(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

/** 'Jun 1, 2027'. */
function longDate(key: string): string {
  return formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' });
}

function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[weekdayIndex(key)];
}

/** '1h30', '45min', '7h'. */
export function shortDuration(min: number): string {
  const m = Math.max(0, Math.round(min / 5) * 5);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}min`;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
}

/**
 * Itineraries from → to on a day, inside coverage, under the max: nonstops;
 * one-stops only when connections are on and the day has no nonstop at all.
 * Estimated legs never count (only Scheduled facts are shown).
 */
export function dayItineraries(input: RecInput, from: string, to: string, day: string): Itinerary[] {
  if (!isCovered(day, input.hub)) return [];
  const max = maxMinutes(input.profile);
  const fits = (it: Itinerary) => !it.estimated && (max === null || it.totalMin <= max);
  const nonstops = flightsOn(from, to, day);
  if (nonstops.length) return nonstops.map(directItinerary).filter(fits);
  if (!input.showConnections) return [];
  return allItineraries(from, to, day, input.connect).filter(it => it.legs.length > 1 && fits(it));
}

function via(it: Itinerary): string {
  return it.hubs.length ? ` via ${it.hubs.join(', ')}` : '';
}

function clock(hhmm: string, fmt: TimeFormat | undefined): string {
  return formatClock(hhmm, fmt ?? '24h');
}

function recId(kind: Recommendation['kind'], key: string, outKey: string | null): string {
  return `${kind}:${key}:${outKey ?? ''}`;
}

function profileReason(parts: string[]): Reason[] {
  if (!parts.length) return [];
  const text = parts.join(', ');
  return [{ kind: 'profile', text: text[0].toUpperCase() + text.slice(1) }];
}

/** 'You travel Thu to Mon', 'like City and Sun', 'flights under 7h' (only the parts that are set). */
function profileParts(p: TravelProfile): string[] {
  if (isEmptyProfile(p)) return [];
  const parts: string[] = [];
  const d = daysRange(p.days, ' to ');
  if (d) parts.push(`you travel ${d}`);
  if (p.styles.length) parts.push(`like ${joinAnd(stylesDisplay(p.styles))}`);
  if (p.maxFlightHours !== null) parts.push(`flights under ${p.maxFlightHours}h`);
  return parts;
}

function nextMonth(todayKey: string): number {
  const m = Number(todayKey.slice(5, 7));
  return m === 12 ? 1 : m + 1;
}

// ── Schedule line shared by style and yourLog ───────────────────────────────

interface Upcoming { count: number; its: Itinerary[] }

function upcoming(input: RecInput, code: string, profileDaysOnly: boolean): Upcoming {
  const its: Itinerary[] = [];
  for (let i = 0; i < NEXT_DAYS; i++) {
    const day = addDays(input.todayKey, i);
    const iso = weekdayIndex(day) + 1;
    if (profileDaysOnly && input.profile.days.length && !input.profile.days.includes(iso)) continue;
    its.push(...dayItineraries(input, input.hub, code, day));
  }
  return { count: its.length, its };
}

/**
 * 'AC812 21:45 most evenings · about 6h35' when one flight number leaves on at
 * least 4 of the next 7 days at about the same time; else
 * '9 flights in the next 2 weeks · about 6h35'.
 */
export function scheduleLine(u: Upcoming, todayKey: string, fmt?: TimeFormat): string {
  const dur = `about ${shortDuration(median(u.its.map(it => it.totalMin)))}`;
  const week = u.its.filter(it => it.legs.length === 1 && diffDays(todayKey, it.dateKey) < 7);
  const byNumber = new Map<string, Itinerary[]>();
  for (const it of week) {
    const n = it.legs[0].flightNumber;
    if (!n) continue;
    byNumber.set(n, [...(byNumber.get(n) ?? []), it]);
  }
  let best: { n: string; t: string; days: number } | null = null;
  for (const [n, list] of [...byNumber.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const times = list.map(it => it.legs[0].depLocal);
    const mode = [...times].sort((a, b) => times.filter(t => t === b).length - times.filter(t => t === a).length || a.localeCompare(b))[0];
    const near = list.filter(it => Math.abs(hhmmToMin(it.legs[0].depLocal) - hhmmToMin(mode)) <= 60);
    const days = new Set(near.map(it => it.dateKey)).size;
    if (days >= 4 && (!best || days > best.days)) best = { n, t: mode, days };
  }
  if (best) {
    const min = hhmmToMin(best.t);
    const when = min >= 17 * 60 ? 'most evenings' : min < 12 * 60 ? 'most mornings' : 'most days';
    return `${best.n} ${clock(best.t, fmt)} ${when} · ${dur}`;
  }
  const stops = u.its.filter(it => it.legs.length > 1).length;
  const what = stops === 0 ? `flight${u.count === 1 ? '' : 's'}`
    : stops === u.count ? `one-stop option${u.count === 1 ? '' : 's'}`
    : 'options, some with a stop,';
  return `${u.count} ${what} in the next 2 weeks · ${dur}`;
}

// ── Kind: holiday ───────────────────────────────────────────────────────────

/** Recommendations for one long weekend: the top 2, of different types where possible. */
export function holidayRecs(input: RecInput, lw: LongWeekend): Recommendation[] {
  const days = pickDays(lw, input.profile);
  if (!days) return [];
  const { outKey, backKey } = days;
  const p = input.profile;
  const fmt = input.fmt;
  const outDay = weekdayShort(outKey);
  const backDay = weekdayShort(backKey);
  const hName = lw.holiday.name;
  const holidayText = p.length === 'day' || p.length === 'week'
    ? hName
    : `Holiday ${WEEKDAY_LONG[weekdayIndex(lw.holiday.dateKey)]}`;

  const recs: Recommendation[] = [];
  for (const d of CANDIDATES) {
    if (!styleOk(p, d)) continue;
    const out = dayItineraries(input, input.hub, d.code, outKey);
    const back = dayItineraries(input, d.code, input.hub, backKey);
    if (!out.length || !back.length) continue;
    const id = recId('holiday', d.code, outKey);
    if (p.dismissed.includes(id)) continue;

    const lines: RecLine[] = [];
    if (out.length > 2 || back.length > 2) {
      const viaOut = out.every(it => it.hubs.length) ? via(out[0]) : '';
      lines.push({ text: `${out.length} flight${out.length === 1 ? '' : 's'} out ${outDay}${viaOut} · ${back.length} back ${backDay}`, label: 'scheduled' });
      const each = (median(out.map(it => it.totalMin)) + median(back.map(it => it.totalMin))) / 2;
      lines.push({ text: `About ${shortDuration(each)} each way`, label: null });
    } else {
      const times = (its: Itinerary[]) => its.map(it => `${clock(it.legs[0].depLocal, fmt)}${via(it)}`).join(', ');
      lines.push({ text: `Out ${outDay} ${times(out)}`, label: 'scheduled' });
      lines.push({ text: `Back ${backDay} ${times(back)}`, label: 'scheduled' });
    }

    const shortest = Math.min(...out.map(it => it.totalMin));
    const minCount = Math.min(out.length, back.length);
    const rank = 3 * minCount
      + (p.styles.includes(d.type as TripStyle) ? 2 : 0)
      + (input.favourites.includes(d.code) ? 2 : 0)
      - shortest / 120
      + (p.party >= 2 ? minCount : 0);

    recs.push({
      id, kind: 'holiday', code: d.code, placeId: null, title: d.city,
      out: { dateKey: outKey, flights: out.flatMap(refsFromItinerary) },
      back: { dateKey: backKey, flights: back.flatMap(refsFromItinerary) },
      lines,
      weather: climateFor(input.climate, d.code, Number(outKey.slice(5, 7))),
      reason: [{ kind: 'holiday', text: holidayText }, ...profileReason(profileParts(p))],
      link: { path: flightPath(d.code, outKey), query: {} },
      rank,
    });
  }
  recs.sort(byRank);
  const first = recs[0];
  if (!first) return [];
  const firstType = typeOf(first.code);
  const second = recs.slice(1).find(r => typeOf(r.code) !== firstType) ?? recs[1];
  return second ? [first, second] : [first];
}

function typeOf(code: string | null): string | null {
  return findDestination(code)?.type ?? null;
}

function byRank(a: Recommendation, b: Recommendation): number {
  return b.rank - a.rank || a.id.localeCompare(b.id);
}

// ── Kind: seasonEnding ──────────────────────────────────────────────────────

/** Gap (days) between filings that still counts as the same season. */
const SEASON_GAP = 14;

/**
 * The end of the season running now (or starting within a week) and the next
 * record that starts after a break, from the hub's records for a route.
 */
export function seasonWindow(hub: string, code: string, todayKey: string): { last: string; resume: string | null } | null {
  const recs = [...getSchedulesForRoute(hub, code)]
    .filter(r => r.toDate >= todayKey && r.fromDate <= r.toDate)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.toDate.localeCompare(b.toDate));
  if (!recs.length || recs[0].fromDate > addDays(todayKey, 7)) return null;
  let end = recs[0].toDate;
  let resume: string | null = null;
  for (const r of recs.slice(1)) {
    if (r.fromDate <= addDays(end, SEASON_GAP)) {
      if (r.toDate > end) end = r.toDate;
    } else {
      resume = r.fromDate;
      break;
    }
  }
  return { last: end, resume };
}

function lastFlightOnOrBefore(from: string, to: string, key: string, floorKey: string) {
  for (let d = key; d >= floorKey; d = addDays(d, -1)) {
    const f = flightsOn(from, to, d);
    if (f.length) return f[f.length - 1];
  }
  return null;
}

function firstFlightOnOrAfter(from: string, to: string, key: string, days = 14) {
  for (let i = 0; i < days; i++) {
    const f = flightsOn(from, to, addDays(key, i));
    if (f.length) return f[0];
  }
  return null;
}

/** Starred routes whose current season ends within 45 days (at most 2). */
export function seasonEndingRecs(input: RecInput): Recommendation[] {
  const cov = getCoverage(input.hub);
  const out: Recommendation[] = [];
  for (const code of input.favourites) {
    const d = findDestination(code);
    if (!d || d.type === 'Hub') continue;
    const w = seasonWindow(input.hub, code, input.todayKey);
    if (!w) continue;
    const lastOut = lastFlightOnOrBefore(input.hub, code, w.last, input.todayKey);
    if (!lastOut) continue;
    const last = lastOut.dateKey;
    if (last < input.todayKey || diffDays(input.todayKey, last) > SEASON_AHEAD_DAYS) continue;
    if (!cov.to || last >= cov.to) continue;
    const id = recId('seasonEnding', code, null);
    if (input.profile.dismissed.includes(id)) continue;

    let text = `Last flight there ${lastOut.flightNumber ?? ''} ${shortDay(last)}`.replace('  ', ' ');
    const lastHome = lastFlightOnOrBefore(code, input.hub, addDays(last, 3), last);
    if (lastHome) text += ` · last home ${lastHome.flightNumber ?? ''} ${shortDay(lastHome.dateKey)}`.replace('  ', ' ');
    const back = w.resume ? firstFlightOnOrAfter(input.hub, code, w.resume) : null;
    const backText = w.resume ? `Back from ${longDate(back?.dateKey ?? w.resume)}` : 'No later flights published yet';

    out.push({
      id, kind: 'seasonEnding', code, placeId: null, title: d.city,
      out: null, back: null,
      lines: [{ text, label: 'scheduled' }, { text: backText, label: 'scheduled' }],
      weather: null,
      reason: [{ kind: 'starred', text: `You starred ${d.city}` }],
      link: { path: destPath(code), query: {} },
      rank: -diffDays(input.todayKey, last),
    });
  }
  return out.sort(byRank).slice(0, 2);
}

// ── Kind: style ─────────────────────────────────────────────────────────────

/** Destinations of the profile's styles with ≥ 3 departures on profile days in the next 2 weeks (at most 2). */
export function styleRecs(input: RecInput, exclude: ReadonlySet<string>): Recommendation[] {
  const p = input.profile;
  if (isEmptyProfile(p) || !p.styles.length) return [];
  const recs: Recommendation[] = [];
  for (const d of CANDIDATES) {
    if (exclude.has(d.code) || !p.styles.includes(d.type as TripStyle)) continue;
    const id = recId('style', d.code, null);
    if (p.dismissed.includes(id)) continue;
    const u = upcoming(input, d.code, true);
    if (u.count < 3) continue;
    const reason = `Matches ${d.type}${p.maxFlightHours !== null ? `, under ${p.maxFlightHours}h` : ''}`;
    recs.push({
      id, kind: 'style', code: d.code, placeId: null, title: d.city,
      out: null, back: null,
      lines: [{ text: scheduleLine(u, input.todayKey, input.fmt), label: 'scheduled' }],
      weather: climateFor(input.climate, d.code, nextMonth(input.todayKey)),
      reason: [{ kind: 'profile', text: reason }],
      link: { path: destPath(d.code), query: {} },
      rank: u.count,
    });
  }
  return recs.sort(byRank).slice(0, 2);
}

// ── Kind: yourLog ───────────────────────────────────────────────────────────

/** Routes from the hub where the user's own log shows more boardings than misses (counts only). */
export function logRecs(input: RecInput): Recommendation[] {
  const p = input.profile;
  const byDest = new Map<string, Outcome[]>();
  for (const o of input.outcomes) {
    if (o.origin !== input.hub) continue;
    byDest.set(o.dest, [...(byDest.get(o.dest) ?? []), o]);
  }
  const recs: Recommendation[] = [];
  for (const [code, list] of [...byDest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const d = findDestination(code);
    if (!d || d.type === 'Hub') continue;
    const boarded = list.filter(o => o.kind === 'allBoarded' || o.kind === 'someBoarded').length;
    const tried = list.filter(o => o.kind !== 'didntTry').length;
    if (!(boarded >= 2 && boarded > tried - boarded)) continue;
    const id = recId('yourLog', code, null);
    if (p.dismissed.includes(id)) continue;

    const lines: RecLine[] = [{ text: `You boarded ${boarded} of ${tried} tries`, label: 'saved' }];
    const u = upcoming(input, code, false);
    if (u.count) lines.unshift({ text: scheduleLine(u, input.todayKey, input.fmt), label: 'scheduled' });

    const parts: string[] = [];
    if (!isEmptyProfile(p)) {
      const typeFits = p.styles.includes(d.type as TripStyle);
      const max = p.maxFlightHours;
      const underMax = max !== null && u.count > 0 && median(u.its.map(it => it.totalMin)) <= max * 60;
      if (typeFits || underMax) {
        parts.push(`it's ${typeFits ? `a ${d.type} trip` : 'a trip'}${underMax ? ` under ${max}h` : ''}`);
      }
    }
    recs.push({
      id, kind: 'yourLog', code, placeId: null, title: d.city,
      out: null, back: null, lines,
      weather: climateFor(input.climate, code, nextMonth(input.todayKey)),
      reason: [{ kind: 'log', text: 'Your own outcome log' }, ...parts.map(text => ({ kind: 'profile' as const, text }))],
      link: { path: destPath(code), query: {} },
      rank: boarded * 10 - (tried - boarded),
    });
  }
  return recs.sort(byRank);
}

// ── Kind: onward (P2) ───────────────────────────────────────────────────────

/** One city past a gateway by train or bus (≤ 4h ride), when onward travel is set to Any. */
export function onwardRecs(input: RecInput, exclude: ReadonlySet<string>): Recommendation[] {
  const p = input.profile;
  if (isEmptyProfile(p) || p.onwardBudget !== 'any') return [];
  if (p.styles.length && !p.styles.includes('City')) return [];
  const rows = [...CORRIDORS]
    .filter(c => c.rideMin <= 240)
    .sort((a, b) => a.rideMin - b.rideMin || a.code.localeCompare(b.code) || a.geonameId - b.geonameId);
  for (const c of rows) {
    const placeId = `gn-${c.geonameId}`;
    if (exclude.has(placeId) || exclude.has(c.code)) continue;
    const id = recId('onward', placeId, null);
    if (p.dismissed.includes(id)) continue;
    let dep: string | null = null;
    for (let i = 0; i < NEXT_DAYS && !dep; i++) {
      const day = addDays(input.todayKey, i);
      if (isCovered(day, input.hub) && flightsOn(input.hub, c.code, day).length) dep = day;
    }
    if (!dep) continue;
    const gateway = findDestination(c.code)?.city ?? c.code;
    const mode = (c.modeLabel ?? c.mode).toLowerCase();
    return [{
      id, kind: 'onward', code: null, placeId, title: c.city,
      out: null, back: null,
      lines: [{ text: `${c.city} via ${gateway} · ${mode} about ${shortDuration(c.rideMin)}`, label: 'estimated' }],
      weather: null,
      reason: [{ kind: 'profile', text: 'Onward travel set to Any, City trip' }],
      link: { path: reachPath(placeId), query: { dep } },
      rank: -c.rideMin,
    }];
  }
  return [];
}

// ── Text ────────────────────────────────────────────────────────────────────

/**
 * 'Holiday Monday. You travel Thu to Mon, like City and Sun, flights under 7h.'
 * A reason starting in lower case continues the previous sentence
 * ('Your own outcome log, and it's a City trip under 7h.').
 */
export function whyText(r: Recommendation): string {
  let s = '';
  for (const reason of r.reason) {
    const t = reason.text.trim().replace(/\.$/, '');
    if (!t) continue;
    if (!s) s = t[0].toUpperCase() + t.slice(1);
    else if (t[0] === t[0].toLowerCase() && t[0] !== t[0].toUpperCase()) s += `, and ${t}`;
    else s += `. ${t}`;
  }
  return s ? `${s}.` : '';
}

/** 'Thanksgiving long weekend in 8 days' ('tomorrow' at 1 day, 'today' at 0). */
export function holidayGroupTitle(name: string, todayKey: string, outKey: string): string {
  const n = diffDays(todayKey, outKey);
  const when = n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  return `${name} long weekend ${when}`;
}

/** 'Fri Oct 9 → Mon Oct 12'. */
export function holidayGroupAside(outKey: string, backKey: string): string {
  return `${shortDay(outKey)} → ${shortDay(backKey)}`;
}

// ── Assembly ────────────────────────────────────────────────────────────────

function keyOf(r: Recommendation): string {
  return r.code ?? r.placeId ?? r.id;
}

function takeUnique(recs: readonly Recommendation[], used: Set<string>, max: number): Recommendation[] {
  const out: Recommendation[] = [];
  for (const r of recs) {
    if (out.length >= max) break;
    const k = keyOf(r);
    if (used.has(k)) continue;
    used.add(k);
    out.push(r);
  }
  return out;
}

/** The groups for Explore ("For you") or the Trips tab ("Ideas for later"). Deterministic. */
export function recommend(input: RecInput): RecGroup[] {
  const empty = isEmptyProfile(input.profile);
  const lws = longWeekends(input.todayKey, LW_HORIZON, input.hub)
    .filter(lw => pickDays(lw, input.profile) !== null)
    .slice(0, LW_MAX);

  if (input.context === 'trips') {
    const used = new Set<string>(input.activeGoalCodes);
    const pool = [
      ...(empty ? [] : logRecs(input)),
      ...(empty ? [] : styleRecs(input, used)),
      ...(lws.length ? holidayRecs(input, lws[0]).slice(0, 1) : []),
    ];
    const items = takeUnique(pool, used, 3);
    return items.length ? [{ id: 'ideas', title: 'Ideas for later', aside: null, items }] : [];
  }

  const used = new Set<string>();
  const groups: RecGroup[] = [];
  for (const lw of lws) {
    const items = takeUnique(holidayRecs(input, lw), used, 2);
    if (!items.length) continue;
    const { outKey, backKey } = pickDays(lw, input.profile)!;
    groups.push({
      id: lw.id,
      title: holidayGroupTitle(lw.name, input.todayKey, outKey),
      aside: holidayGroupAside(outKey, backKey),
      items,
    });
  }
  const season = takeUnique(seasonEndingRecs(input), used, 2);
  if (season.length) groups.push({ id: 'season', title: 'Season ends soon', aside: null, items: season });
  if (!empty) {
    const more = takeUnique([...logRecs(input), ...styleRecs(input, used), ...onwardRecs(input, used)], used, 3);
    if (more.length) groups.push({ id: 'more', title: 'More for you', aside: null, items: more });
  }

  // Cap the total, trimming from the end.
  let left = EXPLORE_MAX;
  return groups
    .map(g => {
      const items = g.items.slice(0, Math.max(0, left));
      left -= items.length;
      return { ...g, items };
    })
    .filter(g => g.items.length);
}
