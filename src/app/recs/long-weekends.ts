/**
 * Upcoming long weekends around Canadian public holidays (extras spec §5.2).
 * Pure: holidays come from trips/engine/holidays (rules, any year).
 */
import { Holiday, holidaysIn } from '../trips/engine/holidays';
import { addDays, diffDays, weekdayIndex } from '../utils/time';
import { TravelProfile } from './model';

export const HUB_PROVINCE: Record<string, string> = {
  YUL: 'CA-QC', YQB: 'CA-QC', YYZ: 'CA-ON', YTZ: 'CA-ON', YOW: 'CA-ON',
  YVR: 'CA-BC', YYC: 'CA-AB', YEG: 'CA-AB', YHZ: 'CA-NS', YWG: 'CA-MB',
};

/** Statutory somewhere, but most people still work: never suggested as a long weekend. */
export const NOT_WIDELY_OFF = ['Easter Monday', 'National Day for Truth and Reconciliation', 'Remembrance Day'];

export interface LongWeekend {
  id: string;            // 'lw:2026-10-12'
  holiday: Holiday;
  name: string;          // 'Thanksgiving'
  outKeys: string[];     // candidate departure days, preferred first
  backKeys: string[];    // candidate return days, preferred first
  startKey: string;      // earliest day of the window
  endKey: string;        // latest day of the window
}

/** ISO weekday 1..7 (Mon..Sun) of a date key. */
export function isoWeekday(key: string): number {
  return weekdayIndex(key) + 1;
}

/** True when the holiday applies at this hub: national, or listed for the hub's province. */
export function holidayAppliesAt(h: Holiday, hub: string): boolean {
  if (h.region === 'CA') return true;
  const prov = HUB_PROVINCE[hub];
  if (!prov || !h.region.startsWith('CA-')) return false;
  return h.region.slice(3).split(',').includes(prov.slice(3));
}

const MON = 0, TUE = 1, THU = 3, FRI = 4;

function windowFor(h: Holiday): { out: string[]; back: string[] } | null {
  const d = h.dateKey;
  switch (weekdayIndex(d)) {
    case MON: return { out: [addDays(d, -3), addDays(d, -2)], back: [d, addDays(d, -1)] };
    case FRI: return { out: [addDays(d, -1), d], back: [addDays(d, 2), addDays(d, 3)] };
    case TUE: return { out: [addDays(d, -3)], back: [d] };
    case THU: return { out: [d], back: [addDays(d, 3)] };
    default: return null;
  }
}

/**
 * Long weekends whose holiday falls strictly after `fromKey` and at most
 * `horizonDays` later, for the hub's province. One per date (national first).
 */
export function longWeekends(fromKey: string, horizonDays = 60, hub: string): LongWeekend[] {
  const y = Number(fromKey.slice(0, 4));
  const endKey = addDays(fromKey, horizonDays);
  const years = [y, y + 1].filter(yy => yy <= Number(endKey.slice(0, 4)));
  const seen = new Set<string>();
  const out: LongWeekend[] = [];
  for (const h of years.flatMap(holidaysIn)) {
    if (h.dateKey <= fromKey || diffDays(fromKey, h.dateKey) > horizonDays) continue;
    if (!holidayAppliesAt(h, hub) || NOT_WIDELY_OFF.includes(h.name) || seen.has(h.dateKey)) continue;
    const w = windowFor(h);
    if (!w) continue;
    seen.add(h.dateKey);
    const all = [...w.out, ...w.back].sort();
    out.push({
      id: `lw:${h.dateKey}`, holiday: h, name: h.name,
      outKeys: w.out, backKeys: w.back, startKey: all[0], endKey: all[all.length - 1],
    });
  }
  return out.sort((a, b) => a.holiday.dateKey.localeCompare(b.holiday.dateKey));
}

/**
 * The out and back days for a long weekend and profile, or null when none fit.
 * A holiday date always counts, even when its weekday is not in the profile days.
 */
export function pickDays(lw: LongWeekend, profile: TravelProfile): { outKey: string; backKey: string } | null {
  const h = lw.holiday.dateKey;
  if (profile.length === 'day') return { outKey: h, backKey: h };
  if (profile.length === 'week') {
    const sat = addDays(h, -((weekdayIndex(h) - 5 + 7) % 7 || 7));
    return { outKey: sat, backKey: addDays(sat, 7) };
  }
  const ok = (k: string) => k === h || !profile.days.length || profile.days.includes(isoWeekday(k));
  const outKey = lw.outKeys.find(ok);
  const backKey = lw.backKeys.find(ok);
  return outKey && backKey ? { outKey, backKey } : null;
}
