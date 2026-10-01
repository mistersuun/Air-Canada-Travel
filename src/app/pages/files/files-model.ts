/**
 * Pure view model of the trip Files page (extras spec §6.2): the "Whole
 * trip" group, then one section per day that has a leg or an attachment,
 * the usage bar, the "Move to…" targets and each row's meta line.
 */
import { formatBytes, quotaText } from '../../files/quota';
import { FILES_ERROR_TEXT } from '../../files/model';
import type { Attachment, AttachmentScope, FilesError, UsageSummary } from '../../files/model';
import type { PassRecord } from '../../passes/model';
import type { IconName } from '../../components/shared/icons.component';
import type { Trip, TripLeg } from '../../trips/model';
import { addDays } from '../../utils/time';
import { MODE_ICON, dayLabel, flightNumbers, refsRoute } from '../trips/trips-model';

/** The leg's travel day (local at its origin). */
export function legDay(leg: TripLeg): string {
  if (leg.kind === 'flight') return leg.refs[0]?.dateKey ?? '';
  return leg.userTimes?.depDateKey ?? leg.dateKey;
}

/** 'AC834 YUL → MAD' or 'Madrid → Seville'. */
export function legTitle(leg: TripLeg): string {
  if (leg.kind === 'flight') return `${flightNumbers(leg.refs)} ${refsRoute(leg.refs)}`.trim();
  return `${leg.from.name} → ${leg.to.name}`;
}

/** The legs a file can go on: every leg except the ones a swap replaced. */
export function liveLegs(trip: Trip): TripLeg[] {
  return trip.legs.filter(l => l.status !== 'abandoned');
}

/** 'trip', 'leg:<id>', 'day:<key>' (the value of a "Move to…" option). */
export function scopeKey(s: AttachmentScope): string {
  if (s.kind === 'leg') return `leg:${s.legId}`;
  if (s.kind === 'day') return `day:${s.dateKey}`;
  return 'trip';
}

export function scopeFromKey(key: string): AttachmentScope {
  if (key.startsWith('leg:')) return { kind: 'leg', legId: key.slice(4) };
  if (key.startsWith('day:')) return { kind: 'day', dateKey: key.slice(4) };
  return { kind: 'trip' };
}

export interface ScopeOption { key: string; label: string; scope: AttachmentScope }

/** Whole trip, each leg ('AC834 YUL → MAD · Thu Oct 8'), then each day of the trip ('Sat Oct 10'). */
export function scopeOptions(trip: Trip): ScopeOption[] {
  const out: ScopeOption[] = [{ key: 'trip', label: 'Whole trip', scope: { kind: 'trip' } }];
  for (const l of liveLegs(trip)) {
    const scope: AttachmentScope = { kind: 'leg', legId: l.id };
    out.push({ key: scopeKey(scope), label: `${legTitle(l)} · ${dayLabel(legDay(l))}`, scope });
  }
  for (const d of tripDays(trip)) {
    const scope: AttachmentScope = { kind: 'day', dateKey: d };
    out.push({ key: scopeKey(scope), label: dayLabel(d), scope });
  }
  return out;
}

/** Every date from the outbound day to the home-by day (capped at 60 days). */
export function tripDays(trip: Trip): string[] {
  const out: string[] = [];
  let d = trip.outboundDate;
  for (let i = 0; i < 60 && d <= trip.homeBy.dateKey; i++, d = addDays(d, 1)) out.push(d);
  return out;
}

/** "Boarding passes · 2 passes · seat 34K, 34J" (never the PNR). */
export interface PassGroup { legId: string | null; firstId: string; count: number; meta: string }

export interface FileSection {
  /** 'trip' or the dateKey. */
  key: string;
  dateKey: string | null;
  /** 'Whole trip', 'Thu Oct 8 · AC834 YUL → MAD', 'Sat Oct 10'. */
  title: string;
  /** '3 photos', else null. */
  aside: string | null;
  passes: PassGroup[];
  /** Non-photo attachments: leg-scoped first, then day-scoped (each oldest first). */
  items: Attachment[];
  photos: Attachment[];
  /** The leg shown with "Add a pass or file for this leg" when the day has nothing attached. */
  emptyLeg: TripLeg | null;
  /** Where "+" in this section adds a file. */
  target: AttachmentScope;
}

export function passMeta(passes: readonly PassRecord[]): string {
  const n = passes.length;
  const seats = [...new Set(passes.map(p => p.seat).filter((s): s is string => !!s))];
  const count = n === 1 ? '1 pass' : `${n} passes`;
  return seats.length ? `${count} · seat ${seats.join(', ')}` : count;
}

function passGroups(passes: readonly PassRecord[], legIds: readonly string[]): PassGroup[] {
  const out: PassGroup[] = [];
  for (const id of legIds) {
    const own = passes.filter(p => p.legId === id);
    if (own.length) out.push({ legId: id, firstId: own[0].id, count: own.length, meta: passMeta(own) });
  }
  return out;
}

/**
 * The page's groups: "Whole trip" first (trip-scoped files, files of legs
 * that no longer exist, passes without a leg), then each day with a leg or
 * an attachment, in date order.
 */
export function fileSections(trip: Trip, attachments: readonly Attachment[], passes: readonly PassRecord[]): FileSection[] {
  const own = attachments.filter(a => a.tripId === trip.id);
  const ownPasses = passes.filter(p => p.tripId === trip.id);
  const legs = new Map(trip.legs.map(l => [l.id, l]));
  const live = liveLegs(trip);

  // Legs on each day: live legs, plus replaced legs that still hold something.
  const holds = (l: TripLeg) => own.some(a => a.scope.kind === 'leg' && a.scope.legId === l.id) || ownPasses.some(p => p.legId === l.id);
  const shownLegs = trip.legs.filter(l => live.includes(l) || holds(l));
  const legsByDay = new Map<string, TripLeg[]>();
  for (const l of shownLegs) {
    const d = legDay(l);
    if (!d) continue;
    legsByDay.set(d, [...(legsByDay.get(d) ?? []), l]);
  }

  const tripItems: Attachment[] = [];
  const dayItems = new Map<string, Attachment[]>();
  const legItems = new Map<string, Attachment[]>();
  for (const a of own) {
    const s = a.scope;
    if (s.kind === 'leg' && legs.has(s.legId) && legDay(legs.get(s.legId)!)) {
      legItems.set(s.legId, [...(legItems.get(s.legId) ?? []), a]);
    } else if (s.kind === 'day') {
      dayItems.set(s.dateKey, [...(dayItems.get(s.dateKey) ?? []), a]);
    } else {
      tripItems.push(a);
    }
  }

  const sections: FileSection[] = [];
  // Passes kept with the trip (no leg, or a leg that no longer exists) form one row.
  const loose = ownPasses.filter(p => !p.legId || !legs.has(p.legId) || !legDay(legs.get(p.legId)!));
  const tripPassGroups: PassGroup[] = loose.length ? [{ legId: null, firstId: loose[0].id, count: loose.length, meta: passMeta(loose) }] : [];
  sections.push(section('trip', null, 'Whole trip', tripPassGroups, tripItems, null, { kind: 'trip' }));

  const days = [...new Set([...legsByDay.keys(), ...dayItems.keys()])].sort();
  for (const d of days) {
    const dl = legsByDay.get(d) ?? [];
    const first = dl[0] ?? null;
    const title = first ? `${dayLabel(d)} · ${legTitle(first)}` : dayLabel(d);
    const items = [...dl.flatMap(l => legItems.get(l.id) ?? []), ...(dayItems.get(d) ?? [])];
    const groups = passGroups(ownPasses, dl.map(l => l.id));
    const target: AttachmentScope = first ? { kind: 'leg', legId: first.id } : { kind: 'day', dateKey: d };
    const empty = first && !items.length && !groups.length ? first : null;
    sections.push(section(d, d, title, groups, items, empty, target));
  }
  return sections;
}

function section(key: string, dateKey: string | null, title: string, passes: PassGroup[], all: Attachment[],
                 emptyLeg: TripLeg | null, target: AttachmentScope): FileSection {
  const photos = all.filter(a => a.kind === 'image');
  const items = all.filter(a => a.kind !== 'image');
  const aside = photos.length ? (photos.length === 1 ? '1 photo' : `${photos.length} photos`) : null;
  return { key, dateKey, title, aside, passes, items, photos, emptyLeg, target };
}

/** Number of photo tiles before the "+N" tile (3-up grid). */
export const PHOTO_TILES = 3;

/** The thumbnails to draw and the "+N" remainder. */
export function photoTiles<T>(photos: readonly T[]): { shown: T[]; more: number } {
  if (photos.length <= PHOTO_TILES) return { shown: [...photos], more: 0 };
  return { shown: photos.slice(0, PHOTO_TILES - 1), more: photos.length - (PHOTO_TILES - 1) };
}

/** 'PDF · 412 KB', 'Photo · 2.1 MB', 'ZIP · 3 KB'; note and address rows show their text. */
export function itemMeta(a: Attachment): string {
  if (a.kind === 'note' || a.kind === 'address') return a.text ?? '';
  const size = formatBytes(a.bytes);
  if (a.kind === 'pdf') return a.pages ? `PDF · ${a.pages} ${a.pages === 1 ? 'page' : 'pages'} · ${size}` : `PDF · ${size}`;
  if (a.kind === 'image') return `Photo · ${size}`;
  return `${fileTypeLabel(a.mime)} · ${size}`;
}

function fileTypeLabel(mime: string | null): string {
  const sub = (mime ?? '').split('/')[1] ?? '';
  const known: Record<string, string> = {
    'plain': 'Text', 'html': 'Web page', 'zip': 'ZIP', 'vnd.apple.pkpass': 'Wallet pass', 'calendar': 'Calendar',
    'msword': 'Word', 'vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  };
  return known[sub] ?? 'File';
}

export type IconTone = 'pass' | 'pdf' | 'photo' | 'note' | 'ground' | 'file';

/** The row's icon and tint: PDFs red, photos teal, notes and addresses amber, tickets on a train/bus leg in the leg's mode. */
export function itemIcon(a: Attachment, trip: Trip | null): { name: IconName; tone: IconTone } {
  if (a.kind === 'note') return { name: 'note', tone: 'note' };
  if (a.kind === 'address') return { name: 'pin', tone: 'note' };
  if (a.kind === 'image') return { name: 'image', tone: 'photo' };
  const leg = a.scope.kind === 'leg' && trip ? trip.legs.find(l => l.id === (a.scope as { legId: string }).legId) : null;
  if (leg?.kind === 'ground' && (leg.mode === 'train' || leg.mode === 'bus' || leg.mode === 'ferry') && /ticket|train|bus|ferry|boarding/i.test(a.title)) {
    return { name: MODE_ICON[leg.mode], tone: 'ground' };
  }
  if (a.kind === 'pdf') return { name: 'doc', tone: 'pdf' };
  return { name: 'file', tone: 'file' };
}

export type UsageCat = 'passes' | 'pdfs' | 'photos' | 'notes' | 'other';
export interface UsageBar { cat: UsageCat; label: string; text: string; pct: number }

const CAT_LABEL: Record<UsageCat, string> = { passes: 'Passes', pdfs: 'PDFs', photos: 'Photos', notes: 'Notes', other: 'Other' };

/**
 * The stacked bar and its legend. Every category present is listed with its
 * size ("Notes" have no size); notes get a thin sliver so they show.
 */
export function usageBars(u: UsageSummary, present: Record<UsageCat, number>): UsageBar[] {
  const cats: UsageCat[] = ['passes', 'pdfs', 'photos', 'notes', 'other'];
  const shown = cats.filter(c => present[c] > 0);
  const total = u.bytes;
  return shown.map(c => {
    const bytes = u.byCategory[c];
    const pct = total > 0 ? (bytes / total) * 100 : 0;
    return {
      cat: c,
      label: CAT_LABEL[c],
      text: c === 'notes' ? CAT_LABEL[c] : `${CAT_LABEL[c]} ${formatBytes(bytes)}`,
      pct: c === 'notes' ? 2 : Math.max(pct, bytes > 0 ? 1 : 0),
    };
  });
}

/** Item counts per category, for the legend. */
export function categoryCounts(attachments: readonly Attachment[], passCount: number): Record<UsageCat, number> {
  const n: Record<UsageCat, number> = { passes: passCount, pdfs: 0, photos: 0, notes: 0, other: 0 };
  for (const a of attachments) {
    if (a.kind === 'pdf') n.pdfs++;
    else if (a.kind === 'image') n.photos++;
    else if (a.kind === 'note' || a.kind === 'address') n.notes++;
    else n.other++;
  }
  return n;
}

/** '9 files · 14.2 MB', '1 file · 0 B', 'No files yet'. */
export function usageTitle(count: number, bytes: number): string {
  if (!count) return 'No files yet';
  return `${count} ${count === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`;
}

/** Bytes of these passes' images, each stored image counted once. */
export function passImageBytes(passes: readonly PassRecord[], size: (blobId: string) => number): number {
  const ids = new Set(passes.map(p => p.imageBlobId).filter((x): x is string => !!x));
  let n = 0;
  for (const id of ids) n += size(id);
  return n;
}

/** iPhone or iPad (iPadOS reports a Mac with touch). */
export function isIos(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | null | undefined): boolean {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

/** The keep-your-files note: null when the browser keeps them (persisted, or installed). */
export function persistNote(info: { persisted: boolean | null; installed: boolean } | null, ios: boolean): string | null {
  if (!info || info.persisted !== false || info.installed) return null;
  return ios ? 'On iPhone, add Routes to your Home Screen so these files are kept.' : 'Your browser may clear these if space runs low.';
}

/** The scroll target id of a section. */
export function sectionId(key: string): string {
  return `files-${key}`;
}

/** The copy for a failed save; the quota copy names the file size. */
export function filesErrorText(error: FilesError, bytes = 0): string {
  return error === 'quota' && bytes > 0 ? quotaText(bytes) : FILES_ERROR_TEXT[error];
}
