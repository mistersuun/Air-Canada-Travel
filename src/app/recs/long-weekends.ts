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
  id: string;            // 'lw:2026-10-12' (the observed day)
  holiday: Holiday;
  /** The weekday the holiday is observed: its date, or the next free weekday when it falls on a weekend. */
  observedKey: string;
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

/**
 * National holidays in the data that are not a day off in some provinces
 * (province codes without 'CA-'). Civic Holiday is not a holiday in Quebec;
 * Boxing Day is not a public holiday in QC, AB, BC, MB or SK.
 */
export const NOT_OFF_IN: Record<string, readonly string[]> = {
  'Civic Holiday': ['QC'],
  'Boxing Day': ['QC', 'AB', 'BC', 'MB', 'SK'],
};

/** True when the holiday applies at this hub: national (unless excluded there), or listed for the hub's province. */
export function holidayAppliesAt(h: Holiday, hub: string): boolean {
  const prov = HUB_PROVINCE[hub];
  if (h.region === 'CA') return !prov || !(NOT_OFF_IN[h.name] ?? []).includes(prov.slice(3));
  if (!prov || !h.region.startsWith('CA-')) return false;
  return h.region.slice(3).split(',').includes(prov.slice(3));
}

const MON = 0, TUE = 1, THU = 3, FRI = 4;

/** Saturday and Sunday holidays move to the next weekday; any holiday shifts past days already taken. */
function observedDay(dateKey: string, taken: ReadonlySet<string>): string {
  let d = dateKey;
  const wd = weekdayIndex(d);
  if (wd === 5) d = addDays(d, 2);
  else if (wd === 6) d = addDays(d, 1);
  while (taken.has(d)) d = addDays(d, 1);
  return d;
}

function windowFor(d: string): { out: string[]; back: string[] } | null {
  switch (weekdayIndex(d)) {
    case MON: return { out: [addDays(d, -3), addDays(d, -2)], back: [d, addDays(d, -1)] };
    case FRI: return { out: [addDays(d, -1), d], back: [addDays(d, 2), addDays(d, 3)] };
    case TUE: return { out: [addDays(d, -3)], back: [d] };
    case THU: return { out: [d], back: [addDays(d, 3)] };
    default: return null;
  }
}

/**
 * Long weekends whose observed holiday falls strictly after `fromKey` and at
 * most `horizonDays` later, for the hub's province. One per date (national
 * first). A weekend holiday counts on its observed weekday (Canada Day on a
 * Saturday → Monday; Christmas Sat and Boxing Day Sun → Mon and Tue).
 */
export function longWeekends(fromKey: string, horizonDays = 60, hub: string): LongWeekend[] {
  const y = Number(fromKey.slice(0, 4));
  const endKey = addDays(fromKey, horizonDays);
  const years = [y - 1, y, y + 1].filter(yy => yy <= Number(endKey.slice(0, 4)));
  const taken = new Set<string>();
  const all: { h: Holiday; obs: string }[] = [];
  for (const h of years.flatMap(holidaysIn)) {
    if (!holidayAppliesAt(h, hub) || NOT_WIDELY_OFF.includes(h.name)) continue;
    if (all.some(x => x.h.dateKey === h.dateKey)) continue;
    const obs = observedDay(h.dateKey, taken);
    taken.add(obs);
    all.push({ h, obs });
  }
  const out: LongWeekend[] = [];
  for (const { h, obs } of all) {
    if (obs <= fromKey || diffDays(fromKey, obs) > horizonDays) continue;
    const w = windowFor(obs);
    if (!w) continue;
    const keys = [...w.out, ...w.back].sort();
    out.push({
      id: `lw:${obs}`, holiday: h, observedKey: obs, name: h.name,
      outKeys: w.out, backKeys: w.back, startKey: keys[0], endKey: keys[keys.length - 1],
    });
  }
  return out.sort((a, b) => a.observedKey.localeCompare(b.observedKey));
}

/**
 * The out and back days for a long weekend and profile, or null when none fit.
 * The observed holiday always counts, even when its weekday is not in the
 * profile days. A departure day before `todayKey` never counts.
 */
export function pickDays(lw: LongWeekend, profile: TravelProfile, todayKey = ''): { outKey: string; backKey: string } | null {
  const h = lw.observedKey;
  const notPast = (k: string) => k >= todayKey;
  if (profile.length === 'day') return notPast(h) ? { outKey: h, backKey: h } : null;
  if (profile.length === 'week') {
    const sat = addDays(h, -((weekdayIndex(h) - 5 + 7) % 7 || 7));
    return notPast(sat) ? { outKey: sat, backKey: addDays(sat, 7) } : null;
  }
  const ok = (k: string) => k === h || !profile.days.length || profile.days.includes(isoWeekday(k));
  const outKey = lw.outKeys.filter(notPast).find(ok);
  const backKey = lw.backKeys.find(ok);
  return outKey && backKey ? { outKey, backKey } : null;
}
