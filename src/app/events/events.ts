/**
 * "What's on": events near a destination from Ticketmaster, via our Netlify Function.
 * Pure helpers: response shape, the date window rules and the one-line text. No prices.
 */
import { addDays, diffDays, formatClock, formatKey, isDateKey } from '../utils/time';

export const EVENTS_ENDPOINT = '/.netlify/functions/events';
export const TICKETMASTER_URL = 'https://www.ticketmaster.com/';
/** Mirrors netlify/functions/lib/events.ts: at most this many days in a request, and none further out than HORIZON_DAYS. */
export const MAX_WINDOW_DAYS = 7;
export const HORIZON_DAYS = 120;

/** Mirrors the function's response (the app does not import from the functions folder). */
export interface EventItem { name: string; url: string; date: string; time: string | null; venue: string; segment: string }
export interface EventsResult { events: EventItem[]; source: 'Ticketmaster'; fetchedAt: string }

export interface EventsWindow { from: string; to: string }

/** The window the server will accept, or null when nothing of it is askable (past, beyond 120 days). */
export function clampWindow(from: string, to: string, today: string): EventsWindow | null {
  if (!isDateKey(from) || !isDateKey(to) || !isDateKey(today) || to < from) return null;
  const f = from < today ? today : from;
  const horizon = addDays(today, HORIZON_DAYS);
  let t = to > horizon ? horizon : to;
  if (t < f) return null;
  if (diffDays(f, t) > MAX_WINDOW_DAYS - 1) t = addDays(f, MAX_WINDOW_DAYS - 1);
  return { from: f, to: t };
}

/** The picked day and 3 days either side. */
export function aroundDay(day: string, today: string): EventsWindow | null {
  return isDateKey(day) ? clampWindow(addDays(day, -3), addDays(day, 3), today) : null;
}

export function windowKey(code: string, w: EventsWindow): string {
  return `${code}|${w.from}|${w.to}`;
}

export function eventsUrl(code: string, w: EventsWindow): string {
  return `${EVENTS_ENDPOINT}?code=${encodeURIComponent(code)}&from=${w.from}&to=${w.to}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Validates an untrusted body; links must be https. */
export function parseEvents(body: unknown): EventsResult | null {
  const b = body as { events?: unknown; fetchedAt?: unknown } | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.events)) return null;
  const events: EventItem[] = [];
  for (const e of b.events.slice(0, 10)) {
    const r = e as Record<string, unknown> | null;
    const name = str(r?.['name']);
    const url = str(r?.['url']);
    const date = r?.['date'];
    if (!name || !url || !isDateKey(date) || !/^https:\/\//i.test(url)) continue;
    const time = str(r?.['time']);
    events.push({
      name: name.slice(0, 200), url, date, time: time && /^\d{2}:\d{2}$/.test(time) ? time : null,
      venue: (str(r?.['venue']) ?? '').slice(0, 120), segment: (str(r?.['segment']) ?? '').slice(0, 40),
    });
  }
  return { events, source: 'Ticketmaster', fetchedAt: str(b.fetchedAt) ?? '' };
}

/** 'Sat Oct 10 · 20:00 · Coldplay · Estádio da Luz' (time and venue left out when unknown). */
export function eventLine(e: EventItem, fmt: '12h' | '24h' = '24h'): string {
  return [
    formatKey(e.date, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ''),
    e.time ? formatClock(e.time, fmt) : null,
    e.name,
    e.venue || null,
  ].filter(Boolean).join(' · ');
}

/** 'Oct 10' or 'Oct 7 to Oct 13'. */
export function rangeLabel(w: EventsWindow): string {
  const f = (k: string) => formatKey(k, { month: 'short', day: 'numeric' });
  return w.from === w.to ? f(w.from) : `${f(w.from)} to ${f(w.to)}`;
}
