// Pure helpers for netlify/functions/events.mts (Ticketmaster Discovery API v2). No network here.
import places from './places.json';

export const MAX_EVENTS = 10;
export const MAX_WINDOW_DAYS = 7;
export const HORIZON_DAYS = 120;
export const RADIUS_KM = 40;
const DAY_MS = 86_400_000;

export interface EventItem { name: string; url: string; date: string; time: string | null; venue: string; segment: string; rescheduled?: true }
export interface EventsResult { events: EventItem[]; source: 'Ticketmaster'; fetchedAt: string }

const PLACES = places as Record<string, { lat: number; lng: number }>;

/** An IATA code of a place the app knows (destinations and hubs), or null. */
export function validateCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^[A-Za-z]{3}$/.test(raw)) return null;
  const c = raw.toUpperCase();
  return Object.prototype.hasOwnProperty.call(PLACES, c) ? c : null;
}

export function coordsFor(code: string): { lat: number; lng: number } | null {
  return Object.prototype.hasOwnProperty.call(PLACES, code) ? PLACES[code] : null;
}

function keyMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === raw ? ms : null;
}

/**
 * from/to are YYYY-MM-DD, from <= to, at most 7 days inclusive. The client asks for
 * Monday to Sunday weeks, so `from` may be up to 6 days in the past as long as `to` is
 * today or later (1 day of time-zone slack); `from` is at most 121 days ahead.
 */
export function validateWindow(from: unknown, to: unknown, nowMs: number): { from: string; to: string } | null {
  const f = keyMs(from);
  const t = keyMs(to);
  if (f === null || t === null || t < f) return null;
  if ((t - f) / DAY_MS > MAX_WINDOW_DAYS - 1) return null;
  const today = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z');
  if (t < today - DAY_MS || f < today - 6 * DAY_MS || f > today + (HORIZON_DAYS + 1) * DAY_MS) return null;
  return { from: from as string, to: to as string };
}

const isoZ = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

/** Discovery v2 events search URL. The UTC range is padded by a day each side; results are filtered on local date afterwards. */
export function buildUrl(code: string, w: { from: string; to: string }, apikey: string): string | null {
  const c = coordsFor(code);
  if (!c) return null;
  const q = new URLSearchParams({
    apikey,
    latlong: `${c.lat},${c.lng}`,
    radius: String(RADIUS_KM),
    unit: 'km',
    startDateTime: isoZ(keyMs(w.from)! - DAY_MS),
    endDateTime: isoZ(keyMs(w.to)! + 2 * DAY_MS - 1000),
    locale: '*',
    source: 'ticketmaster',
    size: '200',
    sort: 'relevance,desc',
  });
  return `https://app.ticketmaster.com/discovery/v2/events.json?${q.toString()}`;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Ticketmaster's own sites. Mirrored in src/app/events/events.ts. */
export const TICKETMASTER_HOSTS = [
  'ticketmaster.com', 'ticketmaster.ca', 'ticketmaster.com.mx', 'ticketmaster.co.uk', 'ticketmaster.ie', 'ticketmaster.de',
  'ticketmaster.es', 'ticketmaster.fr', 'ticketmaster.nl', 'ticketmaster.be', 'ticketmaster.at', 'ticketmaster.ch',
  'ticketmaster.dk', 'ticketmaster.fi', 'ticketmaster.no', 'ticketmaster.se', 'ticketmaster.pt', 'ticketmaster.pl',
  'ticketmaster.cz', 'ticketmaster.ae', 'ticketmaster.com.au', 'ticketmaster.co.nz', 'ticketmaster.com.br', 'ticketmaster.cl',
  'ticketmaster.co.za', 'ticketmaster.sg', 'ticketmaster.hk', 'ticketmaster.com.tr',
] as const;

/** Only https links to the Ticketmaster allowlist are passed on (never an arbitrary URL from the upstream). */
export function safeTicketmasterUrl(raw: unknown): string | null {
  const s = str(raw, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && TICKETMASTER_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.toString() : null;
  } catch { return null; }
}

/** Discovery v2 body -> at most 10 events inside [from, to] (local date), sorted, de-duplicated, cancelled ones dropped. */
export function normalizeEvents(body: unknown, w: { from: string; to: string }, nowMs: number): EventsResult {
  const raw = rec(rec(body)?.['_embedded'])?.['events'];
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: EventItem[] = [];
  for (const e of list) {
    const r = rec(e);
    if (!r) continue;
    const name = str(r['name']);
    const url = safeTicketmasterUrl(r['url']);
    const dates = rec(r['dates']);
    const start = rec(dates?.['start']);
    const date = str(start?.['localDate'], 10);
    if (!name || !url || !date || keyMs(date) === null || date < w.from || date > w.to) continue;
    const status = str(rec(dates?.['status'])?.['code'])?.toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'postponed') continue;
    const t = str(start?.['localTime'], 8);
    const time = t && /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t.slice(0, 5) : null;
    const venues = rec(r['_embedded'])?.['venues'];
    const venue = str(rec(Array.isArray(venues) ? venues[0] : null)?.['name'], 120) ?? '';
    const cls = r['classifications'];
    const segment = str(rec(rec(Array.isArray(cls) ? cls[0] : null)?.['segment'])?.['name'], 40) ?? '';
    const dup = `${name.toLowerCase()}|${date}|${venue.toLowerCase()}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    out.push({ name, url, date, time, venue, segment, ...(status === 'rescheduled' ? { rescheduled: true as const } : {}) });
  }
  // The upstream order is relevance: keep the top 10, then show them by date.
  const top = out.slice(0, MAX_EVENTS);
  top.sort((a, b) => (a.date + (a.time ?? '99')).localeCompare(b.date + (b.time ?? '99')));
  return { events: top, source: 'Ticketmaster', fetchedAt: new Date(nowMs).toISOString() };
}

/** TICKETMASTER_DAILY_LIMIT, default 500; junk falls back to the default. */
export function eventsDailyLimit(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : 500;
}
