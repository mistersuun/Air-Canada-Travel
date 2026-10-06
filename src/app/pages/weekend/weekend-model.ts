/**
 * Weekend finder (/weekend): "I'm off Fri 5pm, must be home Sun 10pm, where can
 * I go?". Pure. For every destination with an outbound after the leave-after
 * time, the paired returns that still get home by the deadline are counted
 * with the home-by engine, then destinations are ranked by tries home and by
 * time on the ground. Facts only: counts and times, never odds.
 */
import { getCoverage, isCovered } from '../../data/schedule-index';
import { DESTINATIONS } from '../../data/destinations';
import { MIN_STAY_MIN, pairable } from '../../recs/engine';
import { deadlineUtc, triesOnDay } from '../../trips/engine/homeby';
import { airportTz } from '../../utils/airports';
import { ConnectOptions, Itinerary, NO_OPTS, directItineraries, findItineraries } from '../../utils/connections';
import { MINUTE_MS, addDays, diffDays, formatKey, isDateKey, toUtcMs, weekdayIndex } from '../../utils/time';
import { coverageHubFor } from '../../utils/week';

export type WeekendPreset = 'this' | 'next' | 'fri-sun' | 'sat-mon' | 'custom';

/** Hub-local wall-clock window: leave at or after leaveKey/leaveHhmm, be home by homeKey/homeHhmm. */
export interface WeekendWindow { leaveKey: string; leaveHhmm: string; homeKey: string; homeHhmm: string }

export const WEEKEND_PRESETS: readonly { value: WeekendPreset; label: string }[] = [
  { value: 'this', label: 'This weekend' },
  { value: 'next', label: 'Next weekend' },
  { value: 'fri-sun', label: 'Fri eve → Sun' },
  { value: 'sat-mon', label: 'Sat → Mon' },
  { value: 'custom', label: 'Custom' },
];

/** Outbound flights leave on the leave day or at most this many days in all. */
export const OUT_DAYS = 2;
/** The page lists at most this many destinations at first. */
export const WEEKEND_LIMIT = 40;

/**
 * The Friday of the weekend to plan: this week's Friday Mon to Fri, the
 * current weekend's Friday on Saturday, next week's Friday on Sunday (that
 * weekend is nearly over).
 */
export function upcomingFriday(todayKey: string): string {
  const wd = weekdayIndex(todayKey);   // Mon = 0
  if (wd <= 4) return addDays(todayKey, 4 - wd);
  return wd === 5 ? addDays(todayKey, -1) : addDays(todayKey, 5);
}

/** The window for a preset on a hub-local today. 'custom' returns the default (this weekend) to start from. */
export function presetWindow(preset: WeekendPreset, todayKey: string): WeekendWindow {
  const fri = upcomingFriday(todayKey);
  switch (preset) {
    case 'next': return { leaveKey: addDays(fri, 7), leaveHhmm: '17:00', homeKey: addDays(fri, 9), homeHhmm: '22:00' };
    case 'fri-sun': return { leaveKey: fri, leaveHhmm: '17:00', homeKey: addDays(fri, 2), homeHhmm: '12:00' };
    case 'sat-mon': return { leaveKey: addDays(fri, 1), leaveHhmm: '06:00', homeKey: addDays(fri, 3), homeHhmm: '22:00' };
    default: return { leaveKey: fri, leaveHhmm: '17:00', homeKey: addDays(fri, 2), homeHhmm: '22:00' };
  }
}

export interface WeekendInput {
  hub: string;
  nowMs: number;
  window: WeekendWindow;
  connect?: ConnectOptions;
  /** One-stop outbounds and returns count too (the app's Show connections setting). */
  showConnections: boolean;
  /** Destination codes to try; defaults to every destination. */
  codes?: readonly string[];
}

export interface WeekendOption {
  code: string;
  /** Outbound options that pair with a return, by departure. */
  out: Itinerary[];
  /** Returns that get home by the deadline, by departure ("tries home"). */
  tries: Itinerary[];
  /** The latest day with a try, never before the outbound arrival date: what ?ret= carries. */
  retKey: string;
  /** How many of the tries are nonstop. */
  directTries: number;
  /** Earliest outbound arrival to the last try's departure, in whole hours. */
  hoursThere: number;
}

export function windowValid(w: WeekendWindow, hub: string): boolean {
  const tz = airportTz(hub);
  return toUtcMs(w.homeKey, w.homeHhmm, tz) > toUtcMs(w.leaveKey, w.leaveHhmm, tz);
}

const ALL_CODES: readonly string[] = [...new Set(DESTINATIONS.map(d => d.code))];

/** Outbound itineraries from the hub: direct, plus one-stop when connections are shown; not departed, not estimated. */
export function windowOutbound(input: WeekendInput, code: string): Itinerary[] {
  const { hub, nowMs, window: w } = input;
  const connect = input.connect ?? NO_OPTS;
  const leaveUtc = toUtcMs(w.leaveKey, w.leaveHhmm, airportTz(hub));
  const latest = deadlineUtc({ dateKey: w.homeKey, hhmm: w.homeHhmm }, hub) - MIN_STAY_MIN * MINUTE_MS;
  const cov = coverageHubFor(hub, code) ?? hub;
  const out: Itinerary[] = [];
  const days = Math.min(OUT_DAYS, diffDays(w.leaveKey, w.homeKey) + 1);
  for (let i = 0; i < days; i++) {
    const day = addDays(w.leaveKey, i);
    if (!isCovered(day, cov)) continue;
    const its = [
      ...directItineraries(hub, code, day),
      ...(input.showConnections ? findItineraries(hub, code, day, connect).filter(it => it.legs.length > 1) : []),
    ];
    for (const it of its) {
      if (it.estimated || it.departUtc <= nowMs || it.departUtc < leaveUtc || it.arriveUtc > latest) continue;
      out.push(it);
    }
  }
  return out.sort((a, b) => a.departUtc - b.departUtc || a.arriveUtc - b.arriveUtc);
}

/** One destination, or null when it has no outbound in the window or no return that pairs and beats the deadline. */
export function weekendOption(input: WeekendInput, code: string): WeekendOption | null {
  const { hub, window: w } = input;
  if (code === hub) return null;
  const out = windowOutbound(input, code);
  if (!out.length) return null;
  const connect = input.connect ?? NO_OPTS;
  const deadline = deadlineUtc({ dateKey: w.homeKey, hhmm: w.homeHhmm }, hub);
  const cov = coverageHubFor(code, hub) ?? hub;
  const firstArrive = Math.min(...out.map(it => it.arriveUtc));
  const stay = MIN_STAY_MIN * MINUTE_MS;

  const back: Itinerary[] = [];
  const days = Math.min(diffDays(out[0].dateKey, w.homeKey), 20);
  for (let i = 0; i <= days; i++) {
    const day = addDays(out[0].dateKey, i);
    if (!isCovered(day, cov)) continue;
    for (const t of triesOnDay(code, hub, day, deadline, connect)) {
      const it = t.itinerary;
      if (it.departUtc >= firstArrive + stay && (input.showConnections || it.legs.length === 1)) back.push(it);
    }
  }
  if (!back.length) return null;
  const paired = pairable(out, back);
  if (!paired.out.length || !paired.back.length) return null;

  const lastKey = paired.back.reduce((k, it) => (it.dateKey > k ? it.dateKey : k), paired.back[0].dateKey);
  const retKey = lastKey < out[0].arrDateKey ? out[0].arrDateKey : lastKey;
  const arrive = Math.min(...paired.out.map(it => it.arriveUtc));
  const lastDep = Math.max(...paired.back.map(it => it.departUtc));
  return {
    code, out: paired.out, tries: paired.back, retKey, directTries: paired.back.filter(it => it.legs.length === 1).length,
    hoursThere: Math.max(0, Math.round((lastDep - arrive) / (60 * MINUTE_MS))) };
}

/** Tries home, then hours on the ground, both descending; the code keeps the order stable. */
export function compareWeekend(a: WeekendOption, b: WeekendOption): number {
  return b.tries.length - a.tries.length || b.hoursThere - a.hoursThere || a.code.localeCompare(b.code);
}

/** Every destination that works for the window, ranked. Only codes with an outbound in the window reach the return search. */
export function weekendOptions(input: WeekendInput): WeekendOption[] {
  if (!windowValid(input.window, input.hub)) return [];
  const out: WeekendOption[] = [];
  for (const code of input.codes ?? ALL_CODES) {
    const o = weekendOption(input, code);
    if (o) out.push(o);
  }
  return out.sort(compareWeekend);
}

/** '3 out · 5 tries home · ~40h there'; with connections on and some tries needing one, '3 out · 2 nonstop tries · 5 with connections · ~40h there'. */
export function weekendMeta(o: WeekendOption, showConnections = false): string {
  const t = o.tries.length;
  const tail = `~${o.hoursThere}h there`;
  if (showConnections && o.directTries < t) return `${o.out.length} out · ${o.directTries} nonstop ${o.directTries === 1 ? 'try' : 'tries'} · ${t} with connections · ${tail}`;
  return `${o.out.length} out · ${t} ${t === 1 ? 'try' : 'tries'} home · ${tail}`;
}

/** Why a window cannot be searched, or null. Dates and times are hub-local. */
export function windowProblem(w: WeekendWindow, hub: string, nowMs: number): string | null {
  const clock = (h: string) => /^\d\d:\d\d$/.test(h);
  if (!isDateKey(w.leaveKey) || !isDateKey(w.homeKey) || !clock(w.leaveHhmm) || !clock(w.homeHhmm)) return 'Enter a date and time';
  const tz = airportTz(hub);
  if (toUtcMs(w.homeKey, w.homeHhmm, tz) <= nowMs) return 'Home-by is in the past';
  const to = getCoverage(hub).to;
  if (to && (w.leaveKey > to || w.homeKey > to)) {
    return `Schedules only go to ${formatKey(to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (!windowValid(w, hub)) return 'Home-by has to be after leave-after';
  return null;
}
