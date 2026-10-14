/**
 * Pure helpers for the flight-status function: request validation, the AeroAPI
 * query window, picking the right flight and normalising it. No I/O, no env,
 * so it is unit-tested (flight-status.spec.ts). Everything is parsed
 * defensively: AeroAPI fields may be missing or null and nothing here throws.
 */

import { isRec, type Rec } from './http.ts';

export interface StatusEnd {
  scheduled: string | null;
  estimated: string | null;
  actual: string | null;
  gate: string | null;
  terminal: string | null;
}

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

const HOUR_MS = 3_600_000;

/** Air Canada only ('AC834' / 'ACA834', any case); returns the ICAO ident ('ACA834') or null. Anything else is refused so the key cannot be spent on other airlines. */
export function validateIdent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(ACA|AC)(\d{1,4})$/.exec(raw.trim().toUpperCase());
  return m ? `ACA${m[2]}` : null;
}

/** A 3-letter IATA airport code ('YVR'), or null. */
export function validateOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/** Scheduled departure as 'YYYY-MM-DDTHH:MMZ' (UTC, minute precision) within now-14h..now+38h; returns epoch ms or null. */
export function validateDep(raw: unknown, nowMs: number): number | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(raw)) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 16) + 'Z' !== raw) return null;
  const d = ms - nowMs;
  return d >= -14 * HOUR_MS && d <= 38 * HOUR_MS ? ms : null;
}

const isoZ = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

/** The AeroAPI start/end (UTC): 3 hours either side of the scheduled departure the client named. */
export function queryWindow(depMs: number): { start: string; end: string } {
  return { start: isoZ(depMs - 3 * HOUR_MS), end: isoZ(depMs + 3 * HOUR_MS) };
}

/**
 * CDN lifetime in seconds: 5 minutes within 6h of departure; before that up to
 * 30 minutes, but never long enough to still be served once the 6h mark passes
 * (the client polls faster from there on).
 */
export function cacheSeconds(depMs: number, nowMs: number): number {
  const ahead = depMs - nowMs;
  if (ahead <= 6 * HOUR_MS) return 300;
  return Math.min(1800, Math.max(300, Math.floor((ahead - 6 * HOUR_MS) / 1000)));
}

const str = (v: unknown, max = 40): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const iso = (v: unknown): string | null => {
  const s = str(v, 40);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};

/** The airport an AeroAPI flight leaves from, as a 3-letter code when it has one. */
function originCode(f: Rec): string[] {
  const o = isRec(f['origin']) ? f['origin'] : {};
  return [str(o['code_iata'], 4), str(o['code'], 4), str(o['code_icao'], 4)].filter((c): c is string => !!c);
}

/**
 * Of the flights returned for the window, the one that leaves `origin` and
 * whose scheduled departure is nearest `depMs`, within 3 hours. A flight number
 * can fly two legs a day (or the same time on two days) so origin and time both
 * decide. Skips malformed entries; null when nothing matches.
 */
export function pickFlight(body: unknown, origin: string, depMs: number): Rec | null {
  const list = isRec(body) && Array.isArray(body['flights']) ? body['flights'] : [];
  let best: Rec | null = null;
  let bestD = Infinity;
  for (const f of list) {
    if (!isRec(f) || !originCode(f).includes(origin)) continue;
    const t = Date.parse(str(f['scheduled_out']) ?? str(f['scheduled_off']) ?? '');
    const d = Math.abs(t - depMs);
    if (Number.isFinite(d) && d <= 3 * HOUR_MS && d < bestD) { best = f; bestD = d; }
  }
  return best;
}

/** Gate times (out/in) first, runway times (off/on) as a fallback. */
function end(f: Rec, side: 'out' | 'in', gate: unknown, terminal: unknown): StatusEnd {
  const alt = side === 'out' ? 'off' : 'on';
  return {
    scheduled: iso(f[`scheduled_${side}`]) ?? iso(f[`scheduled_${alt}`]),
    estimated: iso(f[`estimated_${side}`]) ?? iso(f[`estimated_${alt}`]),
    actual: iso(f[`actual_${side}`]) ?? iso(f[`actual_${alt}`]),
    gate: str(gate, 8),
    terminal: str(terminal, 8),
  };
}

/** 'ACA811' -> 'AC811' for display; anything else is returned as given. */
export function displayIdent(icao: string): string {
  return /^ACA\d{1,4}$/.test(icao) ? `AC${icao.slice(3)}` : icao;
}

export function normalizeFlight(
  f: Rec,
  req: { ident: string },
  inbound: FlightStatus['inbound'],
  nowMs: number,
): FlightStatus {
  return {
    ident: displayIdent(req.ident),
    status: str(f['status'], 40) ?? '',
    cancelled: f['cancelled'] === true,
    diverted: f['diverted'] === true,
    dep: end(f, 'out', f['gate_origin'], f['terminal_origin']),
    arr: end(f, 'in', f['gate_destination'], f['terminal_destination']),
    inbound,
    aircraft: str(f['aircraft_type'], 10),
    fetchedAt: new Date(nowMs).toISOString(),
    source: 'FlightAware',
  };
}

/** The inbound aircraft's leg, reduced to what the app shows. */
export function normalizeInbound(body: unknown): FlightStatus['inbound'] {
  const first = isRec(body) && Array.isArray(body['flights']) ? body['flights'][0] : null;
  if (!isRec(first)) return null;
  const ident = str(first['ident_iata']) ?? str(first['ident']);
  if (!ident) return null;
  return {
    ident: displayIdent(ident),
    landed: iso(first['actual_on']) ?? iso(first['actual_in']),
    estimatedIn: iso(first['estimated_on']) ?? iso(first['estimated_in']),
  };
}

/** The inbound flight id, only when the flight leaves within `hours` of now (and left no more than an hour ago). */
export function inboundIdToFetch(f: Rec, nowMs: number, hours = 6): string | null {
  const id = str(f['inbound_fa_flight_id'], 80);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) return null;
  const t = Date.parse(str(f['estimated_out']) ?? str(f['scheduled_out']) ?? '');
  if (!Number.isFinite(t)) return null;
  const ahead = t - nowMs;
  return ahead <= hours * HOUR_MS && ahead >= -HOUR_MS ? id : null;
}

/**
 * The one query string a request is cached under. The CDN varies on the raw
 * ident|origin|dep values, so 'ac834', 'AC834' and ' ACA834' would otherwise be
 * three entries (three AeroAPI calls). Returns null when the request is already
 * canonical; else the canonical 'ident=AC834&origin=YVR&dep=…' to redirect to.
 */
export function canonicalQuery(params: URLSearchParams, ident: string, origin: string, dep: string): string | null {
  const want = new URLSearchParams({ ident: displayIdent(ident), origin, dep }).toString();
  const keys = [...params.keys()];
  const canonical = keys.length === 3 && keys.join(',') === 'ident,origin,dep'
    && params.get('ident') === displayIdent(ident) && params.get('origin') === origin && params.get('dep') === dep;
  return canonical ? null : want;
}

/** How long a looked-up inbound aircraft is reused (it moves slowly; the main answer is cached for 5 minutes). */
export const INBOUND_TTL_MS = 15 * 60_000;

/** The slice of a Netlify Blobs store the inbound cache needs. */
export interface InboundStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  delete?(key: string): Promise<unknown>;
}

/**
 * The inbound aircraft's leg for `faFlightId`: from the store when looked up in the last
 * 15 minutes, else via `fetchInbound` (which spends budget; null = refused or failed) and
 * stored. A failed lookup is not cached. The store is best effort: any error just means a lookup.
 */
export async function cachedInbound(
  store: InboundStore | null, faFlightId: string, nowMs: number,
  fetchInbound: () => Promise<FlightStatus['inbound'] | undefined>,
): Promise<FlightStatus['inbound']> {
  const key = `inbound-${faFlightId}`;
  try {
    const raw = store ? await store.get(key) : null;
    if (raw) {
      let c: { at?: unknown; inbound?: unknown } | null = null;
      try { c = JSON.parse(raw) as { at?: unknown; inbound?: unknown }; } catch { /* malformed */ }
      if (c && typeof c.at === 'number' && nowMs - c.at >= 0 && nowMs - c.at < INBOUND_TTL_MS) {
        return isRec(c.inbound) ? normalizeCachedInbound(c.inbound) : null;
      }
      // Stale or malformed: remove it, so keys for flights that are over do not pile up in the store.
      await store?.delete?.(key);
    }
  } catch { /* unreadable: look it up */ }
  const fresh = await fetchInbound();
  if (fresh === undefined) return null;
  try { await store?.set(key, JSON.stringify({ at: nowMs, inbound: fresh })); } catch { /* best effort */ }
  return fresh;
}

function normalizeCachedInbound(c: Rec): FlightStatus['inbound'] {
  const ident = str(c['ident']);
  return ident ? { ident, landed: iso(c['landed']), estimatedIn: iso(c['estimatedIn']) } : null;
}
