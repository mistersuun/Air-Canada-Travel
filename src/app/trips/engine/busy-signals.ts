/**
 * Dates travellers know are popular, as neutral labelled facts: Canadian
 * public holidays and the school breaks of the hub's province. Never a score,
 * never "busy" or "full": the app states the date and nothing else.
 *
 * Holidays come from holidays.ts (national ones plus the hub's province).
 * Civic Holiday and Easter Monday are left out: they are not statutory in
 * every province, so a marker on them would claim more than the rule table does.
 */
import { t } from '../../i18n/t';
import { formatKey } from '../../utils/time';
import { holidayShortName, holidaysIn, type Holiday } from './holidays';
import {
  breakLabel, breakRange, hubProvince, provinceName, schoolBreakOn, schoolBreaksBetween, type SchoolBreak,
} from './school-breaks';

const NOT_EVERYWHERE = new Set(['Civic Holiday', 'Easter Monday']);

/** The Canadian holidays that apply in the hub's province on `dateKey`, national ones first. */
export function holidaysOnFor(hub: string, dateKey: string): Holiday[] {
  const prov = hubProvince(hub);
  const year = Number(dateKey.slice(0, 4));
  return holidaysIn(year).filter(h => {
    if (h.dateKey !== dateKey || h.region === 'US') return false;
    if (h.region === 'CA') return !NOT_EVERYWHERE.has(h.name);
    return !!prov && h.region.slice(3).split(',').includes(prov);
  });
}

export interface DaySignals {
  /** Holiday names (UI language), empty when none. */
  holidays: string[];
  schoolBreak: SchoolBreak | null;
}

export function daySignals(hub: string, dateKey: string): DaySignals {
  return { holidays: holidaysOnFor(hub, dateKey).map(holidayShortName), schoolBreak: schoolBreakOn(hub, dateKey) };
}

/** 'Holiday: Labour Day' / 'School break (Ontario): Toronto District School Board March break'. */
export function signalText(hub: string, s: DaySignals): string[] {
  const out = s.holidays.map(name => t('calendar.signal.holiday', { name }));
  const p = hubProvince(hub);
  if (s.schoolBreak && p) out.push(t('calendar.signal.break', { province: provinceName(p), label: breakLabel(s.schoolBreak) }));
  return out;
}

/** The legend label for school breaks at this hub, or null when its province is unknown. */
export function breakLegend(hub: string): string | null {
  const p = hubProvince(hub);
  return p ? t('calendar.legendBreak', { province: provinceName(p) }) : null;
}

/**
 * Lines for a date window: each holiday in it, then each school break that
 * overlaps it, e.g. 'Holiday: Family Day (Mon, Feb 15)' and
 * 'School break (Ontario): Toronto District School Board March break, Mar 15 – 19'.
 */
export function windowSignalLines(hub: string, from: string, to: string): string[] {
  const lines: string[] = [];
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  for (const y of years) {
    for (const h of holidaysIn(y)) {
      if (h.dateKey < from || h.dateKey > to) continue;
      if (!holidaysOnFor(hub, h.dateKey).includes(h)) continue;
      const day = formatKey(h.dateKey, { weekday: 'short', month: 'short', day: 'numeric' });
      lines.push(t('calendar.signal.holidayOn', { name: holidayShortName(h), day }));
    }
  }
  const p = hubProvince(hub);
  if (p) {
    for (const b of schoolBreaksBetween(hub, from, to)) {
      lines.push(t('calendar.signal.breakOn', { province: provinceName(p), label: breakLabel(b), range: breakRange(b) }));
    }
  }
  return lines;
}
