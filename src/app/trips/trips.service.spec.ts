import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { rec, route } from '../data/testing/schedule-fixtures';
import { directItinerary } from '../utils/connections';
import { toUtcMs } from '../utils/time';
import { flightsOn } from '../utils/week';
import { AppStateService, NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { BlockedStorage, MemoryStorage } from '../state/testing';
import { FLIGHTLOG_KEY, TRIPS_KEY, Trip } from './model';
import { TRIPS_STORAGE } from './storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_PLACE, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from './testing/seville-fixture';
import { BAD_DATA_NOTICE, TripsService } from './trips.service';

const yul = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');
let nowMs = yul('2026-10-01', '09:41');
let storage: Storage | null;

function seeded(): MemoryStorage {
  const s = new MemoryStorage();
  s.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  return s;
}

function make(store: Storage | null = seeded()): TripsService {
  storage = store;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => nowMs },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
    ],
  });
  return TestBed.inject(TripsService);
}

/** A fresh service over the same storage (an app reload). */
function reload(): TripsService {
  TestBed.resetTestingModule();
  return make(storage);
}

const stored = (): { trips: Trip[] } => JSON.parse(storage!.getItem(TRIPS_KEY)!);
const leg = (svc: TripsService, id: string) => svc.trip(SEVILLE_IDS.trip)!.legs.find(l => l.id === id)!;
const LIS_YUL_RETIMED = SEVILLE_ROUTES.map(r => r.originCode === 'LIS' && r.destinationCode === 'YUL'
  ? route('LIS', 'YUL', rec('AC813', '11:10', '13:35', '2026-09-29', '2027-09-26', 'Mon,Tue,Wed,Thu,Fri,Sat', '333')) : r);

describe('TripsService', () => {
  beforeEach(() => {
    nowMs = yul('2026-10-01', '09:41');
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  });
  afterEach(() => {
    resetScheduleSource();
    TestBed.resetTestingModule();
  });

  it('loads trips and splits active from past', () => {
    const svc = make();
    expect(svc.trips().map(t => t.id)).toEqual([SEVILLE_IDS.trip]);
    expect(svc.activeTrips().map(t => t.id)).toEqual([SEVILLE_IDS.trip]);
    expect(svc.pastTrips()).toEqual([]);
    expect(svc.readOnly()).toBe(false);
    expect(svc.trip('nope')).toBeNull();

    nowMs = yul('2026-10-15', '09:00');
    svc.checkChanges();
    expect(svc.activeTrips()).toEqual([]);
    expect(svc.pastTrips().map(t => t.id)).toEqual([SEVILLE_IDS.trip]);
  });

  it('creates a trip and persists it across a reload', () => {
    const svc = make(new MemoryStorage());
    const t = svc.create({ goal: SEVILLE_PLACE, fromHub: 'YUL', outboundDate: '2026-10-08', homeBy: { dateKey: '2026-10-13', hhmm: '22:00' } });
    expect(t.id).toMatch(/^[a-z0-9]{10}$/);
    expect(t.name).toBe('Seville trip');
    expect(t.homeAirport).toBe('YUL');
    expect(t.party).toEqual({ count: 1, stayTogether: true, splitNote: '' });
    expect(t.scheduleGeneratedAt).toBe(SEVILLE_META.generatedAt);
    expect(reload().trip(t.id)).toEqual(t);
  });

  it('keeps trips in memory when storage is blocked', () => {
    const svc = make(new BlockedStorage());
    const t = svc.create({ goal: SEVILLE_PLACE, fromHub: 'YUL', outboundDate: '2026-10-08', homeBy: { dateKey: '2026-10-13', hhmm: '22:00' } });
    expect(svc.trip(t.id)).toBeTruthy();
    svc.setLegStatus(t.id, 'none', 'boarded');
    expect(svc.trips()).toHaveLength(1);
  });

  it('never overwrites data from a newer app version', () => {
    const s = new MemoryStorage();
    s.setItem(TRIPS_KEY, JSON.stringify({ ...SEVILLE_TRIPS_FILE, schema: 2 }));
    const spy = vi.spyOn(s, 'setItem');
    const svc = make(s);
    expect(svc.readOnly()).toBe(true);
    expect(svc.trips()).toHaveLength(1);
    svc.setLegStatus(SEVILLE_IDS.trip, SEVILLE_IDS.ret, 'listed');
    svc.addLoadNote({ flightNumber: 'AC813', origin: 'LIS', dest: 'YUL', dateKey: '2026-10-13', open: 3, listed: 1, text: '' });
    expect(spy).not.toHaveBeenCalled();
    expect('error' in svc.importBackup('{}')).toBe(true);
  });

  it('sets leg status with a timestamp, persisted', () => {
    const svc = make();
    svc.setLegStatus(SEVILLE_IDS.trip, SEVILLE_IDS.ret, 'listed');
    expect(leg(svc, SEVILLE_IDS.ret).status).toBe('listed');
    expect(leg(svc, SEVILLE_IDS.ret).statusAt).toBe(new Date(nowMs).toISOString());
    expect(svc.trip(SEVILLE_IDS.trip)!.updatedAt).toBe(new Date(nowMs).toISOString());
    expect(leg(reload(), SEVILLE_IDS.ret).status).toBe('listed');
  });

  it('saves real ground times as "Saved by you"', () => {
    const svc = make();
    svc.saveGroundTimes(SEVILLE_IDS.trip, SEVILLE_IDS.train,
      { depDateKey: '2026-10-09', depLocal: '10:05', arrDateKey: '2026-10-09', arrLocal: '12:45' }, 'train', 'AVE 2083');
    const g = leg(svc, SEVILLE_IDS.train);
    expect(g.kind === 'ground' && g.provenance).toBe('saved');
    expect(g.kind === 'ground' && g.userTimes?.depLocal).toBe('10:05');
    expect(g.note).toBe('AVE 2083');
  });

  it('adds legs in chronological order, and alternates without duplicates', () => {
    const svc = make();
    const it0 = directItinerary(flightsOn('YUL', 'LHR', '2026-10-05')[0]);
    const id = svc.addFlightLeg(SEVILLE_IDS.trip, it0, 'positioning');
    expect(svc.trip(SEVILLE_IDS.trip)!.legs[0].id).toBe(id);
    expect(svc.addFlightLeg('nope', it0, 'outbound')).toBe('');

    const gid = svc.addGroundLeg(SEVILLE_IDS.trip, {
      kind: 'ground', mode: 'bus', from: { name: 'Lisbon', lat: 38.7, lng: -9.1 }, to: { name: 'Lisbon airport', code: 'LIS', lat: 38.77, lng: -9.13 },
      dateKey: '2026-10-13', estMinutes: 30, provenance: 'estimated', userTimes: null,
    });
    const order = svc.trip(SEVILLE_IDS.trip)!.legs.map(l => l.id);
    expect(order.indexOf(gid)).toBe(order.indexOf(SEVILLE_IDS.ret) + 1); // 12:00 on Tue, after AC813 11:25

    const bcn = directItinerary(flightsOn('YUL', 'BCN', '2026-10-08')[0]);
    svc.addAlternate(SEVILLE_IDS.trip, SEVILLE_IDS.outbound, bcn); // already a backup
    const opo = directItinerary(flightsOn('YUL', 'OPO', '2026-10-09')[0]);
    svc.addAlternate(SEVILLE_IDS.trip, SEVILLE_IDS.outbound, opo);
    const out = leg(svc, SEVILLE_IDS.outbound);
    expect(out.kind === 'flight' && out.alternates.map(a => a.refs[0].flightNumber)).toEqual(['AC822', 'AC812', 'AC928']);
    svc.removeAlternate(SEVILLE_IDS.trip, SEVILLE_IDS.outbound, SEVILLE_IDS.altBcn);
    const out2 = leg(svc, SEVILLE_IDS.outbound);
    expect(out2.kind === 'flight' && out2.alternates.map(a => a.refs[0].flightNumber)).toEqual(['AC812', 'AC928']);
  });

  it('swaps a leg for a backup, re-estimates the ground leg, and undoes', () => {
    const svc = make();
    const state = TestBed.inject(AppStateService);
    const lis = directItinerary(flightsOn('YUL', 'LIS', '2026-10-08')[0]);
    svc.setLegStatus(SEVILLE_IDS.trip, SEVILLE_IDS.outbound, 'notBoarded');
    svc.swapLeg(SEVILLE_IDS.trip, SEVILLE_IDS.outbound, lis,
      { mode: 'bus', totalMin: 480, provenance: 'estimated' });

    const t = svc.trip(SEVILLE_IDS.trip)!;
    expect(leg(svc, SEVILLE_IDS.outbound).status).toBe('notBoarded');
    const fresh = t.legs.find(l => l.kind === 'flight' && l.refs[0].flightNumber === 'AC812')!;
    expect(fresh.status).toBe('planned');
    expect(fresh.kind === 'flight' && fresh.alternates.map(a => a.refs[0].flightNumber)).toEqual(['AC822']);
    const g = leg(svc, SEVILLE_IDS.train);
    expect(g.kind === 'ground' && [g.from.code, g.mode, g.estMinutes, g.provenance, g.dateKey])
      .toEqual(['LIS', 'bus', 480, 'estimated', '2026-10-09']);
    expect(state.notice()?.message).toBe('Swapped to AC812 · Listing is still your step');
    expect(state.notice()?.actionLabel).toBe('Undo');

    state.notice()!.action!();
    expect(svc.trip(SEVILLE_IDS.trip)!.legs).toHaveLength(4);
    const g2 = leg(svc, SEVILLE_IDS.train);
    expect(g2.kind === 'ground' && g2.from.code).toBe('MAD');
  });

  it('drops an open leg when swapping before the flight', () => {
    const svc = make();
    const bcn = directItinerary(flightsOn('YUL', 'BCN', '2026-10-08')[0]);
    svc.swapLeg(SEVILLE_IDS.trip, SEVILLE_IDS.outbound, bcn, null);
    expect(leg(svc, SEVILLE_IDS.outbound).status).toBe('abandoned');
    const g = leg(svc, SEVILLE_IDS.train);
    expect(g.kind === 'ground' && [g.from.code, g.provenance, g.estMinutes]).toEqual(['BCN', 'unknown', null]);
  });

  it('stores a retime as an open change; Accept applies it', () => {
    const svc = make();
    expect(svc.trip(SEVILLE_IDS.trip)!.changes).toEqual([]);
    setScheduleSource(LIS_YUL_RETIMED, SEVILLE_META);
    svc.checkChanges();
    const t = svc.trip(SEVILLE_IDS.trip)!;
    expect(t.changes).toHaveLength(1);
    const c = t.changes[0];
    expect([c.kind, c.state, c.next?.depLocal]).toEqual(['retimed', 'open', '11:10']);
    // Not applied silently.
    const ret = leg(svc, SEVILLE_IDS.ret);
    expect(ret.kind === 'flight' && ret.refs[0].depLocal).toBe('11:25');
    svc.checkChanges();
    expect(svc.trip(SEVILLE_IDS.trip)!.changes).toHaveLength(1);

    svc.acceptChange(SEVILLE_IDS.trip, c.id);
    const ret2 = leg(svc, SEVILLE_IDS.ret);
    expect(ret2.kind === 'flight' && [ret2.refs[0].depLocal, ret2.refs[0].arrLocal]).toEqual(['11:10', '13:35']);
    expect(svc.trip(SEVILLE_IDS.trip)!.changes[0].state).toBe('accepted');
    svc.checkChanges();
    expect(svc.trip(SEVILLE_IDS.trip)!.changes.filter(x => x.state === 'open')).toEqual([]);
  });

  it('Keep my plan marks a leg not found as Unknown; data restored clears open changes', () => {
    const svc = make();
    const noLisYul = SEVILLE_ROUTES.filter(r => !(r.originCode === 'LIS' && r.destinationCode === 'YUL'));
    setScheduleSource(noLisYul, SEVILLE_META);
    svc.checkChanges();
    const c = svc.trip(SEVILLE_IDS.trip)!.changes[0];
    expect(c.kind).toBe('notFound');
    svc.keepChange(SEVILLE_IDS.trip, c.id);
    expect((leg(svc, SEVILLE_IDS.ret) as { provenance: string }).provenance).toBe('unknown');
    expect(svc.trip(SEVILLE_IDS.trip)!.changes[0].state).toBe('kept');
    svc.checkChanges();
    expect(svc.trip(SEVILLE_IDS.trip)!.changes).toHaveLength(1);

    // An open change that no longer holds goes away, and the leg is Scheduled again.
    const svc2 = (() => { TestBed.resetTestingModule(); setScheduleSource(SEVILLE_ROUTES, SEVILLE_META); return make(); })();
    setScheduleSource(noLisYul, SEVILLE_META);
    svc2.checkChanges();
    expect(svc2.trip(SEVILLE_IDS.trip)!.changes).toHaveLength(1);
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    svc2.checkChanges();
    expect(svc2.trip(SEVILLE_IDS.trip)!.changes).toEqual([]);
    expect((leg(svc2, SEVILLE_IDS.ret) as { provenance: string }).provenance).toBe('scheduled');
  });

  it('stores nothing when the new schedules look broken, and says so once', () => {
    const svc = make();
    const state = TestBed.inject(AppStateService);
    setScheduleSource([], SEVILLE_META);
    svc.checkChanges();
    expect(svc.trip(SEVILLE_IDS.trip)!.changes).toEqual([]);
    expect(svc.scheduleNotice()).toBe(BAD_DATA_NOTICE);
    expect(state.notice()?.message).toBe('The latest schedules look incomplete. Your plans are unchanged.');
    state.dismissNotice();
    svc.checkChanges();
    expect(state.notice()).toBeNull();
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    svc.checkChanges();
    expect(svc.scheduleNotice()).toBeNull();
  });

  it('asks how AC834 went after departure + 30 min; recording clears it and sets the leg', () => {
    const svc = make();
    nowMs = yul('2026-10-08', '18:20');
    svc.checkChanges();
    expect(svc.pendingOutcomes()).toEqual([]);
    nowMs = yul('2026-10-08', '18:30');
    svc.checkChanges();
    const p = svc.pendingOutcomes();
    expect(p.map(x => x.key)).toEqual(['AC834|YUL|2026-10-08']);
    svc.recordOutcome({ ...p[0].ref, kind: 'allBoarded', partySize: 2, tripId: SEVILLE_IDS.trip, note: '' });
    expect(svc.pendingOutcomes()).toEqual([]);
    expect(leg(svc, SEVILLE_IDS.outbound).status).toBe('boarded');
    expect(svc.outcomes()).toHaveLength(1);
    expect(JSON.parse(storage!.getItem(FLIGHTLOG_KEY)!).outcomes).toHaveLength(1);
  });

  it('dismisses a prompt', () => {
    const svc = make();
    nowMs = yul('2026-10-09', '09:00');
    svc.checkChanges();
    svc.dismissOutcome('AC834|YUL|2026-10-08');
    expect(svc.pendingOutcomes()).toEqual([]);
    expect(svc.dismissed()).toEqual(['AC834|YUL|2026-10-08']);
  });

  it('keeps load notes, newest first', () => {
    const svc = make();
    svc.addLoadNote({ flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 14, listed: 9, text: '' });
    nowMs += 60_000;
    svc.addLoadNote({ flightNumber: 'AC866', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 2, listed: 11, text: '' });
    expect(svc.notesFor(null, 'YUL', '2026-10-09').map(n => n.flightNumber)).toEqual(['AC866', 'AC864']);
    expect(svc.notesFor('AC864', 'YUL', '2026-10-09')).toHaveLength(1);
    svc.removeLoadNote(svc.notesFor('AC864', 'YUL', '2026-10-09')[0].id);
    expect(reload().notes().map(n => n.flightNumber)).toEqual(['AC866']);
  });

  it('deletes a trip with Undo', () => {
    const svc = make();
    const state = TestBed.inject(AppStateService);
    svc.remove(SEVILLE_IDS.trip);
    expect(svc.trips()).toEqual([]);
    expect(stored().trips).toEqual([]);
    expect(state.notice()?.message).toBe('Trip deleted');
    state.notice()!.action!();
    expect(svc.trips().map(t => t.id)).toEqual([SEVILLE_IDS.trip]);
  });

  it('exports and imports backups', () => {
    const svc = make();
    const text = svc.exportBackup();
    expect(svc.backupFilename()).toBe('routes-trips-2026-10-01.json');
    const fresh = (() => { TestBed.resetTestingModule(); return make(new MemoryStorage()); })();
    expect(fresh.importBackup(text)).toEqual({ added: 1, updated: 0 });
    expect(fresh.importBackup(text)).toEqual({ added: 0, updated: 0 });
    expect(fresh.importBackup('nope')).toEqual({ error: "This file isn't a Routes backup." });
    expect(fresh.trip(SEVILLE_IDS.trip)?.name).toBe('Seville trip');
  });

  it('shares a trip as a link that saves as a new copy', async () => {
    const svc = make();
    svc.addLoadNote({ flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', open: 9, listed: 9, text: 'Gate 52' });
    const link = await svc.shareLink(SEVILLE_IDS.trip);
    expect(link).toMatch(/\/trips\/import#t=[zj]/);
    expect(link.length).toBeLessThan(2000);
    expect(await svc.shareLink('nope')).toBe('');

    const fresh = (() => { TestBed.resetTestingModule(); return make(new MemoryStorage()); })();
    const preview = (await fresh.decodeShared(link.split('#t=')[1]))!;
    expect(preview.trip.name).toBe('Seville trip');
    const saved = fresh.saveShared(preview);
    expect(saved.id).not.toBe(SEVILLE_IDS.trip);
    expect(saved.sharedFrom).toEqual({ at: preview.sharedAt });
    expect(saved.legs).toHaveLength(4);
    expect(fresh.notes().map(n => n.text)).toEqual(['Gate 52']);
    expect(await fresh.decodeShared('garbage')).toBeNull();
  });

  it('marks offline and calendar, prep and archive', () => {
    const svc = make();
    nowMs = yul('2026-10-02', '08:00');
    svc.markOfflineSaved(SEVILLE_IDS.trip);
    svc.markCalendarExported(SEVILLE_IDS.trip);
    svc.setPrep(SEVILLE_IDS.trip, 'entry:etias', true);
    svc.addCustomPrep(SEVILLE_IDS.trip, '  Euros for the bus  ');
    const t = svc.trip(SEVILLE_IDS.trip)!;
    expect(t.offlineSavedAt).toBe(new Date(nowMs).toISOString());
    expect(t.calendarExportedAt).toBe(new Date(nowMs).toISOString());
    expect(t.prep['entry:etias'].done).toBe(true);
    expect(t.customPrep.map(c => c.text)).toEqual(['Euros for the bus']);
    svc.removeCustomPrep(SEVILLE_IDS.trip, t.customPrep[0].id);
    expect(svc.trip(SEVILLE_IDS.trip)!.customPrep).toEqual([]);
    svc.archive(SEVILLE_IDS.trip);
    expect(svc.activeTrips()).toEqual([]);
  });
});
