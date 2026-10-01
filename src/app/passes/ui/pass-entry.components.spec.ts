import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { MemoryFilesStore } from '../../files/files-store';
import { FILES_PREFS_STORAGE } from '../../files/files.service';
import { provideFilesStore, useNodeBlobs } from '../../files/testing/files-testing';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIP, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { parseBcbp } from '../bcbp';
import type { NewPass, PassRecord } from '../model';
import { PassesService } from '../passes.service';
import { BCBP_MINIMAL, minimalPass } from '../testing/bcbp-fixtures';
import { LegPassesComponent } from './leg-passes.component';
import { TodayPassComponent } from './today-pass.component';

const NOW_MS = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
let clock = NOW_MS;
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
let restore: () => void;

function newPass(raw: string): NewPass {
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('bcbp');
  const l = r.legs[0];
  return {
    tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw, format: 'PDF417', bcbpLeg: 0,
    lastName: r.passenger.lastName, firstName: r.passenger.firstName, pnr: l.pnr, from: l.from, to: l.to, flightNumber: 'AC834',
    julian: l.julian, dateKey: '2026-10-08', cabin: l.cabin, seat: l.seat, sequence: l.sequence, source: 'image', page: null,
    deleteAfterTrip: false,
  };
}

async function setup(saved: string[]) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => clock },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      provideFilesStore(new MemoryFilesStore()),
    ],
  });
  const passes = TestBed.inject(PassesService);
  await passes.ensureReady();
  const out: PassRecord[] = [];
  for (const raw of saved) {
    out.push((await passes.save(newPass(raw), null)) as PassRecord);
    clock += 60_000; // each later pass is added a minute later (the swipe order)
  }
  return out;
}

async function mount<T>(cmp: new (...a: never[]) => T, inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('pass entry points', () => {
  beforeEach(() => {
    restore = useNodeBlobs();
    clock = NOW_MS;
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  });
  afterEach(() => {
    resetScheduleSource();
    restore();
    vi.restoreAllMocks();
  });

  it('Today with a saved pass: "Show boarding pass" opens the pass view; no booking code', async () => {
    const [p] = await setup([BCBP_MINIMAL]);
    const el = await mount(TodayPassComponent, { tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound });
    const a = el.querySelector<HTMLAnchorElement>('[data-show-pass]')!;
    expect(clean(a.textContent)).toBe('Show boarding pass· seat 12A');
    expect(a.getAttribute('href')?.split('?')[0]).toBe(`/trips/${SEVILLE_IDS.trip}/pass/${p.id}`);
    expect(el.textContent).not.toContain('ABC123');
    expect(el.textContent).not.toContain('ABC•••');
  });

  it('Today without a pass: "Add boarding pass" for this leg', async () => {
    await setup([]);
    const el = await mount(TodayPassComponent, { tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound });
    const a = el.querySelector<HTMLAnchorElement>('[data-add-pass]')!;
    expect(clean(a.textContent)).toBe('Add boarding pass');
    expect(a.getAttribute('href')).toMatch(new RegExp(`^/trips/${SEVILLE_IDS.trip}/passes/add\\?.*leg=${SEVILLE_IDS.outbound}`));
  });

  it('the leg sheet row: count, seats and "Not shared"; no booking code', async () => {
    const [p] = await setup([BCBP_MINIMAL, minimalPass({ from: 'YUL', to: 'MAD', flight: '0834', julian: 281, pnr: 'ABC124' })]);
    const el = await mount(LegPassesComponent, { trip: SEVILLE_TRIP, leg: SEVILLE_TRIP.legs[0] });
    const a = el.querySelector<HTMLAnchorElement>('[data-show-pass]')!;
    expect(clean(a.textContent)).toBe('Show boarding pass2 passes · seat 12A, 12ANot shared');
    expect(a.getAttribute('href')?.split('?')[0]).toBe(`/trips/${SEVILLE_IDS.trip}/pass/${p.id}`);
    expect(el.querySelector('[data-add-another]')?.getAttribute('href')).toContain(`leg=${SEVILLE_IDS.outbound}`);
    expect(el.textContent).not.toMatch(/ABC12[34]/);
  });

  it('the leg sheet row without passes, and nothing for a ground leg', async () => {
    await setup([]);
    const el = await mount(LegPassesComponent, { trip: SEVILLE_TRIP, leg: SEVILLE_TRIP.legs[3] });
    expect(clean(el.querySelector('[data-add-pass]')?.textContent)).toBe('Add boarding pass');
    const ground = await mount(LegPassesComponent, { trip: SEVILLE_TRIP, leg: SEVILLE_TRIP.legs[1] });
    expect(ground.querySelector('a')).toBeNull();
  });
});
