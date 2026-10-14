import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MemoryFilesStore } from '../../files/files-store';
import { FILES_PREFS_STORAGE } from '../../files/files.service';
import { provideFilesStore } from '../../files/testing/files-testing';
import { BCBP_MINIMAL } from '../../passes/testing/bcbp-fixtures';
import { FilesService } from '../../files/files.service';
import { FILES_ERROR_TEXT } from '../../files/model';
import { AppStateService } from '../../state/app-state.service';
import { BarcodeService } from '../../passes/barcode.service';
import { ShareInboxService } from '../../share-in/share-inbox.service';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { ShareInPage } from './share-in.page';

function setup(barcode: Partial<Record<'decodeImage' | 'decodePdf', unknown>> = {}) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => toUtcMs('2026-10-01', '09:41', 'America/Toronto') },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: BarcodeService, useValue: { warmUp: vi.fn(), decodeImage: vi.fn(async () => null), decodePdf: vi.fn(async () => ({ reads: [], pageImages: [] })), ...barcode } },
      provideFilesStore(new MemoryFilesStore()),
    ],
  });
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const inbox = TestBed.inject(ShareInboxService);
  return { inbox, nav };
}

describe('ShareInPage', () => {
  it('"Add boarding pass" hands the file over and it survives the page being destroyed', async () => {
    const { inbox, nav } = setup();
    const file = new File(['x'], 'bp.png', { type: 'image/png' });
    inbox.offerFiles([file]);
    const fixture = TestBed.createComponent(ShareInPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-add-pass]') as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip, 'passes', 'add']);
    fixture.destroy();
    expect(inbox.takeHandoff()).toBe(file);
  });

  it('shows files that arrive after the page opened (desktop Open with)', async () => {
    const { inbox } = setup();
    const fixture = TestBed.createComponent(ShareInPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-empty]')).toBeTruthy();
    inbox.offerFiles([new File(['x'], 'bp.pdf', { type: 'application/pdf' })]);
    await fixture.whenStable();
    expect(el.querySelector('[data-kind="pdf"]')).toBeTruthy();
    expect(el.querySelector('[data-empty]')).toBeNull();
  });

  it('gives a failed and an oversized share their own messages', async () => {
    for (const [id, text] of [['failed', "Couldn't receive that share"], ['too-large', 'too big']] as const) {
      TestBed.resetTestingModule();
      setup();
      const fixture = TestBed.createComponent(ShareInPage);
      fixture.componentRef.setInput('id', id);
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-problem]')?.textContent).toContain(text);
    }
  });

  const open = async (item: Parameters<ShareInboxService['item']['set']>[0]) => {
    const { inbox, nav } = setup();
    inbox.item.set(item);
    const fixture = TestBed.createComponent(ShareInPage);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, inbox, nav };
  };
  const pdf = () => new File(['x'], 'ticket.pdf', { type: 'application/pdf' });

  it('flags an image or a PDF that holds a boarding-pass barcode, and not one that fails to decode', async () => {
    TestBed.resetTestingModule();
    const a = setup({ decodeImage: vi.fn(async () => ({ text: BCBP_MINIMAL })), decodePdf: vi.fn(async () => ({ reads: [{ text: BCBP_MINIMAL }], pageImages: [] })) });
    a.inbox.offerFiles([new File(['x'], 'bp.png', { type: 'image/png' }), pdf()]);
    let fixture = TestBed.createComponent(ShareInPage);
    await fixture.whenStable();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-pass-like]')).toHaveLength(2);

    TestBed.resetTestingModule();
    const b = setup({ decodeImage: vi.fn(async () => { throw new Error('boom'); }) });
    b.inbox.offerFiles([new File(['x'], 'bp.png', { type: 'image/png' })]);
    fixture = TestBed.createComponent(ShareInPage);
    await fixture.whenStable();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-pass-like]')).toBeNull();
  });

  it('"Save to trip files" keeps the file, says so and opens the trip files', async () => {
    const { el, nav, inbox } = await open({ files: [pdf()], title: '', text: '', url: '' });
    const flash = vi.spyOn(TestBed.inject(AppStateService), 'flash');
    const add = vi.spyOn(TestBed.inject(FilesService), 'addFile');
    (el.querySelector('[data-save-file]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nav).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(SEVILLE_IDS.trip, { kind: 'trip' }, expect.any(File));
    expect(flash).toHaveBeenCalledWith('Saved to trip files');
    expect(inbox.item()).toBeNull();
  });

  it('shows why a file could not be saved and stays on the page', async () => {
    const { fixture, el, nav } = await open({ files: [pdf()], title: '', text: '', url: '' });
    vi.spyOn(TestBed.inject(FilesService), 'addFile').mockResolvedValue({ error: 'tooLarge' });
    (el.querySelector('[data-save-file]') as HTMLButtonElement).click();
    await vi.waitFor(() => { fixture.detectChanges(); expect(el.textContent).toContain(FILES_ERROR_TEXT.tooLarge); });
    expect(nav).not.toHaveBeenCalled();
  });

  it('saves shared text as a note, and a shared text file as a note titled after it', async () => {
    const note = await open({ files: [], title: 'Hotel', text: 'Booking 123', url: 'https://example.com/b' });
    const addNote = vi.spyOn(TestBed.inject(FilesService), 'addNote');
    (note.el.querySelector('[data-save-text]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(note.nav).toHaveBeenCalled());
    expect(addNote).toHaveBeenCalledWith(SEVILLE_IDS.trip, { kind: 'trip' }, 'Hotel', 'Booking 123\n\nhttps://example.com/b');

    TestBed.resetTestingModule();
    const txt = new File(['x'], 'itinerary.txt', { type: 'text/plain' });
    Object.defineProperty(txt, 'text', { value: async () => 'Day 1: Madrid' });
    const file = await open({ files: [txt], title: '', text: '', url: '' });
    const addNote2 = vi.spyOn(TestBed.inject(FilesService), 'addNote');
    (file.el.querySelector('[data-save-note]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(file.nav).toHaveBeenCalled());
    expect(addNote2).toHaveBeenCalledWith(SEVILLE_IDS.trip, { kind: 'trip' }, 'itinerary', 'Day 1: Madrid');
  });

  it('shows why a note could not be saved', async () => {
    const { fixture, el, nav } = await open({ files: [], title: '', text: 'Hello', url: '' });
    vi.spyOn(TestBed.inject(FilesService), 'addNote').mockResolvedValue({ error: 'quota' });
    (el.querySelector('[data-save-text]') as HTMLButtonElement).click();
    await vi.waitFor(() => { fixture.detectChanges(); expect(el.textContent).toContain(FILES_ERROR_TEXT.quota); });
    expect(nav).not.toHaveBeenCalled();
  });

  it('"Not now" clears the share and goes to the trip', async () => {
    const { el, nav, inbox } = await open({ files: [pdf()], title: '', text: '', url: '' });
    (el.querySelector('[data-dismiss]') as HTMLButtonElement).click();
    expect(inbox.item()).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip]);
  });
});
