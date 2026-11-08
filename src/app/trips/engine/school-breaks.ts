/**
 * School breaks for 2026-27 in the provinces with Air Canada hubs, hand-kept
 * like places/prep-rules.ts. Every row was read on an official page (the
 * ministry, or the largest board's own calendar) and carries its `source`
 * and `reviewed` date. Dates that could not be verified are left out; this
 * is why Quebec's school-board closure is the CSSDM's (its 21 Dec to 31 Dec
 * closure plus the 1 Jan holiday), and why no other Ontario, Quebec or BC
 * board is listed. BC is the Vancouver School Board's district calendar; Nova
 * Scotia is the Department's own 2026-27 notice. Re-verified 2026-11-08.
 *
 * The app only states the dates. It never calls a period busy or full, and
 * never changes a number because of one. Re-check the rows when `reviewed`
 * is over six months old, and add the next school year before July 2027.
 */
import { t, type MsgKey } from '../../i18n/t';
import { formatKey, monthOf } from '../../utils/time';

export type Province = 'ON' | 'QC' | 'BC' | 'AB' | 'NS' | 'MB';

/** Which kind of break: sets the wording ('March break', 'relâche', 'spring break'…). */
export type BreakKind = 'winter' | 'march' | 'spring' | 'relache' | 'fall';

export interface SchoolBreak {
  province: Province;
  /** The board or ministry whose calendar this is (a proper name, shown as is). */
  board: string;
  kind: BreakKind;
  /** First and last day of the break, inclusive (date keys). */
  from: string;
  to: string;
  source: string;
  reviewed: string;
}

/** Province of each hub's home market (the hub's own province). */
export const HUB_PROVINCE: Readonly<Record<string, Province>> = {
  YYZ: 'ON', YTZ: 'ON', YOW: 'ON', YUL: 'QC', YQB: 'QC', YVR: 'BC', YYC: 'AB', YEG: 'AB', YHZ: 'NS', YWG: 'MB',
};

const R = '2026-11-08';
const TDSB = 'Toronto District School Board'; // i18n-ignore
const CSSDM = 'CSSDM'; // i18n-ignore
const VSB = 'Vancouver School Board'; // i18n-ignore
const CBE = 'Calgary Board of Education'; // i18n-ignore
const NS = 'Nova Scotia'; // i18n-ignore
const WSD = 'Winnipeg School Division'; // i18n-ignore

const ON_SRC = 'https://www.tdsb.on.ca/Portals/0/docs/2026-27%20TDSB%20School%20Year%20Calendar%20Key%20Dates.pdf';
const QC_SRC = 'https://georges-vanier.cssdm.gouv.qc.ca/wp-content/uploads/sites/30/2026/07/Calendrier-scolaire-2026-2027.pdf';
const BC_SRC = 'https://media.vsb.bc.ca/media/Default/medialib/compact-vsb-calendar-2026-2027-final.20df0087560.pdf';
const AB_SRC = 'https://cbe.ab.ca/registration/calendars/Documents/2026-2027-Instructional-Calendar.pdf';
const NS_SRC = 'https://www.ednet.ns.ca/docs/schoolcalendar-2026-27-en.pdf';
const MB_SRC = 'https://media.winnipegsd.ca/media/Default/medialib/wsd-school-calendar-2026-27.21548436919.pdf';

export const SCHOOL_BREAKS: readonly SchoolBreak[] = [
  { province: 'ON', board: TDSB, kind: 'winter', from: '2026-12-21', to: '2027-01-01', source: ON_SRC, reviewed: R },
  { province: 'ON', board: TDSB, kind: 'march', from: '2027-03-15', to: '2027-03-19', source: ON_SRC, reviewed: R },
  { province: 'QC', board: CSSDM, kind: 'winter', from: '2026-12-21', to: '2027-01-01', source: QC_SRC, reviewed: R },
  { province: 'QC', board: CSSDM, kind: 'relache', from: '2027-03-01', to: '2027-03-05', source: QC_SRC, reviewed: R },
  { province: 'BC', board: VSB, kind: 'winter', from: '2026-12-21', to: '2026-12-31', source: BC_SRC, reviewed: R },
  { province: 'BC', board: VSB, kind: 'spring', from: '2027-03-15', to: '2027-03-25', source: BC_SRC, reviewed: R },
  { province: 'AB', board: CBE, kind: 'fall', from: '2026-11-11', to: '2026-11-15', source: AB_SRC, reviewed: R },
  { province: 'AB', board: CBE, kind: 'winter', from: '2026-12-19', to: '2027-01-03', source: AB_SRC, reviewed: R },
  { province: 'AB', board: CBE, kind: 'spring', from: '2027-03-20', to: '2027-03-29', source: AB_SRC, reviewed: R },
  { province: 'NS', board: NS, kind: 'winter', from: '2026-12-22', to: '2027-01-01', source: NS_SRC, reviewed: R },
  { province: 'NS', board: NS, kind: 'spring', from: '2027-03-08', to: '2027-03-12', source: NS_SRC, reviewed: R },
  { province: 'MB', board: WSD, kind: 'winter', from: '2026-12-21', to: '2027-01-01', source: MB_SRC, reviewed: R },
  { province: 'MB', board: WSD, kind: 'spring', from: '2027-03-29', to: '2027-04-02', source: MB_SRC, reviewed: R },
];

/** The hub's province, or null for an unknown code. */
export function hubProvince(hub: string): Province | null {
  return HUB_PROVINCE[hub] ?? null;
}

/** The breaks listed for the hub's province, by start date. */
export function schoolBreaksFor(hub: string): SchoolBreak[] {
  const p = hubProvince(hub);
  return p ? SCHOOL_BREAKS.filter(b => b.province === p).sort((a, b) => a.from.localeCompare(b.from)) : [];
}

/** The break that includes `dateKey` for the hub's province, or null. */
export function schoolBreakOn(hub: string, dateKey: string): SchoolBreak | null {
  return schoolBreaksFor(hub).find(b => b.from <= dateKey && dateKey <= b.to) ?? null;
}

/** Breaks for the hub's province that overlap [from, to]. */
export function schoolBreaksBetween(hub: string, from: string, to: string): SchoolBreak[] {
  return schoolBreaksFor(hub).filter(b => b.from <= to && b.to >= from);
}

/** 'Ontario' / 'Ontario' in the UI language. */
export function provinceName(p: Province): string {
  return t(`calendar.prov.${p}` as MsgKey);
}

/** 'Toronto District School Board March break', 'CSSDM relâche'. */
export function breakLabel(b: SchoolBreak): string {
  return t(`calendar.breakKind.${b.kind}` as MsgKey, { board: b.board });
}

/** 'Mar 15 – 19' / 'Dec 21 – Jan 1'. */
export function breakRange(b: SchoolBreak): string {
  const md = { month: 'short', day: 'numeric' } as const;
  const same = monthOf(b.from) === monthOf(b.to);
  return t(same ? 'format.range.sameMonth' : 'format.range.twoMonths', {
    start: formatKey(b.from, md), end: formatKey(b.to, md),
    startDay: formatKey(b.from, { day: 'numeric' }), endDay: formatKey(b.to, { day: 'numeric' }),
  });
}

export interface BreakSource { board: string; source: string; reviewed: string }

/** Each board/ministry calendar behind the shown breaks (all of the hub's province, or only those overlapping [from, to]). */
export function breakSources(hub: string, from?: string, to?: string): BreakSource[] {
  const list = from && to ? schoolBreaksBetween(hub, from, to) : schoolBreaksFor(hub);
  const seen = new Set<string>();
  const out: BreakSource[] = [];
  for (const b of list) {
    if (seen.has(b.source)) continue;
    seen.add(b.source);
    out.push({ board: b.board, source: b.source, reviewed: b.reviewed });
  }
  return out;
}
