/**
 * Season chips from the published schedules (replaces the hand-written
 * Destination.season strings, which contradicted the data for 49
 * destinations: PUJ said 'Oct – Apr' but flies all year).
 */
import { getCoverage, getSchedulesForRoute, scheduleVersion } from '../data/schedule-index';
import { addDays, diffDays, weekdayIndex } from './time';
import { parseDayMask } from './week';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

let cacheVersion = -1;
const cache = new Map<string, string | null>();

function monthEnd(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, '0')}`;
}

/** True when a record with weekday `mask` operates on some day in [from, to]. */
function operatesBetween(mask: number, from: string, to: string): boolean {
  if (from > to || !mask) return false;
  if (diffDays(from, to) >= 6) return true;
  for (let k = from; k <= to; k = addDays(k, 1)) if (mask & (1 << weekdayIndex(k))) return true;
  return false;
}

/** 'Nov – Apr', 'Dec', or several runs joined: 'Dec – Jan, Jun – Aug'. */
function label(runs: [number, number][]): string {
  return runs.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]} – ${MONTHS[b]}`)).join(', ');
}

/**
 * The months origin → dest flies within the published window, as a chip
 * label, or null when it flies every month of the window (year-round) or not
 * at all. When the window covers a full year the months wrap (Nov – Apr);
 * otherwise only months inside the window are described.
 */
export function routeSeason(origin: string, dest: string): string | null {
  if (cacheVersion !== scheduleVersion()) {
    cache.clear();
    cacheVersion = scheduleVersion();
  }
  const key = `${origin}-${dest}`;
  if (cache.has(key)) return cache.get(key)!;

  const { from, to } = getCoverage();
  let result: string | null = null;
  const records = getSchedulesForRoute(origin, dest);
  if (from && to && records.length) {
    // Calendar months of the window, in order ('2026-09' … '2027-09').
    const windowMonths: string[] = [];
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
      windowMonths.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    const flownMonth = (ym: string) => {
      const start = `${ym}-01` < from ? from : `${ym}-01`;
      const end = monthEnd(ym) > to ? to : monthEnd(ym);
      return records.some(r => operatesBetween(parseDayMask(r.days),
        r.fromDate > start ? r.fromDate : start, r.toDate < end ? r.toDate : end));
    };
    const flown = windowMonths.map(flownMonth);
    const moy = new Set(windowMonths.map(m => Number(m.slice(5, 7)) - 1));
    if (flown.some(Boolean) && !flown.every(Boolean)) {
      if (moy.size === 12) {
        // Full year: fold onto months of the year and wrap around December.
        const byMonth = Array.from({ length: 12 }, () => false);
        windowMonths.forEach((m, i) => { if (flown[i]) byMonth[Number(m.slice(5, 7)) - 1] = true; });
        if (!byMonth.every(Boolean)) {
          const start = byMonth.findIndex((f, i) => f && !byMonth[(i + 11) % 12]);
          const runs: [number, number][] = [];
          for (let k = 0; k < 12; k++) {
            const i = (start + k) % 12;
            if (!byMonth[i]) continue;
            const last = runs[runs.length - 1];
            if (last && last[1] === (i + 11) % 12) last[1] = i;
            else runs.push([i, i]);
          }
          result = label(runs);
        }
      } else {
        const runs: [number, number][] = [];
        let prev = false;
        windowMonths.forEach((m, i) => {
          const mi = Number(m.slice(5, 7)) - 1;
          if (flown[i]) {
            if (prev) runs[runs.length - 1][1] = mi;
            else runs.push([mi, mi]);
          }
          prev = flown[i];
        });
        result = label(runs);
      }
    }
  }
  cache.set(key, result);
  return result;
}
