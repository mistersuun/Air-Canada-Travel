/**
 * "What's on": events near a destination from Ticketmaster, via our Netlify Function.
 * Pure helpers: response shape, the date window rules and the one-line text. No prices.
 */
import { addDays, formatClock, formatKey, isDateKey, weekdayIndex } from '../utils/time';

export const EVENTS_ENDPOINT = '/.netlify/functions/events';
export const TICKETMASTER_URL = 'https://www.ticketmaster.com/';
/** Mirrors netlify/functions/lib/events.ts: at most this many days in a request, and none further out than HORIZON_DAYS. */
export const MAX_WINDOW_DAYS = 7;
export const HORIZON_DAYS = 120;
export const MAX_EVENTS = 10;

/** Mirrors the function's response (the app does not import from the functions folder). */
export interface EventItem { name: string; url: string; date: string; time: string | null; venue: string; segment: string; rescheduled?: true }
export interface EventsResult { events: EventItem[]; source: 'Ticketmaster'; fetchedAt: string }

export interface EventsWindow { from: string; to: string }

/** Monday to Sunday week containing a day. Requests snap to weeks so the CDN and the daily budget are shared. */
export function weekOf(day: string): EventsWindow {
  const from = addDays(day, -weekdayIndex(day));
  return { from, to: addDays(from, MAX_WINDOW_DAYS - 1) };
}

/**
 * The weeks (at most 2) that [from, to] overlaps and the server will accept: not already over
 * (the server takes a week that started up to 6 days ago) and starting within the next 120 days.
 */
export function weekBuckets(from: string, to: string, today: string): EventsWindow[] {
  if (!isDateKey(from) || !isDateKey(to) || !isDateKey(today) || to < from) return [];
  const out: EventsWindow[] = [];
  for (let w = weekOf(from); w.from <= to && out.length < 2; w = weekOf(addDays(w.from, MAX_WINDOW_DAYS))) {
    if (w.to >= today && w.from <= addDays(today, HORIZON_DAYS)) out.push(w);
  }
  return out;
}

/** The picked day and 3 days either side, as weeks. */
export function aroundDay(day: string, today: string): EventsWindow[] {
  return isDateKey(day) ? weekBuckets(addDays(day, -3), addDays(day, 3), today) : [];
}

/** 'Week of Oct 5' or 'Weeks of Oct 5 and Oct 12'. */
export function weekLabel(ws: readonly EventsWindow[]): string {
  const f = (k: string) => formatKey(k, { month: 'short', day: 'numeric' });
  return ws.length > 1 ? `Weeks of ${f(ws[0].from)} and ${f(ws[1].from)}` : ws.length ? `Week of ${f(ws[0].from)}` : '';
}

export function windowKey(code: string, w: EventsWindow): string {
  return `${code}|${w.from}|${w.to}`;
}

export function eventsUrl(code: string, w: EventsWindow): string {
  return `${EVENTS_ENDPOINT}?code=${encodeURIComponent(code)}&from=${w.from}&to=${w.to}`;
}

/** Ticketmaster's own sites (mirrors netlify/functions/lib/events.ts); anything else is not linked. */
export const TICKETMASTER_HOSTS = [
  'ticketmaster.com', 'ticketmaster.ca', 'ticketmaster.com.mx', 'ticketmaster.co.uk', 'ticketmaster.ie', 'ticketmaster.de',
  'ticketmaster.es', 'ticketmaster.fr', 'ticketmaster.nl', 'ticketmaster.be', 'ticketmaster.at', 'ticketmaster.ch',
  'ticketmaster.dk', 'ticketmaster.fi', 'ticketmaster.no', 'ticketmaster.se', 'ticketmaster.pt', 'ticketmaster.pl',
  'ticketmaster.cz', 'ticketmaster.ae', 'ticketmaster.com.au', 'ticketmaster.co.nz', 'ticketmaster.com.br', 'ticketmaster.cl',
  'ticketmaster.co.za', 'ticketmaster.sg', 'ticketmaster.hk', 'ticketmaster.com.tr',
] as const;

export function isTicketmasterUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && TICKETMASTER_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
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
    if (!name || !url || !isDateKey(date) || !isTicketmasterUrl(url)) continue;
    const time = str(r?.['time']);
    events.push({
      name: name.slice(0, 200), url, date, time: time && /^\d{2}:\d{2}$/.test(time) ? time : null,
      venue: (str(r?.['venue']) ?? '').slice(0, 120), segment: (str(r?.['segment']) ?? '').slice(0, 40),
      ...(r?.['rescheduled'] === true ? { rescheduled: true as const } : {}),
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
    e.rescheduled ? 'rescheduled' : null,
  ].filter(Boolean).join(' · ');
}

