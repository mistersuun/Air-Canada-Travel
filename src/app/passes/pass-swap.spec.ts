import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { MemoryFilesStore } from '../files/files-store';
import { FILES_PREFS_STORAGE } from '../files/files.service';
import { provideFilesStore, useNodeBlobs } from '../files/testing/files-testing';
import { PassViewPage, WAKE_LOCK } from '../pages/passes/pass-view.page';
import { AppStateService, NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { TRIPS_KEY, type FlightLeg } from '../trips/model';
import { TRIPS_STORAGE } from '../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../trips/testing/seville-fixture';
import { TripsService } from '../trips/trips.service';
import { toUtcMs } from '../utils/time';
import { parseBcbp } from './bcbp';
import type { NewPass, PassRecord } from './model';
import { PassSwapService, swapOfferFor } from './pass-swap.service';
import { PassesService } from './passes.service';
import { minimalPass } from './testing/bcbp-fixtures';
import { LegPassesComponent } from './ui/leg-passes.component';

vi.mock('./barcode-render', () => ({
  renderBarcodeSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 4"></svg>'),
}));

const NOW_MS = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
let restore: () => void;

function pass812(over: Partial<NewPass> = {}): NewPass {
  const raw = minimalPass({ from: 'YUL', to: 'LIS', flight: '0812', julian: 281, pnr: over.pnr ?? 'ABC123' });
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('bcbp');
  const l = r.legs[0];
  return {
    tripId: SEVILLE_IDS.trip, legId: null, refIndex: null, matched: 'none', raw, format: 'PDF417', bcbpLeg: 0,
    lastName: r.passenger.lastName, firstName: r.passenger.firstName, pnr: l.pnr, from: l.from, to: l.to, flightNumber: 'AC812',
    julian: l.julian, dateKey: '2026-10-08', cabin: l.cabin, seat: l.seat, sequence: l.sequence, source: 'image', page: null,
    deleteAfterTrip: false, ...over,
  };
}

async function setup() {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  const flash = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: WAKE_LOCK, useValue: null },
      provideFilesStore(new MemoryFilesStore()),
    ],
  });
  vi.spyOn(TestBed.inject(AppStateService), 'flash').mockImplementation(flash);
  const passes = TestBed.inject(PassesService);
  await passes.ensureReady();
  return { passes, trips: TestBed.inject(TripsService), swapper: TestBed.inject(PassSwapService), flash };
}

const newLeg = (trips: TripsService) =>
  trips.trip(SEVILLE_IDS.trip)!.legs.find((l): l is FlightLeg => l.kind === 'flight' && l.status === 'planned' && l.refs[0].flightNumber === 'AC812');

describe('pass swap offer', () => {
  beforeEach(() => {
    restore = useNodeBlobs();
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  });
  afterEach(() => {
    resetScheduleSource();
    restore();
    vi.restoreAllMocks();
  });

  it('swaps the leg like Recover does and links the pass (and a companion) to the new leg; Undo puts all back', async () => {
    const { passes, trips, swapper, flash } = await setup();
    const a = (await passes.save(pass812(), null)) as PassRecord;
    const b = (await passes.save(pass812({ pnr: 'ABC124', legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'manual' }), null)) as PassRecord;
    const other = (await passes.save(pass812({ flightNumber: 'AC834', to: 'MAD', legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed' }), null)) as PassRecord;
    expect(swapOfferFor(a, trips.trip(SEVILLE_IDS.trip))?.text).toBe('This pass is for AC812 (your backup). Swap this leg to AC812?');

    const legId = await swapper.swapForPass(a);
    const fresh = newLeg(trips)!;
    expect(legId).toBe(fresh.id);
    const t = trips.trip(SEVILLE_IDS.trip)!;
    const old = t.legs.find(l => l.id === SEVILLE_IDS.outbound) as FlightLeg;
    expect(old).toMatchObject({ status: 'abandoned', alternates: [] });
    // the other backup stays a backup of the new leg
    expect(fresh.alternates.map(x => x.refs[0].flightNumber)).toEqual(['AC822']);
    expect(flash).toHaveBeenCalledWith('Swapped to AC812 · Listing is still your step', expect.objectContaining({ label: 'Undo' }));
    const by = (id: string) => passes.passes().find(p => p.id === id)!;
    await vi.waitFor(() => expect(by(b.id).legId).toBe(fresh.id));
    expect(by(a.id)).toMatchObject({ legId: fresh.id, refIndex: 0, matched: 'confirmed' });
    expect(by(other.id).legId).toBe(SEVILLE_IDS.outbound); // the AC834 pass stays on its leg
    expect(swapOfferFor(by(a.id), trips.trip(SEVILLE_IDS.trip))).toBeNull();

    flash.mock.calls.find(c => String(c[0]).startsWith('Swapped'))![1].run();
    await vi.waitFor(() => expect(by(a.id).legId).toBeNull());
    expect(by(b.id)).toMatchObject({ legId: SEVILLE_IDS.outbound, matched: 'manual' });
    expect(newLeg(trips)).toBeUndefined();
    expect((trips.trip(SEVILLE_IDS.trip)!.legs.find(l => l.id === SEVILLE_IDS.outbound) as FlightLeg).status).toBe('listed');
  });

  it('the pass view offers the swap, and after it the pass shows on the new leg', async () => {
    const { passes, trips } = await setup();
    const a = (await passes.save(pass812(), null)) as PassRecord;
    const fixture = TestBed.createComponent(PassViewPage);
    fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
    fixture.componentRef.setInput('passId', a.id);
    const el = fixture.nativeElement as HTMLElement;
    const stable = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await vi.waitFor(async () => {
      await stable();
      expect(el.querySelector('[data-swap-offer]')).toBeTruthy();
    });
    expect(clean(el.querySelector('[data-swap-offer] p')?.textContent)).toBe('This pass is for AC812 (your backup). Swap this leg to AC812?');
    el.querySelector<HTMLButtonElement>('[data-swap]')!.click();
    await vi.waitFor(async () => {
      await stable();
      expect(el.querySelector('[data-swap-offer]')).toBeNull();
    });
    await vi.waitFor(() => expect(passes.passes()[0].legId).toBe(newLeg(trips)!.id));
    await stable();
    // Departs now reads the new leg's scheduled time
    expect(clean(el.querySelector('.pv__grid')?.textContent)).toContain('21:45');
  });

  it('the leg sheet row offers the swap on the leg that has the backup, and says when it is done', async () => {
    const { passes, trips } = await setup();
    await passes.save(pass812(), null);
    const fixture = TestBed.createComponent(LegPassesComponent);
    const trip = trips.trip(SEVILLE_IDS.trip)!;
    fixture.componentRef.setInput('trip', trip);
    fixture.componentRef.setInput('leg', trip.legs.find(l => l.id === SEVILLE_IDS.outbound)!);
    const swapped = vi.fn();
    fixture.componentInstance.swapped.subscribe(swapped);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(clean(el.querySelector('[data-swap-offer]')?.textContent)).toBe('This pass is for AC812 (your backup). Swap this leg to AC812? Swap to AC812');
    el.querySelector<HTMLButtonElement>('[data-swap]')!.click();
    await vi.waitFor(() => expect(swapped).toHaveBeenCalledWith(newLeg(trips)!.id));
    expect(passes.passes()[0].legId).toBe(newLeg(trips)!.id);
  });

  it('no offer on another leg, and none for a pass on its planned flight', async () => {
    const { passes, trips } = await setup();
    await passes.save(pass812({ flightNumber: 'AC834', to: 'MAD', legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed' }), null);
    const trip = trips.trip(SEVILLE_IDS.trip)!;
    const fixture = TestBed.createComponent(LegPassesComponent);
    fixture.componentRef.setInput('trip', trip);
    fixture.componentRef.setInput('leg', trip.legs.find(l => l.id === SEVILLE_IDS.outbound)!);
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-swap-offer]')).toBeNull();
  });
});
