// Live flight status: a thin proxy to FlightAware AeroAPI v4 (Netlify Functions v2).
// Privacy: the only things received are a flight ident and a date; the AeroAPI
// key stays here. Air Canada systems are never contacted. Request headers are
// never logged.
import {
  inboundIdToFetch, makeLimiter, normalizeFlight, normalizeInbound, pickFlight, queryWindow, validateDate, validateIdent,
} from './lib/flight-status.ts';

const BASE = 'https://aeroapi.flightaware.com/aeroapi';
const allow = makeLimiter(30, 60_000);
const NO_STORE = 'no-store';

function json(body: unknown, status: number, cache: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache };
  // Netlify's CDN shares one answer across every user for 5 minutes (one AeroAPI query per flight per window).
  if (status === 200) headers['Netlify-CDN-Cache-Control'] = 'public, s-maxage=300, stale-while-revalidate=60';
  return new Response(JSON.stringify(body), { status, headers });
}

async function aero(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-apikey': key, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`AeroAPI ${res.status}`);
  return res.json();
}

export default async (req: Request, context: { ip?: string }): Promise<Response> => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405, NO_STORE);
  const now = Date.now();
  if (!allow(context.ip || 'unknown', now)) return json({ error: 'rate-limited' }, 429, NO_STORE);

  const key = process.env['AEROAPI_KEY'];
  if (!key) return json({ error: 'not-configured' }, 503, NO_STORE);

  const q = new URL(req.url).searchParams;
  const ident = validateIdent(q.get('ident'));
  const date = validateDate(q.get('date'), now);
  if (!ident || !date) return json({ error: 'bad-request' }, 400, NO_STORE);

  try {
    const { start, end } = queryWindow(date);
    const body = await aero(`/flights/${ident}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`, key);
    const f = pickFlight(body, date);
    if (!f) return json({ error: 'not-found' }, 404, 'public, max-age=60, s-maxage=120');

    let inbound = null;
    const inboundId = inboundIdToFetch(f, now);
    if (inboundId) {
      try { inbound = normalizeInbound(await aero(`/flights/${inboundId}`, key)); } catch { /* the inbound is optional */ }
    }
    return json(normalizeFlight(f, { ident, date }, inbound, now), 200, 'public, max-age=60, s-maxage=300');
  } catch (e) {
    console.error('flight-status upstream failure:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'upstream' }, 502, NO_STORE);
  }
};
