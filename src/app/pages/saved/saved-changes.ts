/**
 * Schedule changes for starred destinations: a tiny snapshot per destination
 * (the next 8 weeks' nonstop-day counts per hub, and each hub's first and last
 * published nonstop date) and a pure diff between two snapshots. Facts only:
 * what the published schedules said last time versus now.
 */
import { getSchedulesForRoute } from '../../data/schedule-index';
import { HUBS } from '../../data/destinations';
import { t } from '../../i18n/t';
import { addDays, formatKey, weekStartKey } from '../../utils/time';
import { countFlyingDays } from '../../utils/week';

export const SNAPSHOT_WEEKS = 8;
export const MAX_CHANGES = 3;

export interface DestSnapshot {
  v: 1;
  /** hub → week start → days with a nonstop that week. Hubs with no published nonstop are absent. */
  weeks: Record<string, Record<string, number>>;
  /** hub → [first, last] date of any published nonstop record. */
  season: Record<string, [string, string]>;
}

export type SavedChange =
  | { kind: 'new'; hub: string; from: string }
  | { kind: 'ends'; hub: string; last: string }
  | { kind: 'fewer' | 'more'; hub: string; weekStart: string; from: number; to: number };

/** The snapshot of `code` as the schedules stand now. */
export function snapshotFor(code: string, today: string, hubs: readonly string[] = HUBS.map(h => h.code)): DestSnapshot {
  const snap: DestSnapshot = { v: 1, weeks: {}, season: {} };
  const first = weekStartKey(today);
  for (const hub of hubs) {
    const records = getSchedulesForRoute(hub, code);
    if (!records.length) continue;
    let lo = records[0].fromDate;
    let hi = records[0].toDate;
    for (const r of records) {
      if (r.fromDate < lo) lo = r.fromDate;
      if (r.toDate > hi) hi = r.toDate;
    }
    snap.season[hub] = [lo, hi];
    const weeks: Record<string, number> = {};
    for (let i = 0; i < SNAPSHOT_WEEKS; i++) {
      const ws = addDays(first, i * 7);
      weeks[ws] = countFlyingDays(hub, code, ws, addDays(ws, 6));
    }
    snap.weeks[hub] = weeks;
  }
  return snap;
}

/** True for a value that looks like a stored snapshot. */
export function isSnapshot(x: unknown): x is DestSnapshot {
  const s = x as DestSnapshot | null;
  return !!s && typeof s === 'object' && s.v === 1 && !!s.weeks && typeof s.weeks === 'object' && !!s.season && typeof s.season === 'object';
}

/**
 * What changed from `prev` to `next`, per hub: a route that appeared, a route
 * whose last nonstop moved earlier (or that is gone), and the first upcoming week
 * whose count of nonstop days differs. The selected hub comes first. No
 * previous snapshot means nothing to compare, so no changes.
 */
export function diffSnapshots(prev: DestSnapshot | null | undefined, next: DestSnapshot, today: string, hub?: string): SavedChange[] {
  if (!prev) return [];
  const out: SavedChange[] = [];
  const thisWeek = weekStartKey(today);
  const hubs = [...new Set([...Object.keys(prev.season), ...Object.keys(next.season)])]
    .sort((a, b) => (a === hub ? -1 : b === hub ? 1 : a.localeCompare(b)));
  for (const h of hubs) {
    const p = prev.season[h];
    const n = next.season[h];
    if (!p && n) {
      if (n[1] >= today) out.push({ kind: 'new', hub: h, from: n[0] });
    } else if (p && !n) {
      if (p[1] >= today) out.push({ kind: 'ends', hub: h, last: p[1] });
    } else if (p && n) {
      if (n[1] < p[1] && n[1] >= today) {
        out.push({ kind: 'ends', hub: h, last: n[1] });
      } else {
        const pw = prev.weeks[h] ?? {};
        const nw = next.weeks[h] ?? {};
        const ws = Object.keys(nw).filter(k => k >= thisWeek && k in pw).sort().find(k => nw[k] !== pw[k]);
        if (ws) out.push({ kind: nw[ws] < pw[ws] ? 'fewer' : 'more', hub: h, weekStart: ws, from: pw[ws], to: nw[ws] });
      }
    }
  }
  return out.slice(0, MAX_CHANGES);
}

const day = (key: string) => formatKey(key, { month: 'short', day: 'numeric' });

/** One plain line, e.g. 'Ends: last nonstop Oct 28'. A hub other than `hub` is named at the end. */
export function changeLabel(c: SavedChange, today: string, hub?: string): string {
  let text: string;
  switch (c.kind) {
    case 'new':
      return c.from > today ? t('saved.chg.new', { hub: c.hub, date: day(c.from) }) : t('saved.chg.newNow', { hub: c.hub });
    case 'ends':
      text = t('saved.chg.ends', { date: day(c.last) });
      break;
    default: {
      const params = { from: c.from, to: c.to, date: day(c.weekStart) };
      const key = c.kind === 'fewer' ? 'fewer' : 'more';
      text = c.weekStart === weekStartKey(today)
        ? t(key === 'fewer' ? 'saved.chg.fewer' : 'saved.chg.more', params)
        : t(key === 'fewer' ? 'saved.chg.fewerWeek' : 'saved.chg.moreWeek', params);
    }
  }
  return c.hub === hub ? text : t('saved.chg.fromHub', { text, hub: c.hub });
}
