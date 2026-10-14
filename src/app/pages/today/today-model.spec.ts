import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import type { LoadNote, Outcome, Trip } from '../../trips/model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import {
  bannerText, groundTodayView, leavesLabel, midTripView, noteText, plannedNights, recoverLeg, recoverView, resolveGroundToday,
  resolveToday, statusForTick, todayView, tripUnderWay, upcomingTripView,
} from './today-model';

const AT_1640 = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
const AT_1805 = toUtcMs('2026-10-08', '18:05', 'America/Toronto');
const CONNECT = { minConnect: 60 };

function note(text: string, hhmm: string, extra: Partial<LoadNote> = {}): LoadNote {
  return {
    id: `n${hhmm}`, flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08',
    open: null, listed: null, text, at: new Date(toUtcMs('2026-10-08', hhmm, 'America/Toronto')).toISOString(), ...extra,
  };
}

function notBoarded(t: Trip): Trip {
  return { ...t, legs: t.legs.map(l => (l.id === SEVILLE_IDS.outbound ? { ...l, status: 'notBoarded' as const } : l)) };
}

describe('today model (Seville fixture)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('formats departures relative to now', () => {
    expect(leavesLabel(AT_1640 + 75 * 60_000, AT_1640)).toBe('leaves in 1h15');
    expect(leavesLabel(AT_1640 + (170 * 60 + 53) * 60_000, AT_1640)).toBe('leaves in 7 days');
    expect(leavesLabel(AT_1640 + 47 * 60 * 60_000, AT_1640)).toBe('leaves in 47h');
    expect(leavesLabel(AT_1640, AT_1640)).toBe('leaves now');
    expect(leavesLabel(AT_1640 - 25 * 60_000, AT_1640)).toBe('left 25m ago');
  });

  it('writes only the parts of a note that were filled in', () => {
    expect(noteText(note('Gate 52, 9 on the list', '16:20'))).toBe('Gate 52, 9 on the list');
    expect(noteText(note('', '16:20', { open: 14, listed: 9 }))).toBe('14 open, 9 listed');
  });

  it('banner: the travel day at 16:40, nothing the day before', () => {
    expect(bannerText([sevilleTrip()], AT_1640, '24h')).toEqual({ title: 'Today · Montréal → Madrid', detail: 'AC834 17:55 YUL time · Listed' });
    expect(bannerText([sevilleTrip()], AT_1640 - 86_400_000, '24h')).toBeNull();
    expect(bannerText([{ ...sevilleTrip(), archived: true }], AT_1640, '24h')).toBeNull();
  });

  it('resolves the travel day, an explicit trip, and nothing on other days', () => {
    const trips = [sevilleTrip()];
    expect(resolveToday(trips, AT_1640)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound });
    expect(resolveToday(trips, AT_1640, SEVILLE_IDS.trip)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound });
    expect(resolveToday(trips, AT_1640, 'nope')).toBeNull();
    expect(resolveToday(trips, AT_1640 - 3 * 86_400_000)).toBeNull();
    expect(resolveToday(trips, AT_1640, SEVILLE_IDS.trip, SEVILLE_IDS.ret)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.ret });
    expect(resolveToday(trips, AT_1640, SEVILLE_IDS.trip, SEVILLE_IDS.train)).toBeNull();
  });

  it('an Unknown leg on a route the network lists says times are not in our data', () => {
    const trip = sevilleTrip();
    const out = trip.legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    if (out.kind === 'flight') out.provenance = 'unknown';
    const view = () => todayView({ trip, legId: SEVILLE_IDS.outbound, nowMs: AT_1640, notes: [], outcomes: [], connect: CONNECT, fmt: '24h' })!;
    expect(view().sub).toBe('AC834 · A330-300 · leaves in 1h15');
    setRouteNetworkSource({ ...ROUTE_NETWORK_FIXTURE, routes: { 'YUL-MAD': ['A', 0, null, null, null] } });
    try {
      expect(view().sub).toBe('AC834 · A330-300 · leaves in 1h15 · flies this route · times not in our data');
      expect(view().provenance).toBe('unknown');
    } finally {
      resetRouteNetworkSource();
    }
  });

  it('g4: 17:55, Listed, leaves in 1h15, the latest note, left to do and the backup', () => {
    const v = todayView({
      trip: sevilleTrip(), legId: SEVILLE_IDS.outbound, nowMs: AT_1640,
      notes: [note('Gate 50', '15:10'), note('Gate 52, 9 on the list', '16:20'), note('Other flight', '16:30', { flightNumber: 'AC822', dest: 'BCN' })],
      outcomes: [], connect: CONNECT, fmt: '24h',
    })!;
    expect(v.eyebrow).toBe('Today · Thu Oct 8 · at YUL');
    expect(v.title).toBe('Montréal → Madrid');
    expect(v.time).toBe('17:55');
    expect(v.status).toBe('listed');
    expect(v.sub).toBe('AC834 · A330-300 · leaves in 1h15');
    expect(v.note).toEqual({ time: '16:20 YUL time', text: 'Gate 52, 9 on the list' });
    expect(v.left.map(i => [i.title, i.done, i.detail])).toEqual([
      ['Listed for AC834', true, null],
      ['Check in for AC834', false, "Before your pass's cutoff"],
    ]);
    expect(v.backup).toEqual({ title: 'Backup tonight: AC812 to Lisbon 21:45', detail: "Still possible if you don't clear AC834" });
    expect(v.final).toBe(false);
  });

  it('a final leg has no buttons, no to-dos and no backup', () => {
    const v = todayView({
      trip: notBoarded(sevilleTrip()), legId: SEVILLE_IDS.outbound, nowMs: AT_1805, notes: [], outcomes: [], connect: CONNECT, fmt: '24h',
    })!;
    expect(v.final).toBe(true);
    expect(v.left).toEqual([]);
    expect(v.backup).toBeNull();
    expect(v.sub).toBe('AC834 · A330-300');
  });

  it('12h clock', () => {
    const v = todayView({ trip: sevilleTrip(), legId: SEVILLE_IDS.outbound, nowMs: AT_1640, notes: [], outcomes: [], connect: CONNECT, fmt: '12h' })!;
    expect(v.time).toBe('5:55 PM');
  });

  it('a one-stop leg moves to its second segment once the first is recorded', () => {
    const trip = sevilleTrip();
    const out = trip.legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    if (out.kind !== 'flight') throw new Error('fixture');
    out.refs = [
      { flightNumber: 'AC489', origin: 'YUL', dest: 'YYZ', dateKey: '2026-10-08', depLocal: '18:30', arrLocal: '19:53', arrDateKey: '2026-10-08', aircraft: '320' },
      { flightNumber: 'AC810', origin: 'YYZ', dest: 'LIS', dateKey: '2026-10-08', depLocal: '23:00', arrLocal: '11:05', arrDateKey: '2026-10-09', aircraft: '77W' },
    ];
    const first = todayView({ trip, legId: out.id, nowMs: AT_1640, notes: [], outcomes: [], connect: CONNECT, fmt: '24h' })!;
    expect(first.time).toBe('18:30');
    expect(first.title).toBe('Montréal → Lisbon');
    const rec: Outcome = {
      id: 'o1', flightNumber: 'AC489', origin: 'YUL', dest: 'YYZ', dateKey: '2026-10-08', kind: 'allBoarded',
      partySize: 2, tripId: trip.id, note: '', recordedAt: '2026-10-08T22:00:00Z',
    };
    const second = todayView({ trip, legId: out.id, nowMs: AT_1640, notes: [], outcomes: [rec], connect: CONNECT, fmt: '24h' })!;
    expect(second.time).toBe('23:00');
    expect(second.eyebrow).toBe('Today · Thu Oct 8 · at YYZ');
    expect(second.backup).toBeNull();
  });

  it('a segment recorded as not boarded keeps the traveller at its origin', () => {
    const trip = sevilleTrip();
    const out = trip.legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    if (out.kind !== 'flight') throw new Error('fixture');
    out.refs = [
      { flightNumber: 'AC489', origin: 'YUL', dest: 'YYZ', dateKey: '2026-10-08', depLocal: '18:30', arrLocal: '19:53', arrDateKey: '2026-10-08', aircraft: '320' },
      { flightNumber: 'AC810', origin: 'YYZ', dest: 'LIS', dateKey: '2026-10-08', depLocal: '23:00', arrLocal: '11:05', arrDateKey: '2026-10-09', aircraft: '77W' },
    ];
    const missed: Outcome = {
      id: 'o1', flightNumber: 'AC489', origin: 'YUL', dest: 'YYZ', dateKey: '2026-10-08', kind: 'noneBoarded',
      partySize: 2, tripId: trip.id, note: '', recordedAt: '2026-10-08T22:40:00Z',
    };
    const v = todayView({ trip, legId: out.id, nowMs: AT_1805, notes: [], outcomes: [missed], connect: CONNECT, fmt: '24h' })!;
    expect(v.ref.flightNumber).toBe('AC489');
    expect(v.eyebrow).toBe('Today · Thu Oct 8 · at YUL');
  });

  it('once the flight has left, listing and check-in are no longer on the list', () => {
    const v = todayView({
      trip: sevilleTrip(), legId: SEVILLE_IDS.outbound, nowMs: toUtcMs('2026-10-08', '18:50', 'America/Toronto'),
      notes: [], outcomes: [], connect: CONNECT, fmt: '24h',
    })!;
    expect(v.sub).toContain('left 55m ago');
    expect(v.left.filter(i => /^(list|checkin):/.test(i.id))).toEqual([]);
  });

  it("a return leg's backup is the next way home, never back toward the goal", () => {
    const v = todayView({
      trip: sevilleTrip(), legId: SEVILLE_IDS.ret, nowMs: toUtcMs('2026-10-13', '08:00', 'Europe/Lisbon'),
      notes: [], outcomes: [], connect: CONNECT, fmt: '24h',
    })!;
    expect(v.isReturn).toBe(true);
    expect(v.backup).toEqual({ title: 'Backup later today: AC811 + AC894 to Montréal 13:00', detail: "Still possible if you don't clear AC813" });
  });

  it('ticking Left to do maps to leg statuses', () => {
    const item = (id: string, done: boolean) => ({ id, title: '', detail: null, link: null, critical: true, source: 'legStatus' as const, done });
    expect(statusForTick(item('list:x:0', false), 'planned')).toBe('listed');
    expect(statusForTick(item('list:x:0', true), 'listed')).toBe('planned');
    expect(statusForTick(item('list:x:0', true), 'checkedIn')).toBeNull();
    expect(statusForTick(item('list:x:0', false), 'checkedIn')).toBeNull();
    expect(statusForTick(item('checkin:x', false), 'listed')).toBe('checkedIn');
    expect(statusForTick(item('checkin:x', true), 'checkedIn')).toBe('listed');
    expect(statusForTick(item('custom:x', false), 'listed')).toBeNull();
  });
});

describe('recover model (YUL at 18:05 Thu Oct 8, AC834 not boarded)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('picks the leg from ?leg=, else the last outbound from `at`', () => {
    const t = notBoarded(sevilleTrip());
    expect(recoverLeg(t, 'YUL', SEVILLE_IDS.outbound)?.id).toBe(SEVILLE_IDS.outbound);
    expect(recoverLeg(t, 'YUL', null)?.id).toBe(SEVILLE_IDS.outbound);
    expect(recoverLeg(t, 'YUL', 'bogus')?.id).toBe(SEVILLE_IDS.outbound);
    expect(recoverLeg(t, 'LHR', null)).toBeNull();
  });

  it('plans 3 nights in Seville with AC834', () => {
    const t = sevilleTrip();
    expect(plannedNights(t, recoverLeg(t, 'YUL', null)!)).toBe(3);
  });

  it('g5: header, goal card, tonight, tomorrow and the nights note', () => {
    const v = recoverView({ trip: notBoarded(sevilleTrip()), at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: AT_1805, connect: CONNECT, fmt: '24h' });
    expect(v.subtitle).toBe('From YUL · now 18:05');
    expect(v.goal).toBe('Seville');
    expect(v.homeBy).toBe('Tue 22:00');
    expect(v.legNote).toBe('AC834 marked Not boarded');

    expect(v.tonight.map(r => [r.name, r.code, r.line, r.onward, r.usable])).toEqual([
      ['Lisbon', 'LIS', 'AC812 21:45 → 09:20⁺¹', 'then bus about 6h45 · Seville Fri evening', true],
      ['Barcelona', 'BCN', 'AC822 18:35 · boarding has likely closed', null, false],
      ['via Toronto', 'to MAD', 'AC427 lands 21:53, after AC824 leaves at 19:15', null, false],
    ]);
    expect(v.tonight[2].thumb).toEqual({ kind: 'code', code: 'YYZ' });

    expect(v.tomorrow.map(r => [r.name, r.code, r.line, r.usable])).toEqual([
      ['Madrid again', 'MAD', 'Fri AC834 17:55 · Seville Sat midday', true],
    ]);
    expect(v.tomorrow[0].option.itinerary.dateKey).toBe('2026-10-09');
    expect(v.tomorrowMore.length).toBeGreaterThan(0);

    expect(v.note).toEqual({
      text: 'Your Tuesday return still works either way. Lisbon tonight keeps all 3 nights in Seville; waiting for Madrid tomorrow leaves 2.',
      returnBroken: false,
    });
  });

  it('never offers the flight being recovered from', () => {
    const v = recoverView({ trip: sevilleTrip(), at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: AT_1640, connect: CONNECT, fmt: '24h' });
    const all = [...v.tonight, ...v.tomorrow, ...v.tomorrowMore];
    expect(all.some(r => r.option.itinerary.legs[0].flightNumber === 'AC834' && r.option.itinerary.dateKey === '2026-10-08')).toBe(false);
    expect(v.legNote).toBe('AC834 Listed');
  });

  it('offers other-ways links and no stuck card while something usable is left tonight', () => {
    const v = recoverView({ trip: notBoarded(sevilleTrip()), at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: AT_1805, connect: CONNECT, fmt: '24h' });
    expect(v.stuckTonight).toBe(false);
    expect(v.ways).toMatchObject({ dateKey: '2026-10-08', land: false });
    expect(v.ways?.from.code).toBe('YUL');
    expect(v.ways?.to.name).toBe('Seville');
    expect(v.stay).toEqual({ code: 'YUL', airportName: 'Montréal', checkIn: '2026-10-08' });
  });

  it('is stuck tonight when no usable option is left, with tonight\'s check-in date', () => {
    const late = toUtcMs('2026-10-08', '23:50', 'America/Toronto');
    const v = recoverView({ trip: notBoarded(sevilleTrip()), at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: late, connect: CONNECT, fmt: '24h' });
    expect(v.tonight.some(r => r.usable)).toBe(false);
    expect(v.stuckTonight).toBe(true);
    expect(v.stay?.checkIn).toBe('2026-10-08');
    const small = toUtcMs('2026-10-09', '02:10', 'America/Toronto');
    const w = recoverView({ trip: notBoarded(sevilleTrip()), at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: small, connect: CONNECT, fmt: '24h' });
    expect(w.stay?.checkIn).toBe('2026-10-08');
  });

  it('says plainly when the return no longer fits', () => {
    const t = notBoarded(sevilleTrip());
    const ret = t.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    if (ret.kind !== 'flight') throw new Error('fixture');
    ret.refs = [{ ...ret.refs[0], dateKey: '2026-10-09', arrDateKey: '2026-10-09' }];
    const v = recoverView({ trip: t, at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: AT_1805, connect: CONNECT, fmt: '24h' });
    expect(v.note?.returnBroken).toBe(true);
    expect(v.note?.text).toMatch(/^Your Fri return no longer fits: open Return\./);
  });
});

describe('today model: ground legs and days between flights (Seville fixture)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  const TRAIN_DAY = toUtcMs('2026-10-09', '09:00', 'Europe/Madrid');
  const MID_TRIP = toUtcMs('2026-10-10', '12:00', 'Europe/Madrid');

  it('ground leg today: resolves to the train, with its ride, mode and timetable facts', () => {
    const trips = [sevilleTrip()];
    expect(resolveGroundToday(trips, TRAIN_DAY)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.train });
    expect(resolveGroundToday(trips, TRAIN_DAY, SEVILLE_IDS.trip, SEVILLE_IDS.bus)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.bus });
    expect(resolveGroundToday(trips, MID_TRIP)).toBeNull();
    expect(resolveGroundToday([{ ...sevilleTrip(), archived: true }], TRAIN_DAY)).toBeNull();
    const v = groundTodayView({ trip: trips[0], legId: SEVILLE_IDS.train, nowMs: TRAIN_DAY, fmt: '24h' })!;
    expect(v.eyebrow).toBe('Today · Fri Oct 9 · Madrid');
    expect(v.title).toBe('Madrid → Seville');
    expect(v.modeLabel).toBe('Train');
    expect(v.time).toBeNull();
    expect(v.final).toBe(false);
    expect(v.sub).toMatch(/^Train /);
  });

  it('a saved bus shows its departure and arrival; a done leg still shows and a dropped one never does', () => {
    const trip = sevilleTrip();
    const bus = toUtcMs('2026-10-12', '08:00', 'Europe/Madrid');
    const v = groundTodayView({ trip, legId: SEVILLE_IDS.bus, nowMs: bus, fmt: '24h' })!;
    expect(v.time).toBe('09:00');
    expect(v.sub).toBe('Bus · arrives 14:45');
    expect(v.note).toBe('your note');
    trip.legs = trip.legs.map(l => (l.id === SEVILLE_IDS.bus ? { ...l, status: 'boarded' as const } : l));
    expect(resolveGroundToday([trip], bus)).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.bus });
    expect(groundTodayView({ trip, legId: SEVILLE_IDS.bus, nowMs: bus, fmt: '24h' })!.final).toBe(true);
    trip.legs = trip.legs.map(l => (l.id === SEVILLE_IDS.bus ? { ...l, status: 'abandoned' as const } : l));
    expect(resolveGroundToday([trip], bus)).toBeNull();
  });

  it('mid-trip day: Day N at the goal, the next leg, the home-by countdown', () => {
    const trip = sevilleTrip();
    expect(tripUnderWay(trip, MID_TRIP)).toBe(true);
    const v = midTripView([trip], MID_TRIP, '24h')!;
    expect(v.title).toBe('Day 2 in Seville');
    expect(v.eyebrow).toBe('Seville trip · Sat Oct 10');
    expect(v.next?.title).toBe('Next: Bus Seville → Lisbon · Mon Oct 12 09:00');
    expect(v.homeBy).toEqual({ label: 'Home by Tue Oct 13, 22:00', countdown: 'in 3 days' });
    // Once the bus is done the next leg is the flight home, with its listing state.
    trip.legs = trip.legs.map(l => (l.id === SEVILLE_IDS.bus || l.id === SEVILLE_IDS.train ? { ...l, status: 'boarded' as const } : l));
    const later = midTripView([trip], toUtcMs('2026-10-12', '20:00', 'Europe/Madrid'), '24h')!;
    expect(later.next?.title).toBe('Next: AC813 home · Tue Oct 13 11:25 LIS time');
    expect(later.next?.detail).toMatch(/^Not listed yet · leaves in /);
    expect(later.homeBy.countdown).toBe('tomorrow');
    expect(midTripView([trip], MID_TRIP, '24h', 'nope')).toBeNull();
  });

  it('before the flight lands the title says on your way; on arrival day it is Day 1', () => {
    const trip = sevilleTrip();
    expect(midTripView([trip], toUtcMs('2026-10-09', '03:00', 'Europe/Madrid'), '24h')!.title).toBe('On your way to Seville');
    expect(midTripView([trip], toUtcMs('2026-10-09', '09:00', 'Europe/Madrid'), '24h')!.title).toBe('Day 1 in Seville');
  });

  it('future trip: Next trip in N days; none after the trip ends, archived, or with no trips', () => {
    const trip = sevilleTrip();
    const before = toUtcMs('2026-10-01', '12:00', 'America/Toronto');
    expect(upcomingTripView([trip], before)).toEqual({ tripId: SEVILLE_IDS.trip, title: 'Next trip in 7 days', detail: 'Seville trip · Thu Oct 8' });
    expect(upcomingTripView([trip], toUtcMs('2026-10-07', '12:00', 'America/Toronto'))!.title).toBe('Next trip tomorrow');
    expect(midTripView([trip], before, '24h')).toBeNull();
    expect(upcomingTripView([trip], MID_TRIP)).toBeNull();
    expect(upcomingTripView([{ ...trip, archived: true }], before)).toBeNull();
    expect(upcomingTripView([], before)).toBeNull();
  });

  it('none: after the home-by time nothing is under way', () => {
    const after = toUtcMs('2026-10-20', '12:00', 'America/Toronto');
    expect(midTripView([sevilleTrip()], after, '24h')).toBeNull();
    expect(resolveGroundToday([sevilleTrip()], after)).toBeNull();
    expect(upcomingTripView([sevilleTrip()], after)).toBeNull();
  });
});

describe('today model: review fixes (Seville fixture)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  const done = (t: Trip, ids: string[], status: 'boarded' | 'notBoarded' | 'abandoned' = 'boarded'): Trip => ({
    ...t, legs: t.legs.map(l => (ids.includes(l.id) ? { ...l, status } : l)),
  });
  const ALL = [SEVILLE_IDS.outbound, SEVILLE_IDS.train, SEVILLE_IDS.bus, SEVILLE_IDS.ret];

  it('the trip is no longer under way once the traveller is home', () => {
    const landed = toUtcMs('2026-10-13', '14:30', 'America/Toronto');
    const before = toUtcMs('2026-10-13', '12:00', 'America/Toronto');
    expect(tripUnderWay(done(sevilleTrip(), ALL), landed)).toBe(false);
    expect(tripUnderWay(done(sevilleTrip(), ALL), before)).toBe(true);
    expect(tripUnderWay(done(sevilleTrip(), [SEVILLE_IDS.ret]), landed)).toBe(false);
    expect(tripUnderWay(sevilleTrip(), landed)).toBe(true);
    expect(midTripView([done(sevilleTrip(), ALL)], landed, '24h')).toBeNull();
  });

  it('Day N counts from the outbound actually flown, in the goal zone', () => {
    const trip = sevilleTrip();
    // A missed first outbound is ignored; the flown one (a later leg) lands Oct 10 at 06:50 Madrid.
    const missed = { ...trip.legs[0], id: 'missed', status: 'notBoarded' as const };
    const flown = JSON.parse(JSON.stringify(trip.legs[0]));
    flown.id = 'flown';
    flown.status = 'boarded';
    flown.refs[0] = { ...flown.refs[0], dateKey: '2026-10-09', arrDateKey: '2026-10-10' };
    trip.legs = [missed, flown, ...trip.legs.slice(1)];
    const v = midTripView([trip], toUtcMs('2026-10-11', '12:00', 'Europe/Madrid'), '24h')!;
    expect(v.title).toBe('Day 2 in Seville');
  });

  it('home-by is phrased in home time, and says which zone when the dates differ', () => {
    const trip = sevilleTrip();
    const same = midTripView([trip], toUtcMs('2026-10-10', '12:00', 'Europe/Madrid'), '24h')!;
    expect(same.homeBy).toEqual({ label: 'Home by Tue Oct 13, 22:00', countdown: 'in 3 days' });
    // 01:00 in Madrid is still the evening before in Toronto.
    const late = midTripView([trip], toUtcMs('2026-10-11', '01:00', 'Europe/Madrid'), '24h')!;
    expect(late.homeBy.label).toBe('Home by Tue Oct 13, 22:00 YUL time');
    expect(late.homeBy.countdown).toBe('in 3 days');
  });

  it('an unsaved ground leg is read on the day it is placed, not its planned day', () => {
    const trip = sevilleTrip();
    // Planned Oct 9, but the flight lands Oct 9 06:50 Madrid so the train is placed that morning: same day.
    expect(resolveGroundToday([trip], toUtcMs('2026-10-09', '10:00', 'Europe/Madrid'))?.legId).toBe(SEVILLE_IDS.train);
    // Planned for a day the feeding flight lands late: re-anchored to the next day.
    const late = JSON.parse(JSON.stringify(trip)) as Trip;
    const out = late.legs[0];
    if (out.kind === 'flight') out.refs[0] = { ...out.refs[0], arrLocal: '23:40', arrDateKey: '2026-10-09' };
    const t = late.legs[1];
    if (t.kind === 'ground') t.dateKey = '2026-10-09';
    expect(resolveGroundToday([late], toUtcMs('2026-10-10', '00:30', 'Europe/Madrid'))?.legId).toBe(SEVILLE_IDS.train);
    expect(resolveGroundToday([late], toUtcMs('2026-10-09', '12:00', 'Europe/Madrid'))).toBeNull();
  });

  it('next leg skips flight legs with no refs', () => {
    const trip = sevilleTrip();
    trip.legs.splice(2, 0, { ...(JSON.parse(JSON.stringify(trip.legs[3])) as Trip['legs'][number]), id: 'empty', refs: [] } as Trip['legs'][number]);
    const v = midTripView([trip], toUtcMs('2026-10-10', '12:00', 'Europe/Madrid'), '24h')!;
    expect(v.next?.title).toContain('Bus Seville → Lisbon');
  });

  it('quiet line: "Nothing else today." only when a leg started today', () => {
    const trip = sevilleTrip();
    expect(midTripView([trip], toUtcMs('2026-10-10', '12:00', 'Europe/Madrid'), '24h')!.quiet).toBe('Nothing is scheduled today.');
    expect(midTripView([done(trip, [SEVILLE_IDS.train])], toUtcMs('2026-10-09', '18:00', 'Europe/Madrid'), '24h')!.quiet).toBe('Nothing else today.');
  });

  it('upcoming honours ?trip= and counts days at the first leg\'s own start', () => {
    const trip = sevilleTrip();
    const before = toUtcMs('2026-10-01', '12:00', 'America/Toronto');
    expect(upcomingTripView([trip], before, 'other')).toBeNull();
    expect(upcomingTripView([trip], before, SEVILLE_IDS.trip)!.title).toBe('Next trip in 7 days');
    // 23:30 Oct 7 in Toronto is already Oct 8 in UTC: still "tomorrow" at YUL.
    expect(upcomingTripView([trip], toUtcMs('2026-10-07', '23:30', 'America/Toronto'))!.title).toBe('Next trip tomorrow');
  });
});
