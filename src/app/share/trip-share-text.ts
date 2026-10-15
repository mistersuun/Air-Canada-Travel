/**
 * Share itinerary (extras spec §6.4): the trip as plain text and as the rows
 * of the image card. Pure, so every wording rule has a spec.
 *
 * Only the plan goes out: legs, local times, each with its source label
 * (scheduled / estimated / saved by me / unknown), optionally the "If we
 * split up" note and the backups. Leg notes, booking codes, boarding passes
 * and files are never read here (share-boundary.spec.ts checks the imports).
 */
import { groundLabel } from '../pages/trips/trips-model';
import { type MsgKey, t } from '../i18n/t';
import { aboutDuration } from '../places/ground';
import type { TimeFormat } from '../state/prefs.service';
import type { Alternate, FlightLeg, FlightRef, GroundLeg, GroundMode, Trip, TripLeg } from '../trips/model';
import { diffDays, formatClock, formatKey, weekdayIndex, weekdayShort } from '../utils/time';

export interface ShareOptions { includeSplitNote: boolean; includeBackups: boolean; fmt: TimeFormat }

export interface ShareRow {
  day: string;          // 'Thu 8'
  dayShort: string;     // 'Thu'
  title: string;        // 'AC834 YUL → MAD', 'Train to Seville'
  label: string;        // 'Scheduled · standby', 'Estimated · about 2h40', 'Saved by you'
  time: string | null;  // '17:55'; null for an estimated ground leg (the label carries the duration)
  /** What the card draws beside the row. */
  mode: 'flight' | GroundMode;
  /** The label's tone on the card. */
  tone: 'scheduled' | 'estimated' | 'saved' | 'unknown';
  /** 'Backups: AC822 BCN 18:35 · AC812 LIS 21:45', only with includeBackups. */
  backups: string | null;
}

/** The English footer (an identity for specs); the text and card use shareFooter(). */
export const SHARE_FOOTER = 'Times are local. A standby plan, not a booking.'; // i18n-ignore

/** The footer line in the UI language. */
export function shareFooter(): string {
  return t('share.footer');
}

/** 'train' / 'autobus': the ground mode as a word inside a sentence. */
const modeWord = (m: GroundMode) => t(`share.mode.${m}` as MsgKey);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Statuses of replaced legs, left out of the share. */
const REPLACED = new Set(['notBoarded', 'abandoned']);

/** The legs that are still the plan, in trip order. */
export function sharedLegs(trip: Trip): TripLeg[] {
  return trip.legs.filter(l => !REPLACED.has(l.status));
}

const dayShort = (key: string) => weekdayShort(weekdayIndex(key));
const dayNum = (key: string) => `${dayShort(key)} ${Number(key.slice(8, 10))}`;

/** 'Thu Oct 8'. */
export function shareDay(key: string): string {
  return `${dayShort(key)} ${formatKey(key, { month: 'short', day: 'numeric' })}`;
}

/** 'Thu Oct 8 → Tue Oct 13'. */
export function shareDates(trip: Trip): string {
  return `${shareDay(trip.outboundDate)} → ${shareDay(trip.homeBy.dateKey)}`;
}

/** 'Thu Oct 8 → Tue Oct 13 · 2 travellers'. */
export function shareSubtitle(trip: Trip): string {
  const n = Math.max(1, trip.party.count);
  return `${shareDates(trip)} · ${t('share.travellers', { n })}`;
}

/** '+1' / '' for an arrival a day later (ASCII, so it survives any chat app). */
function plusDays(from: string, to: string): string {
  const d = diffDays(from, to);
  return d > 0 ? `+${d}` : d < 0 ? `${d}` : '';
}

function flightTag(leg: FlightLeg): string {
  return leg.provenance === 'unknown' ? t('share.tag.unknown') : t('share.tag.scheduled');
}

/** 'Thu AC834 YUL 17:55 → MAD 06:50+1 (scheduled, standby)'. */
function flightLine(leg: FlightLeg, r: FlightRef, fmt: TimeFormat): string {
  return t('share.flightLine', {
    day: dayShort(r.dateKey), flight: r.flightNumber, origin: r.origin, dep: formatClock(r.depLocal, fmt), dest: r.dest,
    arr: formatClock(r.arrLocal, fmt), plus: plusDays(r.dateKey, r.arrDateKey), tag: flightTag(leg),
  });
}

function groundDay(leg: GroundLeg): string {
  return leg.userTimes?.depDateKey ?? leg.dateKey;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The duration inside a ride label in either language: 'Train about 2h40' → '2h40', 'Train environ 45 min' → '45 min'. */
function labelDuration(label: string): string {
  return /\d+[\s\u00a0]?h(?:[\s\u00a0]?\d{2})?|\d+[\s\u00a0]?min/.exec(label)?.[0] ?? '';
}

/** 'train about 2h40', 'bus about 8h door to door', 'bus'. */
function groundEstimateText(leg: GroundLeg): string {
  const mode = modeWord(leg.mode);
  // An estimated leg with minutes always has a label (groundRide only says "unknown" without them).
  if (leg.provenance === 'estimated' && leg.estMinutes !== null) return lower(groundLabel(leg));
  return leg.estMinutes !== null ? t('share.aboutDoor', { mode, dur: aboutDuration(leg.estMinutes) }) : mode;
}

/** 'Fri Madrid → Seville, train about 2h40 (estimated)', 'Mon Seville → Lisbon, bus 09:00 → 14:45 (saved by me)'. */
function groundLine(leg: GroundLeg, fmt: TimeFormat): string {
  const head = `${dayShort(groundDay(leg))} ${leg.from.name} → ${leg.to.name}`;
  if (leg.provenance === 'saved' && leg.userTimes) {
    const ut = leg.userTimes;
    return `${head}, ${modeWord(leg.mode)} ${formatClock(ut.depLocal, fmt)} → `
      + `${formatClock(ut.arrLocal, fmt)}${plusDays(ut.depDateKey, ut.arrDateKey)} (${t('share.tag.saved')})`;
  }
  return `${head}, ${groundEstimateText(leg)} (${leg.provenance === 'estimated' ? t('share.tag.estimated') : t('share.tag.unknown')})`;
}

/** 'AC822 to BCN 18:35' for one backup itinerary. */
function backupText(a: Alternate, fmt: TimeFormat, sep: ' to ' | ' '): string {
  const first = a.refs[0];
  const last = a.refs[a.refs.length - 1];
  if (!first || !last) return '';
  const nums = a.refs.map(r => r.flightNumber).join(' + ');
  const time = formatClock(first.depLocal, fmt);
  return sep === ' to ' ? t('share.backupTo', { nums, dest: last.dest, time }) : `${nums} ${last.dest} ${time}`;
}

/** Flight legs with backups, for the "Backups for Thu: …" lines and the switch subtitle. */
function legsWithBackups(trip: Trip): FlightLeg[] {
  return sharedLegs(trip).filter((l): l is FlightLeg => l.kind === 'flight' && l.alternates.length > 0 && l.refs.length > 0);
}

export function hasBackups(trip: Trip): boolean {
  return legsWithBackups(trip).length > 0;
}

/** Switch subtitle: 'AC822 BCN, AC812 LIS for Thu'. Empty when there are none. */
export function backupsSummary(trip: Trip): string {
  return legsWithBackups(trip)
    .map(l => t('share.forDay', {
      list: l.alternates.map(a => {
        const last = a.refs[a.refs.length - 1];
        return last ? `${a.refs.map(r => r.flightNumber).join(' + ')} ${last.dest}` : '';
      }).filter(Boolean).join(', '),
      day: dayShort(l.refs[0].dateKey),
    }))
    .join('; ');
}

/** The trip's "If we split up" note, trimmed; null when empty. */
export function splitNote(trip: Trip): string | null {
  const n = trip.party.splitNote.replace(/\s+/g, ' ').trim();
  return n || null;
}

function rowFlight(leg: FlightLeg, r: FlightRef, opts: ShareOptions, first: boolean): ShareRow {
  const unknown = leg.provenance === 'unknown';
  const backups = opts.includeBackups && first && leg.alternates.length
    ? t('share.backupsRow', { list: leg.alternates.map(a => backupText(a, opts.fmt, ' ')).filter(Boolean).join(' · ') })
    : null;
  return {
    day: dayNum(r.dateKey),
    dayShort: dayShort(r.dateKey),
    title: `${r.flightNumber} ${r.origin} → ${r.dest}`,
    label: unknown ? t('share.row.unknownStandby') : t('share.row.scheduledStandby'),
    time: formatClock(r.depLocal, opts.fmt),
    mode: 'flight',
    tone: unknown ? 'unknown' : 'scheduled',
    backups,
  };
}

function rowGround(leg: GroundLeg, opts: ShareOptions): ShareRow {
  const day = groundDay(leg);
  const base = {
    day: dayNum(day),
    dayShort: dayShort(day),
    title: t('share.row.title', { mode: cap(modeWord(leg.mode)), place: leg.to.name }),
    mode: leg.mode,
    backups: null,
  };
  if (leg.provenance === 'saved' && leg.userTimes) {
    return { ...base, label: t('share.row.saved'), time: formatClock(leg.userTimes.depLocal, opts.fmt), tone: 'saved' };
  }
  if (leg.provenance === 'estimated' && leg.estMinutes !== null) {
    return { ...base, label: t('share.row.estimatedAbout', { dur: labelDuration(groundLabel(leg)) || aboutDuration(leg.estMinutes) }), time: null, tone: 'estimated' };
  }
  return { ...base, label: t('share.row.unknown'), time: null, tone: 'unknown' };
}

/** The card's timeline: one row per flight segment and per ground leg. */
export function tripShareRows(trip: Trip, opts: ShareOptions): ShareRow[] {
  const rows: ShareRow[] = [];
  for (const leg of sharedLegs(trip)) {
    if (leg.kind === 'flight') leg.refs.forEach((r, i) => rows.push(rowFlight(leg, r, opts, i === 0)));
    else rows.push(rowGround(leg, opts));
  }
  return rows;
}

/**
 * The trip as plain text:
 *
 *   Seville · Thu Oct 8 → Tue Oct 13
 *   Thu AC834 YUL 17:55 → MAD 06:50+1 (scheduled, standby)
 *   …
 *   If we split up: <note>                      (optional)
 *   Backups for Thu: AC822 to BCN 18:35, …      (optional)
 *   Times are local. A standby plan, not a booking.
 */
export function tripShareText(trip: Trip, opts: ShareOptions): string {
  const lines = [`${trip.goal.name} · ${shareDates(trip)}`];
  for (const leg of sharedLegs(trip)) {
    if (leg.kind === 'flight') for (const r of leg.refs) lines.push(flightLine(leg, r, opts.fmt));
    else lines.push(groundLine(leg, opts.fmt));
  }
  const note = splitNote(trip);
  if (opts.includeSplitNote && note) lines.push(t('share.splitUp', { note }));
  if (opts.includeBackups) {
    for (const leg of legsWithBackups(trip)) {
      const list = leg.alternates.map(a => backupText(a, opts.fmt, ' to ')).filter(Boolean).join(', ');
      if (list) lines.push(t('share.backupsFor', { day: dayShort(leg.refs[0].dateKey), list }));
    }
  }
  lines.push(shareFooter());
  return lines.join('\n');
}

/** 'routes-seville-2026-10-08.png'. */
export function shareFilename(trip: Trip): string {
  const slug = trip.goal.name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trip';
  return `routes-${slug}-${trip.outboundDate}.png`;
}
