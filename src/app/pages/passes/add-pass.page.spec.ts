import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { MemoryFilesStore } from '../../files/files-store';
import { FILES_PREFS_STORAGE, FilesService } from '../../files/files.service';
import { provideFilesStore, useNodeBlobs } from '../../files/testing/files-testing';
import { BarcodeService } from '../../passes/barcode.service';
import type { DecodedRead } from '../../passes/model';
import { PassesService } from '../../passes/passes.service';
import { BCBP_MINIMAL, BCBP_MULTILEG, minimalOnDay } from '../../passes/testing/bcbp-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { toUtcMs } from '../../utils/time';
import { AddPassPage } from './add-pass.page';
import { CAMERA } from './pass-scanner.component';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
let restore: () => void;

function fakeBarcode(read: DecodedRead | null, pdf: { reads: DecodedRead[]; pageImages: Blob[] } = { reads: [], pageImages: [] }) {
  return {
    warmUp: vi.fn(),
    decodeImage: vi.fn(async () => read),
    decodeImageData: vi.fn(async () => null),
    decodePdf: vi.fn(async () => pdf),
  };
}

const pdf417 = (text: string, page: number | null = null): DecodedRead => ({ text, format: 'PDF417', step: 'as-is', page });

async function render(opts: { read?: DecodedRead | null; pdf?: { reads: DecodedRead[]; pageImages: Blob[] }; leg?: string; src?: string;
  camera?: unknown } = {}) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  const barcode = fakeBarcode(opts.read ?? null, opts.pdf);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: BarcodeService, useValue: barcode },
      { provide: CAMERA, useValue: opts.camera ?? null },
      provideFilesStore(new MemoryFilesStore()),
    ],
  });
  const fixture = TestBed.createComponent(AddPassPage);
  fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
  if (opts.leg) fixture.componentRef.setInput('leg', opts.leg);
  if (opts.src) fixture.componentRef.setInput('src', opts.src);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const flash = vi.spyOn(TestBed.inject(AppStateService), 'flash').mockImplementation(() => undefined);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel: string) => clean(el.querySelector(sel)?.textContent);
  const page = fixture.componentInstance;
  const pick = async (kind: 'image' | 'pdf' = 'image') => {
    await page.readFile(new File(['png'], kind === 'pdf' ? 'pass.pdf' : 'pass.png', { type: kind === 'pdf' ? 'application/pdf' : 'image/png' }), kind);
    await stable();
  };
  return { fixture, el, nav, flash, stable, text, pick, barcode, trips: TestBed.inject(TripsService), passes: TestBed.inject(PassesService) };
}

describe('AddPassPage', () => {
  beforeEach(() => {
    restore = useNodeBlobs();
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  });
  afterEach(() => {
    resetScheduleSource();
    restore();
    vi.restoreAllMocks();
  });

  it('shows the three sources, the trip name and the privacy note; warms the decoder on focus', async () => {
    const { el, text, barcode } = await render();
    expect(text('h1')).toBe('Add boarding passSeville trip');
    expect([...el.querySelectorAll('[data-src]')].map(b => clean(b.textContent))).toEqual(['ScanCamera', 'Photoor screenshot', 'PDFfrom Files']);
    expect(el.querySelector('[data-input="image"]')?.getAttribute('accept')).toBe('image/*');
    expect(el.querySelector('[data-input="pdf"]')?.getAttribute('accept')).toContain('application/pdf');
    expect(text('.ap__priv')).toBe('Read on this phone. The pass is stored here only and is never in share links.');
    el.querySelector('.ap')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(barcode.warmUp).toHaveBeenCalled();
  });

  it('a photo of the minimal sample shows the check step with the decoded rows and the AC834 match', async () => {
    const { el, text, pick } = await render({ read: pdf417(BCBP_MINIMAL), leg: SEVILLE_IDS.outbound });
    await pick();
    expect(text('h1')).toBe('Check the details');
    expect(text('.ap__route')).toBe('YUL → MAD');
    expect(text('.ap__fl')).toBe('AC834 · Thu Oct 8');
    const rows = [...el.querySelectorAll('.kv > div')].map(d => clean(d.textContent));
    expect(rows).toEqual(['PassengerDOE/JOHN', 'BookingABC123', 'DateDay 281= Oct 8', 'CabinY', 'Seat12A', 'Sequence45', 'BarcodePDF417 · 1 leg']);
    expect(text('[data-date]')).toBe('Day 281= Oct 8');
    expect(text('.raw summary')).toBe('Barcode text');
    expect(el.querySelector('details.raw')?.hasAttribute('open')).toBe(false);
    expect(text('[data-match] b')).toBe('Matches your AC834 leg');
    expect(text('[data-match] .match__rt > span')).toContain('Seville trip · Thu Oct 8 · YUL 17:55 → MAD 06:50⁺¹');
    expect(text('[data-match] .match__rt > span')).toContain('Scheduled');
    expect(text('[data-pick-other]')).toBe('Pick another leg');
    expect(text('[data-save]')).toBe('Save to this leg');
    expect(text('.ap__foot')).toBe('On this phone only · never shared');
    // the check-in switch is offered (the leg is Listed) and off by default
    const ci = el.querySelector<HTMLInputElement>('[data-check-in]')!;
    expect(ci.checked).toBe(false);
    expect(clean(ci.closest('label')?.textContent)).toBe("Set leg to Checked inIt's Listed now. Only if you want.");
  });

  it('saving leaves the leg Listed, stores the pass and opens it (replaceUrl) with a toast', async () => {
    const { el, nav, flash, stable, pick, trips, passes } = await render({ read: pdf417(BCBP_MINIMAL) });
    await pick();
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await stable();
    await vi.waitFor(() => expect(passes.passes()).toHaveLength(1));
    const p = passes.passes()[0];
    expect([p.legId, p.matched, p.pnr, p.dateKey, p.source]).toEqual([SEVILLE_IDS.outbound, 'confirmed', 'ABC123', '2026-10-08', 'image']);
    expect(p.imageBlobId).toBeTruthy();
    expect(trips.trip(SEVILLE_IDS.trip)!.legs[0].status).toBe('listed');
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip, 'pass', p.id], expect.objectContaining({ replaceUrl: true })));
    expect(flash).toHaveBeenCalledWith('Pass saved to AC834');
  });

  it('ticking "Set leg to Checked in" sets the leg to Checked in on save', async () => {
    const { el, stable, pick, trips, passes } = await render({ read: pdf417(BCBP_MINIMAL) });
    await pick();
    const ci = el.querySelector<HTMLInputElement>('[data-check-in]')!;
    ci.checked = true;
    ci.dispatchEvent(new Event('change'));
    await stable();
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await vi.waitFor(() => expect(passes.passes()).toHaveLength(1));
    expect(trips.trip(SEVILLE_IDS.trip)!.legs[0].status).toBe('checkedIn');
  });

  it('"Pick another leg" opens the picker; "No leg" keeps the pass with the trip', async () => {
    const { el, stable, pick, passes } = await render({ read: pdf417(BCBP_MINIMAL) });
    await pick();
    el.querySelector<HTMLButtonElement>('[data-pick-other]')!.click();
    await stable();
    const opts = [...el.querySelectorAll('[data-picker] label')].map(l => clean(l.textContent));
    expect(opts).toEqual(['AC834 · YUL → MAD · Thu Oct 8Fits this pass', 'AC813 · LIS → YUL · Tue Oct 13', 'No leg, keep it with the trip']);
    const none = el.querySelector<HTMLInputElement>('[data-option=""]')!;
    none.checked = true;
    none.dispatchEvent(new Event('change'));
    await stable();
    expect(clean(el.querySelector('[data-save]')?.textContent)).toBe('Save to the trip');
    expect(el.querySelector('[data-check-in]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await vi.waitFor(() => expect(passes.passes()).toHaveLength(1));
    expect([passes.passes()[0].legId, passes.passes()[0].matched]).toEqual([null, 'none']);
  });

  it('with no matching leg, nothing is chosen and Save waits for the user', async () => {
    const { el, stable, pick } = await render({ read: pdf417(minimalOnDay(283)), leg: SEVILLE_IDS.outbound });
    await pick();
    expect(el.querySelector('[data-match]')).toBeNull();
    expect(clean(el.querySelector('[data-no-match]')?.textContent)).toContain('No leg in this trip has AC834 YUL → MAD on that day.');
    expect(el.querySelector<HTMLButtonElement>('[data-save]')!.disabled).toBe(true);
    const leg = el.querySelector<HTMLInputElement>(`[data-option="${SEVILLE_IDS.outbound}"]`)!;
    leg.checked = true;
    leg.dispatchEvent(new Event('change'));
    await stable();
    expect(el.querySelector<HTMLButtonElement>('[data-save]')!.disabled).toBe(false);
  });

  it('a two-leg barcode shows one card per leg with its own checkbox', async () => {
    const { el, pick } = await render({ read: pdf417(BCBP_MULTILEG) });
    await pick();
    expect(el.querySelectorAll('[data-draft]')).toHaveLength(2);
    expect([...el.querySelectorAll<HTMLInputElement>('[data-include]')].map(i => i.checked)).toEqual([false, false]);
    expect(el.querySelector<HTMLButtonElement>('[data-save]')!.disabled).toBe(true);
  });

  it('no barcode: the message, "Try another image" and saving the image as a file on the leg', async () => {
    const { el, text, stable, pick, flash } = await render({ read: null, leg: SEVILLE_IDS.outbound });
    await pick();
    expect(text('[data-fail] b')).toBe('No barcode found in this image.');
    expect(text('[data-retry]')).toBe('Try another image');
    expect(text('[data-save-file]')).toBe('Save the image as a file on this leg');
    el.querySelector<HTMLButtonElement>('[data-save-file]')!.click();
    await stable();
    const files = TestBed.inject(FilesService);
    await vi.waitFor(() => expect(files.attachments()).toHaveLength(1));
    expect(files.attachments()[0].scope).toEqual({ kind: 'leg', legId: SEVILLE_IDS.outbound });
    expect(flash).toHaveBeenCalledWith('Image saved as a file on this leg');
  });

  it('moves focus to "Check the details" after a read, and back to Photo after Back', async () => {
    const { el, stable, pick, fixture } = await render({ read: pdf417(BCBP_MINIMAL) });
    document.body.appendChild(el);
    try {
      await pick();
      await vi.waitFor(() => expect(document.activeElement?.hasAttribute('data-check-title')).toBe(true));
      el.querySelector<HTMLButtonElement>('[data-back]')!.click();
      await stable();
      await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-src')).toBe('image'));
    } finally {
      fixture.destroy();
      el.remove();
    }
  });

  it('a late result from an older read never replaces a newer one', async () => {
    const { el, stable, barcode, fixture } = await render({ read: pdf417(BCBP_MINIMAL) });
    let finishPdf!: (v: { reads: DecodedRead[]; pageImages: Blob[] }) => void;
    barcode.decodePdf.mockImplementationOnce(() => new Promise(r => (finishPdf = r)));
    const page = fixture.componentInstance;
    const slow = page.readFile(new File(['pdf'], 'pass.pdf', { type: 'application/pdf' }), 'pdf');
    await page.readFile(new File(['png'], 'pass.png', { type: 'image/png' }), 'image');
    await stable();
    expect(el.querySelector('[data-draft]')).not.toBeNull();
    finishPdf({ reads: [], pageImages: [] });
    await slow;
    await stable();
    expect(el.querySelector('[data-fail]')).toBeNull();
    expect(el.querySelector('[data-draft]')).not.toBeNull();
  });

  it('refuses a file over 50 MB before decoding it', async () => {
    const { el, text, stable, barcode, fixture } = await render({ read: pdf417(BCBP_MINIMAL) });
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 + 1 });
    await fixture.componentInstance.readFile(big, 'image');
    await stable();
    expect(barcode.decodeImage).not.toHaveBeenCalled();
    expect(text('[data-fail] b')).toBe('This file is over 50 MB. Pick a smaller one.');
    expect(el.querySelector('[data-save-file]')).toBeNull();
  });

  it('"Set leg to Checked in" only changes legs whose pass was saved', async () => {
    const { el, stable, pick, trips, passes, fixture } = await render({ read: pdf417(BCBP_MULTILEG) });
    await pick();
    const page = fixture.componentInstance as unknown as {
      drafts(): { key: string }[]; choose(d: unknown, legId: string): void; toggleInclude(k: string, on: boolean): void; checkIn: { set(v: boolean): void };
    };
    const [d1, d2] = page.drafts();
    page.choose(d1, SEVILLE_IDS.outbound);
    page.choose(d2, SEVILLE_IDS.ret);
    page.toggleInclude(d1.key, true);
    page.toggleInclude(d2.key, true);
    page.checkIn.set(true);
    await stable();
    expect((fixture.componentInstance as unknown as { checkInLegs(): unknown[] }).checkInLegs()).toHaveLength(2);
    const real = passes.save.bind(passes);
    vi.spyOn(passes, 'save').mockImplementationOnce(real).mockResolvedValueOnce({ error: 'quota' });
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await vi.waitFor(() => expect(passes.passes()).toHaveLength(1));
    const t = trips.trip(SEVILLE_IDS.trip)!;
    expect(t.legs.find(l => l.id === SEVILLE_IDS.outbound)!.status).toBe('checkedIn');
    expect(t.legs.find(l => l.id === SEVILLE_IDS.ret)!.status).not.toBe('checkedIn');
  });

  it('a QR code with a link: "Not a boarding pass barcode."', async () => {
    const { text, pick } = await render({ read: { text: 'https://example.com', format: 'QRCode', step: 'as-is', page: null } });
    await pick();
    expect(text('[data-fail] b')).toBe('Not a boarding pass barcode.');
  });

  it('a PDF keeps the page image of the read and records the page', async () => {
    const page = new Blob(['page-png'], { type: 'image/png' });
    const { el, stable, pick, passes } = await render({ pdf: { reads: [pdf417(BCBP_MINIMAL, 1)], pageImages: [page] } });
    await pick('pdf');
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await stable();
    await vi.waitFor(() => expect(passes.passes()).toHaveLength(1));
    const p = passes.passes()[0];
    expect([p.source, p.page]).toEqual(['pdf', 1]);
    expect((await passes.image(p.id))?.size).toBe(page.size);
  });

  it('?src=camera without a camera: the fallback message, focus on "Photo or screenshot"', async () => {
    const { el, fixture } = await render({ src: 'camera', camera: null });
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(el.querySelector('[data-camera-off]')).toBeTruthy();
    });
    expect(clean(el.querySelector('[data-camera-off]')?.textContent)).toBe('Camera not available. Pick a photo or screenshot instead.');
    expect(el.querySelector('app-pass-scanner')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.dataset['src']).toBe('image');
  });

  it('?src=camera with permission denied degrades the same way', async () => {
    const camera = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); });
    const { el, fixture } = await render({ src: 'camera', camera });
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(el.querySelector('[data-camera-off]')).toBeTruthy();
    });
    expect(camera).toHaveBeenCalled();
  });
});
