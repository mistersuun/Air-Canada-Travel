import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MemoryFilesStore } from '../../files/files-store';
import { FILES_PREFS_STORAGE } from '../../files/files.service';
import { provideFilesStore } from '../../files/testing/files-testing';
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

function setup() {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => toUtcMs('2026-10-01', '09:41', 'America/Toronto') },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: BarcodeService, useValue: { warmUp: vi.fn(), decodeImage: vi.fn(async () => null), decodePdf: vi.fn(async () => ({ reads: [], pageImages: [] })) } },
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
});
