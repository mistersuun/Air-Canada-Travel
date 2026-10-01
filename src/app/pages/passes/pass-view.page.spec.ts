import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { MemoryFilesStore } from '../../files/files-store';
import { FILES_PREFS_STORAGE } from '../../files/files.service';
import { provideFilesStore, useNodeBlobs } from '../../files/testing/files-testing';
import { parseBcbp } from '../../passes/bcbp';
import type { NewPass, PassRecord } from '../../passes/model';
import { PassesService } from '../../passes/passes.service';
import { BCBP_MINIMAL, minimalPass } from '../../passes/testing/bcbp-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { PassViewPage, WAKE_LOCK, type WakeLockLike } from './pass-view.page';

vi.mock('../../passes/barcode-render', () => ({
  renderBarcodeSvg: vi.fn(async (text: string, format: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 4" data-format="${format}" data-len="${text.length}"><rect width="10" height="4" fill="#fff"/></svg>`),
}));

const NOW_MS = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
let clock = NOW_MS;
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
let restore: () => void;

function newPass(raw: string, over: Partial<NewPass> = {}): NewPass {
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('bcbp');
  const l = r.legs[0];
  return {
    tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw, format: 'PDF417', bcbpLeg: 0,
    lastName: r.passenger.lastName, firstName: r.passenger.firstName, pnr: l.pnr, from: l.from, to: l.to, flightNumber: 'AC834',
    julian: l.julian, dateKey: '2026-10-08', cabin: l.cabin, seat: l.seat, sequence: l.sequence, source: 'image', page: null,
    deleteAfterTrip: false, ...over,
  };
}

async function render(opts: { wake?: WakeLockLike | null; second?: boolean; image?: boolean } = {}) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => clock },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: WAKE_LOCK, useValue: opts.wake === undefined ? null : opts.wake },
      provideFilesStore(new MemoryFilesStore()),
    ],
  });
  const passes = TestBed.inject(PassesService);
  await passes.ensureReady();
  const img = opts.image === false ? null : new Blob(['img'], { type: 'image/png' });
  const a = (await passes.save(newPass(BCBP_MINIMAL), img)) as PassRecord;
  let b: PassRecord | null = null;
  if (opts.second) {
    clock = NOW_MS + 60_000; // added a minute later: second in the swipe order
    b = (await passes.save(newPass(minimalPass({ from: 'YUL', to: 'MAD', flight: '0834', julian: 281, pnr: 'ABC124' })), null)) as PassRecord;
  }
  const fixture = TestBed.createComponent(PassViewPage);
  fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
  fixture.componentRef.setInput('passId', a.id);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  await stable();
  await vi.waitFor(async () => {
    await stable();
    expect(el.querySelector('[data-barcode] svg')).toBeTruthy();
  });
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const text = (sel: string) => clean(el.querySelector(sel)?.textContent);
  return { fixture, el, stable, text, nav, passes, a, b, state: TestBed.inject(AppStateService) };
}

describe('PassViewPage', () => {
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

  it('a white layer with the route, the facts, the booking code and the redrawn barcode', async () => {
    const { el, text } = await render();
    expect(el.querySelector('[data-pass-view]')).toBeTruthy();
    expect([...el.querySelectorAll('.pv__code')].map(c => c.textContent)).toEqual(['YUL', 'MAD']);
    expect([...el.querySelectorAll('.pv__grid > div')].map(d => clean(d.textContent))).toEqual([
      'FlightAC834', 'Departs (scheduled)17:55', 'Seat12A', 'Seq45',
    ]);
    expect(text('.pv__who')).toBe('DOE/JOHN · YThu Oct 8 · ABC123');
    const svg = el.querySelector('[data-barcode] svg')!;
    expect(svg.getAttribute('data-format')).toBe('PDF417');
    expect(svg.getAttribute('data-len')).toBe(String(BCBP_MINIMAL.length));
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(text('.pv__bright')).toBe('Turn your screen brightness up at the gate.');
    expect(el.querySelector('[data-count]')).toBeNull();
  });

  it('without a wake lock it says so; with one that resolves it shows "Screen stays on"', async () => {
    const first = await render();
    expect(first.text('[data-no-awake]')).toBe("Keep the screen on yourself; this browser can't.");
    expect(first.el.querySelector('[data-awake]')).toBeNull();
    TestBed.resetTestingModule();
    const release = vi.fn(async () => undefined);
    const wake = { request: vi.fn(async () => ({ release })) };
    const { el, text, stable, fixture } = await render({ wake });
    await vi.waitFor(async () => {
      await stable();
      expect(text('[data-awake]')).toBe('Screen stays on');
    });
    expect(wake.request).toHaveBeenCalledWith('screen');
    expect(el.querySelector('[data-no-awake]')).toBeNull();
    fixture.destroy();
    expect(release).toHaveBeenCalled();
  });

  it('a rejected wake lock request shows the fallback line', async () => {
    const { text, stable } = await render({ wake: { request: vi.fn(async () => { throw new Error('denied'); }) } });
    await vi.waitFor(async () => {
      await stable();
      expect(text('[data-no-awake]')).toBe("Keep the screen on yourself; this browser can't.");
    });
  });

  it('"Original image" shows the saved image; it is disabled when there is none', async () => {
    const created = vi.fn(() => 'blob:pass');
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const { el, stable } = await render();
    const btn = el.querySelector<HTMLButtonElement>('[data-mode="image"]')!;
    expect(btn.disabled).toBe(false);
    btn.click();
    await vi.waitFor(async () => {
      await stable();
      expect(el.querySelector<HTMLImageElement>('[data-original]')?.getAttribute('src')).toBe('blob:pass');
    });
    el.querySelector<HTMLButtonElement>('[data-mode="barcode"]')!.click();
    await stable();
    expect(el.querySelector('[data-original]')).toBeNull();
    expect(revoked).toHaveBeenCalledWith('blob:pass');
    TestBed.resetTestingModule();
    const none = await render({ image: false });
    expect(none.el.querySelector<HTMLButtonElement>('[data-mode="image"]')!.disabled).toBe(true);
  });

  it('two passes on the leg: "1 of 2", Next moves on and keeps the URL on the pass shown', async () => {
    const { el, text, stable, nav, b } = await render({ second: true });
    expect(el.querySelectorAll('[data-slide]')).toHaveLength(2);
    expect(text('[data-count]')).toBe('1 of 2 passes on this leg · swipe for the next');
    expect(el.querySelector<HTMLButtonElement>('[data-prev]')!.disabled).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-next]')!.click();
    await stable();
    expect(text('[data-count]')).toBe('2 of 2 passes on this leg · swipe for the next');
    expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip, 'pass', b!.id], expect.objectContaining({ replaceUrl: true }));
  });

  it('the options sheet: delete after the trip, move to no leg, delete with a confirm step', async () => {
    const { el, stable, passes, a, state } = await render();
    const goBack = vi.spyOn(state, 'goBack').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('[data-more]')!.click();
    await stable();
    const sw = document.querySelector<HTMLInputElement>('[data-delete-after]')!;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(passes.passes()[0].deleteAfterTrip).toBe(true));

    document.querySelector<HTMLButtonElement>('[data-move-open]')!.click();
    await stable();
    const labels = [...document.querySelectorAll('[data-move-list] label')].map(l => clean(l.textContent));
    expect(labels).toEqual(['AC834 · YUL → MAD · Thu Oct 8', 'AC813 · LIS → YUL · Tue Oct 13', 'No leg, keep it with the trip']);

    document.querySelector<HTMLButtonElement>('[data-delete]')?.click();
    await stable();
    document.querySelector<HTMLButtonElement>('[data-delete-confirm]')!.click();
    await vi.waitFor(() => expect(passes.passes().find(p => p.id === a.id)).toBeUndefined());
    expect(goBack).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip]);
  });

  it('an unknown pass id says it is not on this phone', async () => {
    const { fixture, el, stable } = await render();
    fixture.componentRef.setInput('passId', 'nope');
    await stable();
    expect(clean(el.querySelector('[data-missing] b')?.textContent)).toBe("This pass isn't on this phone.");
  });
});
