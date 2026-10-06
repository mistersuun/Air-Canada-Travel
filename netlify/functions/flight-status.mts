// Live flight status: a thin proxy to FlightAware AeroAPI v4 (Netlify Functions v2).
// Privacy: the only things received are an Air Canada flight number, the origin
// airport and the scheduled departure minute; the AeroAPI key stays here. Air
// Canada systems are never contacted. Request headers are never logged.
//
// Spend control (AeroAPI bills per call): Air Canada idents only; the CDN
// answers repeats (Netlify-Vary on ident|origin|dep, 5 to 30 minute TTL); each
// IP gets ~10 cache misses per 10 minutes; and a global daily call budget
// (AEROAPI_DAILY_LIMIT, default 40) is counted in Netlify Blobs with conditional writes.
import { getStore } from '@netlify/blobs';
import {
  cacheSeconds, dailyLimit, inboundIdToFetch, makeBudget, makeLimiter, normalizeFlight, normalizeInbound, pickFlight, queryWindow,
  validateDep, validateIdent, validateOrigin,
} from './lib/flight-status.ts';

const BASE = 'https://aeroapi.flightaware.com/aeroapi';
const allow = makeLimiter(10, 10 * 60_000);
const NO_STORE = 'no-store';
const VARY = 'query=ident|origin|dep';

function json(body: unknown, status: number, cdn: string | null, browser = NO_STORE): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': browser };
  if (cdn) {
    headers['Netlify-CDN-Cache-Control'] = cdn;
    headers['Netlify-Vary'] = VARY;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function aero(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-apikey': key, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`AeroAPI ${res.status}`);
  return res.json();
}

export default async (req: Request, context: { ip?: string }): Promise<Response> => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405, null);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403, null);
  const now = Date.now();

  const key = process.env['AEROAPI_KEY'];
  if (!key) return json({ error: 'not-configured' }, 503, null);

  const q = new URL(req.url).searchParams;
  const ident = validateIdent(q.get('ident'));
  const origin = validateOrigin(q.get('origin'));
  const dep = validateDep(q.get('dep'), now);
  if (!ident || !origin || dep === null) return json({ error: 'bad-request' }, 400, null);

  // Only cache misses reach this point, so this is a limit on upstream-bound requests.
  if (!allow(context.ip || 'unknown', now)) return json({ error: 'rate-limited' }, 429, null);

  let spend: (nowMs: number, calls?: number) => Promise<boolean>;
  try {
    spend = makeBudget(getStore({ name: 'aeroapi-budget', consistency: 'strong' }), dailyLimit(process.env['AEROAPI_DAILY_LIMIT']));
  } catch {
    return json({ error: 'budget' }, 503, null);
  }
  if (!(await spend(now))) return json({ error: 'budget' }, 503, null);

  try {
    const { start, end } = queryWindow(dep);
    const body = await aero(`/flights/${ident}?ident_type=designator&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`, key);
    const f = pickFlight(body, origin, dep);
    if (!f) return json({ error: 'not-found' }, 404, 'public, s-maxage=120');

    let inbound = null;
    const inboundId = inboundIdToFetch(f, now);
    if (inboundId && (await spend(now))) {
      try { inbound = normalizeInbound(await aero(`/flights/${encodeURIComponent(inboundId)}?ident_type=fa_flight_id`, key)); } catch { /* the inbound is optional */ }
    }
    const ttl = cacheSeconds(dep, now);
    return json(normalizeFlight(f, { ident }, inbound, now), 200, `public, s-maxage=${ttl}, stale-while-revalidate=60`, 'public, max-age=60');
  } catch (e) {
    console.error('flight-status upstream failure:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'upstream' }, 502, 'public, s-maxage=60');
  }
};
