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
  date: string;
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

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** 'AC834' / 'ACA834' / 'ac834' form; returns the ICAO ident ('ACA834') or null. */
export function validateIdent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^([A-Z]{2,3})(\d{1,4})$/.exec(raw.trim().toUpperCase());
  if (!m) return null;
  return `${m[1] === 'AC' ? 'ACA' : m[1]}${m[2]}`;
}

/** A real 'YYYY-MM-DD' within -1..+2 days of `nowMs` (UTC calendar; the wide range absorbs time zones). */
export function validateDate(raw: unknown, nowMs: number): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== raw) return null;
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const diff = Math.round((ms - today) / DAY_MS);
  return diff >= -1 && diff <= 2 ? raw : null;
}

const isoZ = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

/**
 * The AeroAPI start/end (UTC) for a local departure date. The origin's time
 * zone is unknown to the server (privacy: it only sees ident + date), so the
 * window is wide enough for any airport.
 */
export function queryWindow(date: string): { start: string; end: string } {
  const d0 = Date.parse(`${date}T00:00:00Z`);
  return { start: isoZ(d0 - 4 * HOUR_MS), end: isoZ(d0 + DAY_MS + 10 * HOUR_MS) };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 40): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const iso = (v: unknown): string | null => {
  const s = str(v, 40);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};

/** Of the flights returned for the window, the one departing nearest the middle of the date's UTC span. Skips malformed entries. */
export function pickFlight(body: unknown, date: string): Rec | null {
  const list = isRec(body) && Array.isArray(body['flights']) ? body['flights'] : [];
  const centre = Date.parse(`${date}T00:00:00Z`) + 14 * HOUR_MS;
  let best: Rec | null = null;
  let bestD = Infinity;
  for (const f of list) {
    if (!isRec(f)) continue;
    const t = Date.parse(str(f['scheduled_out']) ?? str(f['scheduled_off']) ?? '');
    const d = Number.isFinite(t) ? Math.abs(t - centre) : Infinity;
    if (!best || d < bestD) { best = f; bestD = d; }
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
  req: { ident: string; date: string },
  inbound: FlightStatus['inbound'],
  nowMs: number,
): FlightStatus {
  return {
    ident: displayIdent(req.ident),
    date: req.date,
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
    landed: iso(first['actual_in']) ?? iso(first['actual_on']),
    estimatedIn: iso(first['estimated_in']) ?? iso(first['estimated_on']),
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
