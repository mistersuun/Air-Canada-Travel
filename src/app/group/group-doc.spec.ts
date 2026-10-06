import { describe, expect, it } from 'vitest';
import { SEVILLE_TRIPS_FILE } from '../trips/testing/seville-fixture';
import { type GroupDoc, groupExpiry, memberList, mergeGroupDocs, parseGroupDoc, planLabelSuggestions, serializeGroupDoc, tripLastDate } from './group-doc';

const T = (n: number) => new Date(Date.parse('2026-10-06T12:00:00Z') + n * 60_000).toISOString();
const doc = (over: Partial<GroupDoc> = {}): GroupDoc => ({ s: 1, plan: 'zabc', planAt: T(0), members: {}, meetup: null, ...over });
const m = (name: string, at: number, planLabel = '') => ({ name, planLabel, arrival: null, updatedAt: T(at) });
const trip = SEVILLE_TRIPS_FILE.trips[0];

describe('merge of member statuses', () => {
  it('takes the later updatedAt per member and keeps members only one side has', () => {
    const local = doc({ members: { aaaaaa: m('Ana', 5, 'On AC834'), bbbbbb: m('Ben', 1, 'old') } });
    const remote = doc({ members: { bbbbbb: m('Ben', 3, 'Bus to YUL'), cccccc: m('Cy', 2) } });
    const out = mergeGroupDocs(local, remote);
    expect(out.members['aaaaaa'].planLabel).toBe('On AC834');
    expect(out.members['bbbbbb'].planLabel).toBe('Bus to YUL');
    expect(Object.keys(out.members).sort()).toEqual(['aaaaaa', 'bbbbbb', 'cccccc']);
  });
  it('ties keep the remote entry; the meet-up and plan take the later stamp', () => {
    const local = doc({ plan: 'zlocal', planAt: T(9), members: { aaaaaa: m('Ana', 2, 'mine') }, meetup: { text: 'Gate 5', updatedAt: T(4) } });
    const remote = doc({ plan: 'zremote', planAt: T(1), members: { aaaaaa: m('Ana', 2, 'theirs') }, meetup: { text: 'Cafe', updatedAt: T(3) } });
    const out = mergeGroupDocs(local, remote);
    expect(out.members['aaaaaa'].planLabel).toBe('theirs');
    expect(out.meetup?.text).toBe('Gate 5');
    expect(out.plan).toBe('zlocal');
    expect(mergeGroupDocs(remote, local).plan).toBe('zlocal');
  });
});

describe('doc parsing', () => {
  it('round-trips, and clamps or drops bad members', () => {
    const d = doc({ members: { aaaaaa: m('Ana', 1) }, meetup: { text: 'x'.repeat(80), updatedAt: T(1) } });
    expect(parseGroupDoc(serializeGroupDoc(d))).toEqual(d);
    const dirty = JSON.stringify({
      ...d,
      members: {
        aaaaaa: { name: 'N'.repeat(60), planLabel: 'p\u0000q', arrival: 'nope', updatedAt: T(1), pnr: 'ABC123', listPosition: 4 },
        '../x': m('Bad id', 1), bbbbbb: { name: '', updatedAt: T(1) },
      },
      meetup: { text: 'y'.repeat(200), updatedAt: T(1) },
    });
    const out = parseGroupDoc(dirty)!;
    expect(Object.keys(out.members)).toEqual(['aaaaaa']);
    expect(out.members['aaaaaa']).toEqual({ name: 'N'.repeat(24), planLabel: 'p q', arrival: null, updatedAt: T(1) });
    expect(out.meetup!.text).toHaveLength(80);
  });
  it('rejects non-docs', () => {
    for (const bad of ['', 'x', '[]', '{"s":2}', '{"s":1}', '{"s":1,"plan":""}']) expect(parseGroupDoc(bad)).toBeNull();
  });
  it('lists me first, then by name', () => {
    const d = doc({ members: { aaaaaa: m('Zed', 1), bbbbbb: m('Ana', 1), cccccc: m('Me', 1) } });
    expect(memberList(d, 'cccccc').map(x => x.status.name)).toEqual(['Me', 'Ana', 'Zed']);
  });
});

describe('trip helpers', () => {
  it('last date is the latest leg date; expiry is +30 days, within 7..90 days of now', () => {
    const last = tripLastDate(trip);
    expect(last).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = Date.parse(`${last}T00:00:00Z`) - 5 * 86_400_000;
    expect(Date.parse(groupExpiry(trip, now))).toBe(Date.parse(`${last}T23:59:59Z`) + 30 * 86_400_000);
    expect(Date.parse(groupExpiry(trip, now - 200 * 86_400_000))).toBe(now - 200 * 86_400_000 + 90 * 86_400_000);
    const late = Date.parse(`${last}T00:00:00Z`) + 80 * 86_400_000;
    expect(Date.parse(groupExpiry(trip, late))).toBe(late + 7 * 86_400_000);
  });
  it('suggests "On <flight>" labels', () => {
    expect(planLabelSuggestions(trip).every(s => /^(On |Plan B: )[A-Z0-9]+/.test(s))).toBe(true);
  });
});
