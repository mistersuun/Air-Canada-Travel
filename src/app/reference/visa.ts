/**
 * Entry listings by passport (public/data/visa.json, built by scripts/build-visa.py
 * from Passport Index data compiled by imorte/passport-index-data, MIT). Pure:
 * decoding, the best listing across the user's passports, and its wording.
 *
 * House rule: these are third-party listings with a date, never advice. Every
 * line says who lists it and when, and points to the official rules.
 */
import { intlLocale } from '../i18n/locale';
import { t } from '../i18n/t';
import { diffDays, formatKey } from '../utils/time';

/** F visa-free (days or no stated limit), T electronic authorisation, A on arrival, E e-visa, V visa, N no admission, O own country. */
export type EntryKind = 'F' | 'T' | 'A' | 'E' | 'V' | 'N' | 'O';
export interface EntryListing { kind: EntryKind; days: number | null }

export interface VisaTable {
  asOf: string;
  attribution: string;
  licenseUrl: string;
  /** Destination ISO2 → column index. */
  cols: ReadonlyMap<string, number>;
  /** Passport ISO2 → one code per column. */
  rows: ReadonlyMap<string, readonly string[]>;
}

/** Listings older than this are not shown: entry systems change (ETIAS, UK ETA). */
export const VISA_MAX_AGE_DAYS = 548;

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const ISO2 = /^[A-Z]{2}$/;
const CODE = /^(F\d{0,3}|[TAEVNO])?$/;

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

export function decodeVisa(raw: unknown): VisaTable | null {
  const r = rec(raw);
  const rowsRaw = rec(r?.['rows']);
  if (!r || r['v'] !== 1 || typeof r['asOf'] !== 'string' || !KEY.test(r['asOf']) || !Array.isArray(r['cols']) || !rowsRaw) return null;
  if (typeof r['attribution'] !== 'string' || !r['attribution']) return null;
  const colList = r['cols'] as unknown[];
  if (!colList.every(c => typeof c === 'string' && ISO2.test(c))) return null;
  const cols = new Map((colList as string[]).map((c, i) => [c, i]));
  const rows = new Map<string, readonly string[]>();
  for (const [pp, v] of Object.entries(rowsRaw)) {
    if (!ISO2.test(pp) || typeof v !== 'string') continue;
    const cells = v.split(',');
    if (cells.length !== colList.length || !cells.every(c => CODE.test(c))) continue;
    rows.set(pp, cells);
  }
  if (!rows.size) return null;
  const licenseUrl = typeof r['licenseUrl'] === 'string' && /^https:\/\//.test(r['licenseUrl']) ? r['licenseUrl'] : '';
  return { asOf: r['asOf'], attribution: r['attribution'], licenseUrl, cols, rows };
}

/** The listing for one passport and destination country, or null when the data has none. */
export function entryListing(table: VisaTable | null, passport: string, dest: string): EntryListing | null {
  const col = table?.cols.get(dest.toUpperCase());
  const cell = col === undefined ? undefined : table!.rows.get(passport.toUpperCase())?.[col];
  if (!cell) return null;
  const kind = cell[0] as EntryKind;
  return { kind, days: kind === 'F' && cell.length > 1 ? Number(cell.slice(1)) : null };
}

const RANK: Record<EntryKind, number> = { O: 0, F: 1, T: 2, A: 3, E: 4, V: 5, N: 6 };

/** Lower is easier: own country, visa-free (no limit, then longer stays), authorisation, on arrival, e-visa, visa, no admission. */
function score(l: EntryListing): number {
  return RANK[l.kind] * 1000 + (l.kind === 'F' ? (l.days === null ? 0 : 999 - Math.min(l.days, 999)) : 0);
}

/** The easiest listing across the user's passports (dual nationals), with the passport it comes from. */
export function bestEntry(table: VisaTable | null, passports: readonly string[], dest: string): (EntryListing & { passport: string }) | null {
  let best: (EntryListing & { passport: string }) | null = null;
  for (const pp of passports) {
    const l = entryListing(table, pp, dest);
    if (l && (!best || score(l) < score(best))) best = { ...l, passport: pp.toUpperCase() };
  }
  return best;
}

/** True when the listings are too old to show (see VISA_MAX_AGE_DAYS). */
export function visaStale(table: VisaTable, todayKey: string): boolean {
  return diffDays(table.asOf, todayKey) > VISA_MAX_AGE_DAYS;
}

/** 'visa-free, up to 90 days', 'electronic travel authorisation', … (UI language). */
export function entryLabel(l: EntryListing): string {
  switch (l.kind) {
    case 'F': return l.days ? t('dest.visa.kind.freeDays', { n: l.days }) : t('dest.visa.kind.free');
    case 'T': return t('dest.visa.kind.eta');
    case 'A': return t('dest.visa.kind.arrival');
    case 'E': return t('dest.visa.kind.evisa');
    case 'V': return t('dest.visa.kind.visa');
    case 'N': return t('dest.visa.kind.none');
    case 'O': return t('dest.visa.kind.own');
  }
}

/** 'Canada' / 'Canada' (fr: country names in the UI language). */
export function passportCountry(iso2: string): string {
  try {
    return new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(iso2.toUpperCase()) ?? iso2;
  } catch {
    return iso2;
  }
}

/** 'Feb 17, 2026' */
export function visaAsOf(table: VisaTable): string {
  return formatKey(table.asOf, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Every passport the data knows, sorted by country name in the UI language, for the profile picker. */
export function passportOptions(table: VisaTable | null): { code: string; name: string }[] {
  if (!table) return [];
  return [...table.rows.keys()].map(code => ({ code, name: passportCountry(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
}
