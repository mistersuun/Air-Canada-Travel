/**
 * The decrypted group document: the trip share payload (share-codec drops the
 * prep state, pending changes, offline/calendar marks and "usual" items; the
 * trip has no PNR or standby list position field) plus a small status map per
 * member and a meet-up point. Free text a person wrote to themselves is
 * blanked by `forGroup` before encoding: every leg's note and "If we split
 * up". Load notes are not included either.
 */
import { LEG_STATUSES, type LegStatus, type Trip } from '../trips/model';

export const MAX_NAME = 24;
export const MAX_PLAN_LABEL = 40;
export const MAX_MEETUP = 80;
export const MAX_MEMBERS = 30;

export interface MemberStatus {
  name: string;
  /** Free text: 'On AC834', 'Plan B: AC836', 'Bus to YUL'. */
  planLabel: string;
  /** Expected arrival, ISO instant, or null. */
  arrival: string | null;
  /** My own status per flight leg id ('listed', 'boarded'…); absent on entries from older versions. */
  legs?: Record<string, LegStatus>;
  updatedAt: string;
}

export interface Meetup { text: string; updatedAt: string }

export interface GroupDoc {
  s: 1;
  /** share-codec payload of the trip (`z…` / `j…`). */
  plan: string;
  /** When the owner last replaced the plan. */
  planAt: string;
  members: Record<string, MemberStatus>;
  meetup: Meetup | null;
}

const MEMBER_ID_RE = /^[A-Za-z0-9_-]{6,24}$/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

export function sanitizeMember(v: unknown): MemberStatus | null {
  if (!isRec(v)) return null;
  const name = clean(v['name'], MAX_NAME);
  const updatedAt = isoOrNull(v['updatedAt']);
  if (!name || !updatedAt) return null;
  const legs = sanitizeLegs(v['legs']);
  return { name, planLabel: clean(v['planLabel'], MAX_PLAN_LABEL), arrival: isoOrNull(v['arrival']), ...(legs ? { legs } : {}), updatedAt };
}

const MAX_LEG_STATUSES = 12;
function sanitizeLegs(v: unknown): Record<string, LegStatus> | null {
  if (!isRec(v)) return null;
  const out: Record<string, LegStatus> = {};
  for (const [id, st] of Object.entries(v).slice(0, MAX_LEG_STATUSES)) {
    if (/^[A-Za-z0-9_-]{1,40}$/.test(id) && typeof st === 'string' && (LEG_STATUSES as readonly string[]).includes(st)) out[id] = st as LegStatus;
  }
  return Object.keys(out).length ? out : null;
}

/** Parses decrypted JSON into a doc, dropping anything malformed. Null when unusable. */
export function parseGroupDoc(text: string): GroupDoc | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!isRec(raw) || raw['s'] !== 1 || typeof raw['plan'] !== 'string' || !raw['plan']) return null;
    const planAt = isoOrNull(raw['planAt']) ?? new Date(0).toISOString();
    const members: Record<string, MemberStatus> = {};
    if (isRec(raw['members'])) {
      for (const [id, m] of Object.entries(raw['members'])) {
        const ms = MEMBER_ID_RE.test(id) ? sanitizeMember(m) : null;
        if (ms) members[id] = ms;
      }
    }
    let meetup: Meetup | null = null;
    if (isRec(raw['meetup'])) {
      const at = isoOrNull(raw['meetup']['updatedAt']);
      const t = clean(raw['meetup']['text'], MAX_MEETUP);
      if (at) meetup = { text: t, updatedAt: at };
    }
    return { s: 1, plan: raw['plan'], planAt, members: capMembers(members), meetup };
  } catch {
    return null;
  }
}

export const serializeGroupDoc = (d: GroupDoc): string => JSON.stringify(d);

/** Keeps the MAX_MEMBERS most recently updated entries (stalest evicted). */
export function capMembers(members: Record<string, MemberStatus>): Record<string, MemberStatus> {
  const e = Object.entries(members);
  if (e.length <= MAX_MEMBERS) return members;
  return Object.fromEntries(e.sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt)).slice(0, MAX_MEMBERS));
}

/** True when `memberId` would be a new member of a doc that already has MAX_MEMBERS. */
export const groupIsFull = (doc: GroupDoc, memberId: string): boolean => !(memberId in doc.members) && Object.keys(doc.members).length >= MAX_MEMBERS;

/** The trip as shared with a group: every leg's free-text note and the split note are blanked. */
export function forGroup(trip: Trip): Trip {
  return { ...trip, party: { ...trip.party, splitNote: '' }, legs: trip.legs.map(l => ({ ...l, note: '' })) };
}

const newer = (a: string, b: string): boolean => Date.parse(a) > Date.parse(b);

/**
 * Merges two versions of a doc (e.g. mine, and what the server has after a 409):
 * every member entry and the meet-up point take the later updatedAt, the plan
 * takes the later planAt. Ties keep `remote` (what everyone else already sees).
 */
export function mergeGroupDocs(local: GroupDoc, remote: GroupDoc): GroupDoc {
  const members: Record<string, MemberStatus> = { ...remote.members };
  for (const [id, m] of Object.entries(local.members)) {
    const r = members[id];
    if (!r || newer(m.updatedAt, r.updatedAt)) members[id] = m;
  }
  const limited = capMembers(members);
  const useLocalPlan = newer(local.planAt, remote.planAt);
  let meetup = remote.meetup;
  if (local.meetup && (!meetup || newer(local.meetup.updatedAt, meetup.updatedAt))) meetup = local.meetup;
  return { s: 1, plan: useLocalPlan ? local.plan : remote.plan, planAt: useLocalPlan ? local.planAt : remote.planAt, members: limited, meetup };
}

/** Members ordered: me first, then by name. */
export function memberList(doc: GroupDoc, me: string | null): { id: string; me: boolean; status: MemberStatus }[] {
  return Object.entries(doc.members)
    .map(([id, status]) => ({ id, me: id === me, status }))
    .sort((a, b) => Number(b.me) - Number(a.me) || a.status.name.localeCompare(b.status.name));
}

/** Local date ('YYYY-MM-DD') of the trip's last leg, falling back to its home-by date. */
export function tripLastDate(trip: Trip): string {
  let last = trip.homeBy.dateKey;
  for (const l of trip.legs) {
    const days = l.kind === 'flight' ? l.refs.map(r => r.arrDateKey) : [l.dateKey];
    for (const d of days) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > last) last = d;
  }
  return last;
}

/** Default expiry: 30 days after the trip's last date, at least a week from now, at most 90 days from now. */
export function groupExpiry(trip: Trip, nowMs: number): string {
  const day = 86_400_000;
  const last = Date.parse(`${tripLastDate(trip)}T23:59:59Z`);
  const want = Number.isFinite(last) ? last + 30 * day : nowMs + 30 * day;
  return new Date(Math.min(Math.max(want, nowMs + 7 * day), nowMs + 90 * day)).toISOString();
}

/** Suggested status labels from the plan: 'On AC834', 'Plan B: AC836'. */
export function planLabelSuggestions(trip: Trip): string[] {
  const out: string[] = [];
  for (const l of trip.legs) {
    if (l.kind !== 'flight') continue;
    const f = l.refs[0]?.flightNumber;
    if (f) out.push(`On ${f}`);
    for (const a of l.alternates) {
      const af = a.refs[0]?.flightNumber;
      if (af) out.push(`Plan B: ${af}`);
    }
  }
  return [...new Set(out)].slice(0, 8);
}

// ── Friends on each leg ─────────────────────────────────────────────────────

/** Statuses a friend can set on a leg from the group page. */
export const MEMBER_LEG_STATUSES: readonly LegStatus[] = ['planned', 'listed', 'checkedIn', 'boarded', 'notBoarded'];

/** Up to two initials of a nickname ('Alex' -> 'A', 'Sam Lee' -> 'SL'). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? '?')][0] ?? '?';
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
  return (first + second).toUpperCase();
}

/** A hue (0..359) derived from the name, so the same nickname always gets the same colour. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

export interface LegFriend { id: string; me: boolean; name: string; status: LegStatus }

/** Who has said something about this leg: me first, then by name. Members who set nothing are left out. */
export function friendsOnLeg(doc: GroupDoc, legId: string, me: string | null): LegFriend[] {
  return memberList(doc, me)
    .filter(m => m.status.legs?.[legId])
    .map(m => ({ id: m.id, me: m.me, name: m.status.name, status: m.status.legs![legId] }));
}

/** True when two or more members are in the group and every one of them is boarded on this leg. */
export function everyoneBoarded(doc: GroupDoc, legId: string): boolean {
  const all = Object.values(doc.members);
  return all.length >= 2 && all.every(m => m.legs?.[legId] === 'boarded');
}
