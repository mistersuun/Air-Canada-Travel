/**
 * IATA BCBP (Resolution 792, M-format) parser, ported 1:1 from the research
 * reference parser (extras spec §4.5). Pure, no dependencies.
 *
 * Privacy: the security block (the airline's signature) is never copied into
 * the result; only `{ present: true }` says one was there.
 */
import type { BcbpLeg, BcbpParse, BcbpPassenger } from './model';

const T = (s: string): string => s.trim();
const hex = (s: string): number => (/^[0-9A-Fa-f]{2}$/.test(s) ? parseInt(s, 16) : NaN);
/** Strips leading zeros (keeps one digit) after trimming: '0834 ' → '834', '0834A' → '834A'. */
const num = (s: string): string => s.trim().replace(/^0+(?=\d)/, '');
const orNull = (s: string | undefined): string | null => (s ? s : null);

interface Scan { result: BcbpParse; securityAt: number | null }

function scan(raw: string): Scan {
  const s = raw.replace(/\r?\n$/, '');
  if (s.length < 60 || s[0] !== 'M' || !/^[1-4]$/.test(s[1])) return { result: { ok: false, error: 'not-bcbp-m' }, securityAt: null };
  const legCount = +s[1];
  const nameRaw = s.slice(2, 22);
  const [last, firstAndTitle = ''] = T(nameRaw).split('/');
  const passenger: BcbpPassenger = {
    nameRaw: T(nameRaw), lastName: T(last), firstName: T(firstAndTitle), eTicket: s[22] === 'E', issueDate: null, issuer: null,
  };
  const legs: BcbpLeg[] = [];
  const warnings: string[] = [];
  let p = 23;
  let version: string | null = null;
  for (let i = 0; i < legCount; i++) {
    if (s.length < p + 37) {
      warnings.push(`leg${i + 1}-truncated`);
      break;
    }
    const L = s.slice(p, p + 37);
    const leg: BcbpLeg = {
      pnr: T(L.slice(0, 7)), from: L.slice(7, 10), to: L.slice(10, 13), carrier: T(L.slice(13, 16)),
      flightNumber: num(L.slice(16, 21)), julian: +L.slice(21, 24), cabin: L[24],
      seat: orNull(T(L.slice(25, 29)).replace(/^0+(?=\d)/, '')), sequence: orNull(num(L.slice(29, 34))), paxStatus: L[34],
    };
    const condSize = hex(L.slice(35, 37));
    p += 37;
    if (!Number.isFinite(condSize)) {
      warnings.push(`leg${i + 1}-bad-cond-size`);
      legs.push(leg);
      break;
    }
    const cond = s.slice(p, p + condSize);
    p += condSize;
    let c = 0;
    if (i === 0 && cond[0] === '>') { // version + unique (once per pass) items
      version = cond[1] ?? null;
      const uSize = hex(cond.slice(2, 4));
      const u = cond.slice(4, 4 + (Number.isFinite(uSize) ? uSize : 0));
      passenger.issueDate = u.length >= 7 ? u.slice(3, 7) : null; // 'yddd': last digit of the year + day of year
      passenger.issuer = u.length >= 11 ? T(u.slice(8, 11)) || null : null;
      c = 4 + (Number.isFinite(uSize) ? uSize : 0);
    }
    const rSize = hex(cond.slice(c, c + 2)); // repeated (per-leg) conditional items
    if (Number.isFinite(rSize) && rSize > 0) {
      const r = cond.slice(c + 2, c + 2 + rSize);
      leg.airlineNumeric = orNull(T(r.slice(0, 3)));
      leg.docSerial = orNull(T(r.slice(3, 13)));
      leg.marketingCarrier = orNull(T(r.slice(15, 18)));
      leg.ffAirline = orNull(T(r.slice(18, 21)));
      leg.ffNumber = orNull(T(r.slice(21, 37)));
      leg.freeBaggage = orNull(T(r.slice(38, 41)));
    }
    legs.push(leg);
  }
  let security: { present: true } | null = null;
  let securityAt: number | null = null;
  if (s[p] === '^') {
    security = { present: true };
    securityAt = p;
  } else if (p < s.length) {
    warnings.push('trailing-data');
  }
  return { result: { ok: true, version, legCount, passenger, legs, security, warnings }, securityAt };
}

/** Parses an M-format boarding pass barcode. Anything else is `{ ok: false }`. */
export function parseBcbp(raw: string): BcbpParse {
  return scan(raw).result;
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAY_MS = 864e5;

/**
 * Day-of-year → 'YYYY-MM-DD'. BCBP has no year in the flight date, so this
 * picks the year (anchor year −1, 0, +1) that lands closest to `anchorDateKey`
 * (the matched leg's date, else the trip's first day). With an issue date
 * ('yddd'), the flight must be on or after the issue day (1 day of slack) and
 * within a year of it. Day 366 only exists in leap years; null when no year fits.
 */
export function julianToDateKey(doy: number, anchorDateKey: string, issueDate?: string | null): string | null {
  if (!(doy >= 1 && doy <= 366)) return null;
  const a = Date.parse(anchorDateKey + 'T00:00:00Z');
  if (!Number.isFinite(a)) return null;
  const ay = new Date(a).getUTCFullYear();
  let issue: number | null = null;
  if (issueDate && /^\d{4}$/.test(issueDate)) {
    const yd = +issueDate[0];
    const idoy = +issueDate.slice(1);
    for (const y of [ay - 1, ay, ay + 1, ay - 2]) {
      if (y % 10 === yd && idoy >= 1 && idoy <= (isLeap(y) ? 366 : 365)) {
        issue = Date.UTC(y, 0, idoy);
        break;
      }
    }
  }
  let best: { y: number; d: number } | null = null;
  for (const y of [ay - 1, ay, ay + 1]) {
    if (doy === 366 && !isLeap(y)) continue;
    const t = Date.UTC(y, 0, doy);
    if (issue !== null && (t < issue - DAY_MS || t > issue + 366 * DAY_MS)) continue;
    const d = Math.abs(t - a);
    if (!best || d < best.d) best = { y, d };
  }
  return best ? new Date(Date.UTC(best.y, 0, doy)).toISOString().slice(0, 10) : null;
}

/** ('AC ', '0834') → 'AC834'; ('AC', '0834A') → 'AC834A'. */
export function normalizeFlightNumber(carrier: string, flight: string): string {
  return (carrier.trim() + num(flight)).toUpperCase();
}

/** 'XK7Q2B' → 'XK7•••'; 3 characters or fewer → '•••'. */
export function maskPnr(pnr: string): string {
  const p = pnr.trim();
  return p.length <= 3 ? '•••' : `${p.slice(0, 3)}•••`;
}

/** The barcode text cut before the security block and trimmed (the check step's "Barcode text"). */
export function displayText(raw: string): string {
  const { securityAt } = scan(raw);
  const s = raw.replace(/\r?\n$/, '');
  if (securityAt !== null) return s.slice(0, securityAt).trim();
  const caret = s.indexOf('^');
  return (caret >= 0 ? s.slice(0, caret) : s).trim();
}
