/**
 * Pure helpers for the flight-status function: request validation, the AeroAPI
 * query window, picking the right flight and normalising it. No I/O, no env,
 * so it is unit-tested (flight-status.spec.ts). Everything is parsed
 * defensively: AeroAPI fields may be missing or null and nothing here throws.
 */

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

/** CDN lifetime in seconds: half an hour while the departure is more than 6h away, 5 minutes within 6h. */
export function cacheSeconds(depMs: number, nowMs: number): number {
  return depMs - nowMs > 6 * HOUR_MS ? 1800 : 300;
}

/** Key of the per-day AeroAPI call counter (UTC date). */
export function budgetKey(nowMs: number): string {
  return `calls-${new Date(nowMs).toISOString().slice(0, 10)}`;
}

/** AEROAPI_DAILY_LIMIT, default 40; junk falls back to the default. */
export function dailyLimit(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : 40;
}

/**
 * Daily AeroAPI call budget over a tiny key/value store (Netlify Blobs in
 * production). Best effort, not atomic: two simultaneous misses can both read
 * the same count, which over-spends by at most a few calls. A store failure
 * refuses the call (fails closed).
 */
export function makeBudget(store: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<unknown> }, limit: number) {
  return async (nowMs: number, calls = 1): Promise<boolean> => {
    try {
      const key = budgetKey(nowMs);
      const used = Number((await store.get(key)) ?? '0');
      const n = Number.isFinite(used) ? used : 0;
      if (n + calls > limit) return false;
      await store.set(key, String(n + calls));
      return true;
    } catch {
      return false;
    }
  };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
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

/** Best-effort fixed-window limiter (memory is per function instance). */
export function makeLimiter(max: number, windowMs: number): (key: string, nowMs: number) => boolean {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key, nowMs) => {
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= nowMs) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset <= nowMs) { hits.set(key, { n: 1, reset: nowMs + windowMs }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}
