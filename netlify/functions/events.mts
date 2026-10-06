// "What's on": a thin proxy to the Ticketmaster Discovery API v2 (Netlify Functions v2).
// Privacy: only an airport code and a date range are received; the API key stays here and
// no request header is ever logged. Non-commercial: links go to Ticketmaster, no affiliate
// parameters, no prices. Terms: attribute Ticketmaster (the app does), cache reasonably.
//
// Quota control (5000 calls/day upstream): the CDN answers repeats for 6 hours (Netlify-Vary
// on code|from|to), each IP gets ~10 cache misses per 10 minutes, and a global daily budget
// (TICKETMASTER_DAILY_LIMIT, default 500) is counted in Netlify Blobs with conditional writes.
import { getStore } from '@netlify/blobs';
import { buildUrl, eventsDailyLimit, normalizeEvents, validateCode, validateWindow } from './lib/events.ts';
import { makeBudget, makeLimiter } from './lib/flight-status.ts';

const allow = makeLimiter(10, 10 * 60_000);
const NO_STORE = 'no-store';
const VARY = 'query=code|from|to';

function json(body: unknown, status: number, cdn: string | null, browser = NO_STORE): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': browser };
  if (cdn) {
    headers['Netlify-CDN-Cache-Control'] = cdn;
    headers['Netlify-Vary'] = VARY;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default async (req: Request, context: { ip?: string }): Promise<Response> => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405, null);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403, null);
  const now = Date.now();

  const key = process.env['TICKETMASTER_KEY'];
  if (!key) return json({ error: 'not-configured' }, 503, null);

  const q = new URL(req.url).searchParams;
  const code = validateCode(q.get('code'));
  const win = validateWindow(q.get('from'), q.get('to'), now);
  if (!code || !win) return json({ error: 'bad-request' }, 400, null);

  if (!allow(context.ip || 'unknown', now)) return json({ error: 'rate-limited' }, 429, null);

  let spend: (nowMs: number, calls?: number) => Promise<boolean>;
  try {
    spend = makeBudget(getStore({ name: 'ticketmaster-budget', consistency: 'strong' }), eventsDailyLimit(process.env['TICKETMASTER_DAILY_LIMIT']));
  } catch {
    return json({ error: 'budget' }, 503, null);
  }
  if (!(await spend(now))) return json({ error: 'budget' }, 503, null);

  try {
    const url = buildUrl(code, win, key)!;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Ticketmaster ${res.status}`);
    const body = normalizeEvents(await res.json(), win, now);
    return json(body, 200, 'public, s-maxage=21600, stale-while-revalidate=600', 'public, max-age=600');
  } catch (e) {
    // The message never contains the URL (and so never the key).
    console.error('events upstream failure:', e instanceof Error ? e.message.replace(/apikey=[^&\s]+/gi, 'apikey=…') : 'unknown');
    return json({ error: 'upstream' }, 502, 'public, s-maxage=60');
  }
};
