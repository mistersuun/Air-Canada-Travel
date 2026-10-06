/**
 * Your own track record, from the outcomes you saved on this device. Counts
 * only: never a percentage, never odds. Pure.
 */
import type { Outcome } from '../model';
import { weekdayIndex } from '../../utils/time';

export interface HistoryCounts {
  /** Outcomes other than "Didn't try". */
  tried: number;
  /** Everyone boarded. */
  boarded: number;
  /** Some of the party boarded. */
  partial: number;
}

export interface History {
  overall: HistoryCounts;
  /** Only the outcomes on the same weekday as `dateKey` (zeros when no dateKey). */
  sameWeekday: HistoryCounts;
}

export interface HistoryQuery {
  flightNumber?: string;
  /** Origin and destination, both required to filter by route. */
  route?: { origin: string; dest: string };
  /** The day whose weekday "sameWeekday" matches. */
  dateKey?: string;
}

const norm = (n: string) => n.replace(/\s+/g, '').toUpperCase();
const empty = (): HistoryCounts => ({ tried: 0, boarded: 0, partial: 0 });

function add(c: HistoryCounts, o: Outcome): void {
  if (o.kind === 'didntTry') return;
  c.tried++;
  if (o.kind === 'allBoarded') c.boarded++;
  else if (o.kind === 'someBoarded') c.partial++;
}

/** Counts of your own saved outcomes for a flight number and/or route, overall and on the same weekday. */
export function historyFor(log: { outcomes: readonly Outcome[] }, q: HistoryQuery): History {
  const num = q.flightNumber ? norm(q.flightNumber) : null;
  const dow = q.dateKey ? weekdayIndex(q.dateKey) : null;
  const overall = empty();
  const sameWeekday = empty();
  for (const o of log.outcomes) {
    if (num && norm(o.flightNumber) !== num) continue;
    if (q.route && (o.origin !== q.route.origin || o.dest !== q.route.dest)) continue;
    add(overall, o);
    if (dow !== null && weekdayIndex(o.dateKey) === dow) add(sameWeekday, o);
  }
  return { overall, sameWeekday };
}

/** 'tried 4, boarded 3' (+ ', some boarded 1' when any). Counts only. */
export function historyText(c: HistoryCounts): string {
  return `tried ${c.tried}, boarded ${c.boarded}${c.partial ? `, some boarded ${c.partial}` : ''}`;
}

const WEEKDAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'] as const;

/** 'AC834: tried 4, boarded 3 (Fridays 2 of 2)', or null when you have not tried it. Counts only. */
export function recordLine(h: History, flightNumber: string, dateKey: string): string | null {
  if (!h.overall.tried) return null;
  const w = h.sameWeekday.tried
    ? ` (${WEEKDAY_PLURAL[weekdayIndex(dateKey)]} ${h.sameWeekday.boarded} of ${h.sameWeekday.tried})`
    : '';
  return `${flightNumber}: ${historyText(h.overall)}${w}`;
}

/** 'you: 3/4' (boarded of tried) for a destination departures row, or null when tried is 0. */
export function recordTag(c: HistoryCounts): string | null {
  return c.tried ? `you: ${c.boarded}/${c.tried}` : null;
}
