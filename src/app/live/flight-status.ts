/**
 * Live flight status (FlightAware via our Netlify Function). Pure helpers: the
 * response shape, which flights are worth asking about and the one-line text.
 * Facts only: times and gates as reported, never a prediction.
 */
import { formatClock, utcToLocal, MINUTE_MS } from '../utils/time';
import type { TimeFormat } from '../state/prefs.service';
import { airportTz } from '../utils/airports';

export interface StatusEnd { scheduled: string | null; estimated: string | null; actual: string | null; gate: string | null; terminal: string | null }

/** Mirrors netlify/functions/lib/flight-status.ts (the app does not import from the functions folder). */
export interface FlightStatus {
  ident: string;
  status: string;
  cancelled: boolean;
  diverted: boolean;
  dep: StatusEnd;
  arr: StatusEnd;
  inbound: { ident: string; landed: string | null; estimatedIn: string | null } | null;
  aircraft: string | null;
  fetchedAt: string;
  source: 'FlightAware';
}

export const STATUS_ENDPOINT = '/.netlify/functions/flight-status';
/** Only flights departing within this window of now are asked about. */
export const WINDOW_BEFORE_MS = 12 * 60 * MINUTE_MS;
export const WINDOW_AFTER_MS = 36 * 60 * MINUTE_MS;
/** Poll every 5 minutes within 6h of departure, every 30 minutes before that (the server's CDN lifetime matches). */
export const POLL_NEAR_MS = 5 * MINUTE_MS;
export const POLL_FAR_MS = 30 * MINUTE_MS;
export const NEAR_MS = 6 * 60 * MINUTE_MS;
/** A visibility change refreshes only when the last success is older than this. */
export const VISIBLE_MIN_AGE_MS = 2 * MINUTE_MS;
/** Stop asking once the flight left this long ago. */
export const STOP_AFTER_DEP_MS = 30 * MINUTE_MS;

export function pollDelay(depUtc: number, nowMs: number): number {
  const ahead = depUtc - nowMs;
  if (ahead <= NEAR_MS) return POLL_NEAR_MS;
  return Math.min(POLL_FAR_MS, ahead - NEAR_MS + 1000); // do not sleep through the 6h mark
}

/** False once the result shows it departed more than 30 minutes ago, or arrived. */
export function shouldPoll(s: FlightStatus | null, nowMs: number): boolean {
  if (!s) return true;
  if (s.arr.actual) return false;
  return !(s.dep.actual && nowMs - Date.parse(s.dep.actual) > STOP_AFTER_DEP_MS);
}

/** The scheduled departure as the endpoint wants it: 'YYYY-MM-DDTHH:MMZ'. */
export function depIso(depUtc: number): string {
  return new Date(depUtc).toISOString().slice(0, 16) + 'Z';
}
/** A cached result older than this is not shown. */
export const MAX_AGE_MS = 10 * MINUTE_MS;

export function inStatusWindow(depUtc: number, nowMs: number): boolean {
  const d = depUtc - nowMs;
  return d >= -WINDOW_BEFORE_MS && d <= WINDOW_AFTER_MS;
}

export function statusKey(ident: string, origin: string, depUtc: number): string {
  return `${ident}|${origin}|${depIso(depUtc)}`;
}

/** Narrow an untrusted JSON body to a FlightStatus, or null. */
export function parseStatus(v: unknown): FlightStatus | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const end = (e: unknown): StatusEnd | null => {
    if (typeof e !== 'object' || e === null) return null;
    const r = e as Record<string, unknown>;
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null);
    return { scheduled: s('scheduled'), estimated: s('estimated'), actual: s('actual'), gate: s('gate'), terminal: s('terminal') };
  };
  const dep = end(o['dep']);
  const arr = end(o['arr']);
  if (typeof o['ident'] !== 'string' || typeof o['fetchedAt'] !== 'string' || !dep || !arr || o['source'] !== 'FlightAware') return null;
  const ib = o['inbound'];
  let inbound: FlightStatus['inbound'] = null;
  if (typeof ib === 'object' && ib !== null && typeof (ib as Record<string, unknown>)['ident'] === 'string') {
    const r = ib as Record<string, unknown>;
    inbound = { ident: r['ident'] as string, landed: typeof r['landed'] === 'string' ? r['landed'] : null, estimatedIn: typeof r['estimatedIn'] === 'string' ? r['estimatedIn'] : null };
  }
  return {
    ident: o['ident'], status: typeof o['status'] === 'string' ? o['status'] : '',
    cancelled: o['cancelled'] === true, diverted: o['diverted'] === true, dep, arr, inbound,
    aircraft: typeof o['aircraft'] === 'string' ? o['aircraft'] : null, fetchedAt: o['fetchedAt'], source: 'FlightAware',
  };
}

/** 'just now', '2 min ago', '1 h 5 min ago'. */
export function agoLabel(fetchedAt: string, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - Date.parse(fetchedAt)) / MINUTE_MS));
  if (!Number.isFinite(min)) return '';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

export interface StatusLine {
  cancelled: boolean;
  /** 'Estimated 14:25 (+40) · Gate D32 · Inbound AC811 landed 13:52' */
  text: string;
  /** 'FlightAware, 2 min ago' */
  source: string;
}

const clock = (iso: string, tz: string, fmt: TimeFormat) => formatClock(utcToLocal(Date.parse(iso), tz).hhmm, fmt);

/**
 * The status line for a flight leaving `origin`: Departed (actual), Estimated
 * (with the minutes against the schedule when they differ) or Scheduled, then
 * gate and the inbound aircraft's reported time. Reported facts only.
 */
export function statusLine(s: FlightStatus, origin: string, nowMs: number, fmt: TimeFormat): StatusLine {
  const tz = airportTz(origin);
  const source = `FlightAware, ${agoLabel(s.fetchedAt, nowMs)}`;
  if (s.cancelled) return { cancelled: true, text: 'Cancelled', source };
  const parts: string[] = [];
  const { scheduled, estimated, actual } = s.dep;
  if (actual) parts.push(`Departed ${clock(actual, tz, fmt)}`);
  else if (estimated) {
    const delta = scheduled ? Math.round((Date.parse(estimated) - Date.parse(scheduled)) / MINUTE_MS) : 0;
    parts.push(`Estimated ${clock(estimated, tz, fmt)}${delta ? ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})` : ''}`);
  } else if (scheduled) parts.push(`Scheduled ${clock(scheduled, tz, fmt)}`);
  if (s.diverted) parts.push('Diverted');
  if (s.dep.gate) parts.push(`Gate ${s.dep.gate}`);
  if (s.inbound) {
    if (s.inbound.landed) parts.push(`Inbound ${s.inbound.ident} landed ${clock(s.inbound.landed, tz, fmt)}`);
    else if (s.inbound.estimatedIn) parts.push(`Inbound ${s.inbound.ident} estimated in ${clock(s.inbound.estimatedIn, tz, fmt)}`);
  }
  return { cancelled: false, text: parts.join(' · '), source };
}
