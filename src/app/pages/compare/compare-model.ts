/**
 * Compare model (/compare): two or three destinations side by side, in rows
 * of facts. Pure: schedules, climate normals, advisories, exchange rates and
 * entry listings come in as plain values. Facts only. A value is marked best
 * only where the order is objective (more nonstops, a shorter flight); there
 * is never an overall verdict.
 */
import { t } from '../../i18n/t';
import { isCovered } from '../../data/schedule-index';
import { findDestination, airportTz } from '../../utils/airports';
import { NO_OPTS, findItineraries, type ConnectOptions } from '../../utils/connections';
import { routeSeason } from '../../utils/season';
import { addDays, formatClock, formatKey, weekKeys, weekdayIndex, weekdayShort } from '../../utils/time';
import { coverageHubFor, flightsOn } from '../../utils/week';
import { hm, tzDiffLabel } from '../../ui/format';
import { climateFor, wetDaysText } from '../../recs/climate';
import type { ClimateIndex, ClimateMonth } from '../../recs/model';
import type { TimeFormat } from '../../state/prefs.service';
import { currencyCode, currencyName } from '../destination/currency';
import { nextDeparture, upcoming, zoneAbbr, type NextDeparture } from '../destination/dest-model';
import { advisoryUpdated, fxLine, type AdvisoryIndex, type FxTable } from '../../reference/reference';
import { bestEntry, entryLabel, passportCountry, visaAsOf, visaStale, type VisaTable } from '../../reference/visa';

/** At most this many destinations are compared. */
export const MAX_COMPARE = 3;

/** ?c=LIS,SVQ,OPO → valid destination codes, upper-case, de-duplicated, at most MAX_COMPARE; the rest is ignored. */
export function parseCompareCodes(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const code = part.trim().toUpperCase();
    if (code && !out.includes(code) && findDestination(code)) out.push(code);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}

/** The ?c= value for a list of codes (null when empty, so the param is dropped). */
export function compareParam(codes: readonly string[]): string | null {
  return codes.length ? codes.join(',') : null;
}

export interface CompareInput {
  hub: string;
  nowMs: number;
  /** Today at the hub. */
  todayKey: string;
  weekStart: string;
  /** The picked day, or null. */
  dayKey: string | null;
  showConnections: boolean;
  connect?: ConnectOptions;
  timeFormat: TimeFormat;
  climate: ClimateIndex | null;
  advisories: AdvisoryIndex | null;
  fx: FxTable | null;
  visa: VisaTable | null;
  passports: readonly string[];
}

export interface CompareColumn {
  code: string;
  city: string;
  country: string;
  /** Nonstop departures hub → destination in the selected week. */
  nonstopWeek: number;
  /** One-stop itineraries in the week; null when connections are not shown. */
  oneStopWeek: number | null;
  next: NextDeparture | null;
  /** Nonstop departures destination → hub in the week. */
  homeCount: number;
  /** The last nonstop home on the reference day ('Fri 21:40'), or null. */
  lastHome: string | null;
  /** Shortest scheduled nonstop, in minutes. */
  flightMin: number | null;
  tz: string;
  weather: ClimateMonth | null;
  currency: string;
  fx: { text: string; source: string } | null;
  advisory: { text: string; updated: string; regional: boolean } | null;
  entry: { line: string; source: string } | null;
  season: string;
}

/** The month the weather is for: the picked day's, else mid-week. */
export function weatherMonth(input: Pick<CompareInput, 'dayKey' | 'weekStart'>): number {
  return Number((input.dayKey ?? addDays(input.weekStart, 3)).slice(5, 7));
}

export function compareColumn(input: CompareInput, code: string): CompareColumn {
  const d = findDestination(code)!;
  const { hub } = input;
  const connect = input.connect ?? NO_OPTS;
  const days = weekKeys(input.weekStart);
  const out = days.flatMap(k => flightsOn(hub, code, k));
  const back = days.map(k => ({ k, flights: flightsOn(code, hub, k).slice().sort((a, b) => a.depLocal.localeCompare(b.depLocal)) }));

  let oneStopWeek: number | null = null;
  if (input.showConnections) {
    const cov = coverageHubFor(hub, code);
    oneStopWeek = days.reduce((n, k) => n + (isCovered(k, cov) ? findItineraries(hub, code, k, connect).filter(it => it.legs.length > 1).length : 0), 0);
  }

  const start = input.dayKey ?? input.todayKey;
  let it = upcoming(hub, code, start, input.nowMs, 'direct', connect, undefined, 1)[0];
  if (!it && input.showConnections) it = upcoming(hub, code, start, input.nowMs, 'via', connect, undefined, 1)[0];
  const next = nextDeparture(it, input.todayKey, input.timeFormat);

  // The reference day for "last flight home": the picked day, else the first day of the week from today with one.
  const refFrom = input.todayKey > input.weekStart ? input.todayKey : input.weekStart;
  const refDay = input.dayKey
    ? back.find(b => b.k === input.dayKey)
    : back.find(b => b.k >= refFrom && b.flights.length);
  const lastFlight = refDay?.flights[refDay.flights.length - 1];
  const lastHome = lastFlight
    ? `${weekdayShort(weekdayIndex(refDay!.k))} ${formatClock(lastFlight.depLocal, input.timeFormat)}`
    : null;

  const durations = out.map(f => f.durationMin);
  const flightMin = durations.length ? Math.min(...durations) : it && !it.hubs.length ? it.totalMin : null;

  const advisory = input.advisories?.get(d.iso2.toUpperCase()) ?? null;
  const cur = currencyCode(d.iso2);
  const table = input.visa;
  const listing = table && input.passports.length && !visaStale(table, input.todayKey) ? bestEntry(table, input.passports, d.iso2) : null;

  return {
    code, city: d.city, country: d.country,
    nonstopWeek: out.length,
    oneStopWeek,
    next,
    homeCount: back.reduce((n, b) => n + b.flights.length, 0),
    lastHome,
    flightMin,
    tz: [tzDiffLabel(d.tz, airportTz(hub), input.nowMs), zoneAbbr(d.tz, d.iso2, input.nowMs)].filter(Boolean).join(' · '),
    weather: climateFor(input.climate, code, weatherMonth(input)),
    currency: currencyName(d.iso2) || cur || '',
    fx: fxLine(cur, input.fx),
    advisory: advisory ? { text: advisory.text, updated: advisoryUpdated(advisory, input.todayKey), regional: advisory.regional } : null,
    entry: listing && table ? {
      line: t('dest.visa.line', { country: passportCountry(listing.passport), status: entryLabel(listing) }),
      source: `${t('dest.visa.source', { date: visaAsOf(table) })} · ${t('dest.visa.checkGov')}`,
    } : null,
    season: routeSeason(hub, code) ?? t('dest.yearRound'),
  };
}

export interface CompareCell {
  text: string;
  /** A second, smaller line (a source, a date, a rate). */
  sub?: string;
  /** The best value in an objectively ordered row. */
  best?: boolean;
}

export interface CompareRow {
  id: string;
  label: string;
  cells: CompareCell[];
}

const DASH = '—';

/** Indexes holding the best value, when at least two columns have one and they differ. */
export function bestIndexes(values: readonly (number | null)[], better: 'high' | 'low'): Set<number> {
  const have = values.filter((v): v is number => v !== null);
  if (have.length < 2 || new Set(have).size < 2) return new Set();
  const target = better === 'high' ? Math.max(...have) : Math.min(...have);
  return new Set(values.flatMap((v, i) => (v === target ? [i] : [])));
}

function numericRow(id: string, label: string, cols: readonly CompareColumn[], value: (c: CompareColumn) => number | null,
                    better: 'high' | 'low', text: (c: CompareColumn) => string): CompareRow {
  const best = bestIndexes(cols.map(value), better);
  return { id, label, cells: cols.map((c, i) => ({ text: text(c), best: best.has(i) })) };
}

/** The rows of the comparison, in display order; empty cells read '—'. */
export function compareRows(cols: readonly CompareColumn[], input: CompareInput): CompareRow[] {
  const rows: CompareRow[] = [];
  rows.push(numericRow('flights', t('compare.row.flights'), cols, c => c.nonstopWeek, 'high', c => {
    const n = t('compare.nonstops', { n: c.nonstopWeek });
    return c.oneStopWeek === null ? n : `${n} · ${t('compare.oneStops', { n: c.oneStopWeek })}`;
  }));
  rows.push({
    id: 'next', label: t('compare.row.next'),
    cells: cols.map(c => ({ text: c.next?.when ?? DASH, sub: c.next?.detail })),
  });
  rows.push(numericRow('home', t('compare.row.home'), cols, c => c.homeCount, 'high', c => t('compare.nonstops', { n: c.homeCount })));
  rows.push({ id: 'lastHome', label: t('compare.row.lastHome'), cells: cols.map(c => ({ text: c.lastHome ?? DASH })) });
  rows.push(numericRow('duration', t('compare.row.duration'), cols, c => c.flightMin, 'low', c => (c.flightMin === null ? DASH : hm(c.flightMin))));
  rows.push({ id: 'tz', label: t('compare.row.tz', { hub: input.hub }), cells: cols.map(c => ({ text: c.tz || DASH })) });
  rows.push({
    id: 'weather',
    label: t('dest.climate.typicalIn', { month: formatKey(`2000-${String(weatherMonth(input)).padStart(2, '0')}-01`, { month: 'long' }) }),
    cells: cols.map(c => c.weather
      ? { text: `${c.weather.tmaxC}° / ${c.weather.tminC}°`, sub: wetDaysText(c.weather.wetDays) }
      : { text: DASH }),
  });
  rows.push({
    id: 'currency', label: t('dest.currency'),
    cells: cols.map(c => ({ text: c.currency || DASH, sub: c.fx ? `${c.fx.text} · ${c.fx.source}` : undefined })),
  });
  rows.push({
    id: 'advisory', label: t('compare.row.advisory'),
    cells: cols.map(c => c.advisory
      ? { text: c.advisory.text, sub: [c.advisory.updated, c.advisory.regional ? t('dest.ref.regional') : ''].filter(Boolean).join(' · ') || undefined }
      : { text: DASH }),
  });
  if (input.passports.length) {
    rows.push({
      id: 'entry', label: t('compare.row.entry'),
      cells: cols.map(c => (c.entry ? { text: c.entry.line, sub: c.entry.source } : { text: DASH })),
    });
  }
  rows.push({ id: 'season', label: t('dest.season'), cells: cols.map(c => ({ text: c.season })) });
  return rows;
}
