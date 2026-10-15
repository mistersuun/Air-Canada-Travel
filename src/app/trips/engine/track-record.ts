/**
 * Your own track record, from the outcomes you saved on this device. Counts
 * only: never a percentage, never odds. Pure.
 */
import { instanceKey, type Outcome } from '../model';
import { t, type MsgKey } from '../../i18n/t';
import { weekdayIndex } from '../../utils/time';

export interface HistoryCounts {
  /** Outcomes other than "Didn't try". */
  tried: number;
  /** Everyone or some of the party boarded (includes `partial`). */
  boarded: number;
  /** Of those, only some of the party boarded. */
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
  else if (o.kind === 'someBoarded') { c.boarded++; c.partial++; }
}

/**
 * Counts of your own saved outcomes for a flight number and/or route, overall
 * and on the same weekday. One outcome per flight instance (the latest saved).
 */
export function historyFor(log: { outcomes: readonly Outcome[] }, q: HistoryQuery): History {
  const num = q.flightNumber ? norm(q.flightNumber) : null;
  const dow = q.dateKey ? weekdayIndex(q.dateKey) : null;
  const latest = new Map<string, Outcome>();
  for (const o of log.outcomes) {
    if (num && norm(o.flightNumber) !== num) continue;
    if (q.route && (o.origin !== q.route.origin || o.dest !== q.route.dest)) continue;
    const k = instanceKey(o);
    const prev = latest.get(k);
    if (!prev || o.recordedAt >= prev.recordedAt) latest.set(k, o);
  }
  const overall = empty();
  const sameWeekday = empty();
  for (const o of latest.values()) {
    add(overall, o);
    if (dow !== null && weekdayIndex(o.dateKey) === dow) add(sameWeekday, o);
  }
  return { overall, sameWeekday };
}

/** 'tried 4, boarded 3' (+ ' (1 some of us)' when any). Counts only. */
export function historyText(c: HistoryCounts): string {
  return t(c.partial ? 'trips.history.textSome' : 'trips.history.text', { tried: c.tried, boarded: c.boarded, partial: c.partial });
}

const WEEKDAY_PLURAL: readonly MsgKey[] = [
  'trips.history.mondays', 'trips.history.tuesdays', 'trips.history.wednesdays', 'trips.history.thursdays',
  'trips.history.fridays', 'trips.history.saturdays', 'trips.history.sundays',
];

/** 'AC834: tried 4, boarded 3 (Fridays 2 of 2)', or null when you have not tried it. Counts only. */
export function recordLine(h: History, flightNumber: string, dateKey: string): string | null {
  if (!h.overall.tried) return null;
  const text = historyText(h.overall);
  if (!h.sameWeekday.tried) return t('trips.history.line', { flight: flightNumber, text });
  return t('trips.history.lineDay', {
    flight: flightNumber, text, day: t(WEEKDAY_PLURAL[weekdayIndex(dateKey)]),
    boarded: h.sameWeekday.boarded, tried: h.sameWeekday.tried,
  });
}

/** 'you: 3/4' (boarded of tried) for a destination departures row, or null when tried is 0. */
export function recordTag(c: HistoryCounts): string | null {
  return c.tried ? t('trips.history.tag', { boarded: c.boarded, tried: c.tried }) : null;
}

/** 'Your record: boarded 3 of 4' for assistive tech. */
export function recordAria(c: HistoryCounts): string {
  return t('trips.history.aria', { boarded: c.boarded, tried: c.tried });
}
