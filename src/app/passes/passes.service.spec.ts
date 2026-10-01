import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FilesDb } from '../files/files-db';
import { MemoryFilesStore } from '../files/files-store';
import { provideFilesStore, useNodeBlobs } from '../files/testing/files-testing';
import { AppStateService, NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { TRIPS_KEY } from '../trips/model';
import { TRIPS_STORAGE } from '../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIP, SEVILLE_TRIPS_FILE } from '../trips/testing/seville-fixture';
import { toUtcMs } from '../utils/time';
import { parseBcbp } from './bcbp';
import type { NewPass } from './model';
import { PassesService, expiredPasses, removedAfterTripText } from './passes.service';
import { BCBP_MINIMAL, BCBP_MULTILEG } from './testing/bcbp-fixtures';

const yul = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');
let restore: () => void;
let store: MemoryFilesStore;
const flash = vi.fn();

function make(): PassesService {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => yul('2026-10-01', '09:41') },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: AppStateService, useValue: { flash } },
      provideFilesStore(store),
    ],
  });
  return TestBed.inject(PassesService);
}

/** The NewPass the add flow builds from a decoded barcode. */
function newPass(raw = BCBP_MINIMAL, over: Partial<NewPass> = {}, legIndex = 0): NewPass {
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('bcbp');
  const l = r.legs[legIndex];
  return {
    tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw, format: 'PDF417',
    bcbpLeg: legIndex, lastName: r.passenger.lastName, firstName: r.passenger.firstName, pnr: l.pnr, from: l.from, to: l.to,
    flightNumber: `AC${l.flightNumber}`, julian: l.julian, dateKey: '2026-10-08', cabin: l.cabin, seat: l.seat, sequence: l.sequence,
    source: 'image', page: null, deleteAfterTrip: false, ...over,
  };
}

beforeEach(() => {
  restore = useNodeBlobs();
  store = new MemoryFilesStore();
  flash.mockReset();
  setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
});
afterEach(() => {
  restore();
  resetScheduleSource();
});

describe('PassesService', () => {
  it('saves a pass with its image and lists it by trip and leg', async () => {
    const svc = make();
    await svc.ensureReady();
    const saved = await svc.save(newPass(), new Blob(['png'], { type: 'image/png' }));
    if ('error' in saved) throw new Error(saved.error);
    expect(saved).toMatchObject({ v: 1, pnr: 'ABC123', seat: '12A', flightNumber: 'AC834' });
    expect(saved.imageBlobId).toBeTruthy();
    expect(svc.forTrip(SEVILLE_IDS.trip)).toHaveLength(1);
    expect(svc.forLeg(SEVILLE_IDS.trip, SEVILLE_IDS.outbound).map(p => p.id)).toEqual([saved.id]);
    expect(svc.imageBytes()).toBe(3);
    expect(await (await svc.image(saved.id))!.text()).toBe('png');
    expect(await store.listPasses()).toHaveLength(1);
  });

  it('keeps one copy of the image for the legs of a multi-leg barcode', async () => {
    const svc = make();
    const img = new Blob(['image'], { type: 'image/png' });
    const a = await svc.save(newPass(BCBP_MULTILEG, {}, 0), img);
    const b = await svc.save(newPass(BCBP_MULTILEG, { legId: SEVILLE_IDS.ret }, 1), img);
    if ('error' in a || 'error' in b) throw new Error('save');
    expect(a.imageBlobId).toBe(b.imageBlobId);
    expect((await store.blobSizes()).size).toBe(1);
    expect(svc.imageBytes()).toBe(5);
    await svc.remove(a.id);
    expect(await store.getBlob(b.imageBlobId!)).not.toBeNull();
  });

  it('relinks and toggles delete-after-trip', async () => {
    const svc = make();
    const p = await svc.save(newPass(), null);
    if ('error' in p) throw new Error(p.error);
    await svc.relink(p.id, null, null, 'none');
    await svc.setDeleteAfterTrip(p.id, true);
    expect(svc.passes()[0]).toMatchObject({ legId: null, refIndex: null, matched: 'none', deleteAfterTrip: true });
    expect((await store.listPasses())[0]).toMatchObject({ legId: null, deleteAfterTrip: true });
  });

  it('deletes with Undo that brings back the pass and its image', async () => {
    const svc = make();
    const p = await svc.save(newPass(), new Blob(['png'], { type: 'image/png' }));
    if ('error' in p) throw new Error(p.error);
    await svc.remove(p.id);
    expect(svc.passes()).toEqual([]);
    expect(await store.getBlob(p.imageBlobId!)).toBeNull();
    expect(flash).toHaveBeenCalledWith('Pass deleted', expect.objectContaining({ label: 'Undo' }));
    flash.mock.calls[0][1].run();
    await vi.waitFor(() => expect(svc.passes().map(x => x.id)).toEqual([p.id]));
    expect(await (await store.getBlob(p.imageBlobId!))!.text()).toBe('png');
  });

  it('removes delete-after-trip passes a day after home-by, keeps the others and orphans', async () => {
    const svc = make();
    const flagged = await svc.save(newPass(BCBP_MINIMAL, { deleteAfterTrip: true }), null);
    const kept = await svc.save(newPass(), null);
    const orphan = await svc.save(newPass(BCBP_MINIMAL, { tripId: 'deleted-trip', deleteAfterTrip: true }), null);
    if ('error' in flagged || 'error' in kept || 'error' in orphan) throw new Error('save');
    // Seville: home by Tue Oct 13 22:00 at YUL → removable from Wed Oct 14 22:00 (YUL time).
    expect(await svc.cleanupExpired([SEVILLE_TRIP], Date.parse('2026-10-14T21:00:00-04:00'))).toBe(0);
    expect(svc.passes()).toHaveLength(3);
    expect(await svc.cleanupExpired([SEVILLE_TRIP], Date.parse('2026-10-14T22:30:00-04:00'))).toBe(1);
    expect(svc.passes().map(p => p.id).sort()).toEqual([kept.id, orphan.id].sort());
    expect(flash.mock.calls).toEqual([['1 boarding pass removed after your trip', undefined]]);
  });

  it('runs the clean-up once when it first loads', async () => {
    const svc0 = make();
    const p = await svc0.save(newPass(BCBP_MINIMAL, { deleteAfterTrip: true }), null);
    if ('error' in p) throw new Error(p.error);
    TestBed.resetTestingModule();
    const trips = new MemoryStorage();
    trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => Date.parse('2026-10-20T12:00:00Z') },
        { provide: TRIPS_STORAGE, useValue: trips },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: AppStateService, useValue: { flash } },
        provideFilesStore(store),
      ],
    });
    const svc = TestBed.inject(PassesService);
    await svc.ensureReady();
    expect(svc.passes()).toEqual([]);
    expect(await store.listPasses()).toEqual([]);
  });

  it('reports quota and read-only errors', async () => {
    store = new MemoryFilesStore({ quotaBytes: 2 });
    const svc = make();
    expect(await svc.save(newPass(), new Blob(['too big'], { type: 'image/png' }))).toEqual({ error: 'quota' });
    expect(svc.passes()).toEqual([]);
    expect(TestBed.inject(FilesDb).status()).toBe('memory');
  });

  it('expiredPasses and the toast copy', () => {
    expect(removedAfterTripText(1)).toBe('1 boarding pass removed after your trip');
    expect(removedAfterTripText(2)).toBe('2 boarding passes removed after your trip');
    expect(expiredPasses([], [SEVILLE_TRIP], Date.now())).toEqual([]);
  });
});
