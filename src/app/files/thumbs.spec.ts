import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { itemMeta } from '../pages/files/files-model';
import { TripFilesPage } from '../pages/files/trip-files.page';
import { AppStateService, NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { TRIPS_KEY } from '../trips/model';
import { TRIPS_STORAGE } from '../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../trips/testing/seville-fixture';
import { toUtcMs } from '../utils/time';
import { FilesStore, IdbFilesStore, MemoryFilesStore } from './files-store';
import { FILES_PREFS_STORAGE, FilesService } from './files.service';
import { Attachment } from './model';
import { FakeIDBFactory, attachment, provideFilesStore, textFile, useNodeBlobs } from './testing/files-testing';
import { THUMB_MAKER, ThumbMaker, makeThumb, thumbScale, wantsThumb } from './thumbs';
import { buildBackupWithFiles } from './backup-files';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const flash = vi.fn();
let restore: () => void;
let urlN = 0;
const revoked: string[] = [];
const u = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (s: string) => void };
let prevUrls: { c: typeof u.createObjectURL; r: typeof u.revokeObjectURL };

/** A maker that returns a 3-byte JPEG and 3 pages for PDFs. */
const fakeMaker = vi.fn<ThumbMaker>(async (_content, kind) => ({
  thumb: new Blob(['jpg'], { type: 'image/jpeg' }),
  pages: kind === 'pdf' ? 3 : null,
}));

function make(store: FilesStore, maker: ThumbMaker = fakeMaker): FilesService {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: AppStateService, useValue: { flash } },
      { provide: THUMB_MAKER, useValue: maker },
      provideFilesStore(store),
    ],
  });
  return TestBed.inject(FilesService);
}

async function added(svc: FilesService, file: File, scope: Attachment['scope'] = { kind: 'trip' }): Promise<Attachment> {
  const a = await svc.addFile(SEVILLE_IDS.trip, scope, file);
  if ('error' in a) throw new Error(a.error);
  return a;
}

const current = (svc: FilesService, id: string) => svc.attachments().find(a => a.id === id)!;

beforeEach(() => {
  restore = useNodeBlobs();
  flash.mockReset();
  fakeMaker.mockClear();
  setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  prevUrls = { c: u.createObjectURL, r: u.revokeObjectURL };
  u.createObjectURL = () => `blob:t${++urlN}`;
  u.revokeObjectURL = s => void revoked.push(s);
  revoked.length = 0;
});
afterEach(() => {
  restore();
  resetScheduleSource();
  u.createObjectURL = prevUrls.c;
  u.revokeObjectURL = prevUrls.r;
});

describe('file previews', () => {
  it('makes a preview and page count for a new PDF, stored with the file', async () => {
    const store = new MemoryFilesStore();
    const svc = make(store);
    const a = await added(svc, textFile('Hotel.pdf', 100));
    await vi.waitFor(() => expect(current(svc, a.id).thumbBlobId).not.toBeNull());
    const rec = current(svc, a.id);
    expect(rec.pages).toBe(3);
    expect(itemMeta(rec)).toBe('PDF · 3 pages · 100 B');
    expect(svc.thumbUrl(rec)).toMatch(/^blob:/);
    const saved = (await store.listAttachments())[0];
    expect(saved).toMatchObject({ thumbBlobId: rec.thumbBlobId, pages: 3, bytes: 100 });
    expect((await store.getBlob(rec.thumbBlobId!))!.type).toBe('image/jpeg');
    expect(fakeMaker).toHaveBeenCalledWith(expect.anything(), 'pdf');
    // usage counts the file only, never the preview
    expect(svc.usage().bytes).toBe(100);
  });

  it('makes one for photos, none for other files', async () => {
    const svc = make(new MemoryFilesStore());
    svc.setPrefs({ compressPhotos: false });
    const photo = await added(svc, textFile('Beach.png', 50, 'image/png'));
    const txt = await added(svc, textFile('Notes.txt', 50, 'text/plain'));
    await vi.waitFor(() => expect(current(svc, photo.id).thumbBlobId).not.toBeNull());
    expect(current(svc, photo.id).pages).toBeNull();
    expect(current(svc, txt.id).thumbBlobId).toBeNull();
    expect(svc.thumbUrl(current(svc, txt.id))).toBeNull();
    expect(fakeMaker).toHaveBeenCalledTimes(1);
  });

  it('deleting a file deletes its preview (IndexedDB)', async () => {
    const store = await IdbFilesStore.open({ factory: new FakeIDBFactory() });
    const svc = make(store);
    const a = await added(svc, textFile('Hotel.pdf', 100));
    await vi.waitFor(() => expect(current(svc, a.id).thumbBlobId).not.toBeNull());
    const { thumbBlobId } = current(svc, a.id);
    const url = svc.thumbUrl(current(svc, a.id));
    await svc.remove(a.id);
    expect(await store.getBlob(thumbBlobId!)).toBeNull();
    expect(await store.getBlob(a.blobId!)).toBeNull();
    expect((await store.blobSizes()).size).toBe(0);
    expect(revoked).toContain(url);
    // Undo restores the file; its preview is made again when it is listed
    flash.mock.calls[0][1].run();
    await vi.waitFor(() => expect(svc.attachments().map(x => x.id)).toEqual([a.id]));
    expect(current(svc, a.id).thumbBlobId).toBeNull();
    svc.ensureThumbs(svc.attachments());
    await vi.waitFor(() => expect(current(svc, a.id).thumbBlobId).not.toBeNull());
  });

  it('backfills files saved before previews, once, when they are listed', async () => {
    const store = new MemoryFilesStore();
    await store.putAttachment(attachment({ id: 'old', blobId: 'b-old', tripId: SEVILLE_IDS.trip }),
      { id: 'b-old', blob: new Blob(['%PDF'], { type: 'application/pdf' }), bytes: 4, mime: 'application/pdf', createdAt: '2026-10-01T00:00:00.000Z' });
    const svc = make(store);
    await svc.ensureReady();
    expect(fakeMaker).not.toHaveBeenCalled(); // lazy: nothing until listed
    svc.ensureThumbs(svc.attachments());
    svc.ensureThumbs(svc.attachments());
    await vi.waitFor(() => expect(current(svc, 'old').pages).toBe(3));
    expect(fakeMaker).toHaveBeenCalledTimes(1);
    expect((await store.listAttachments())[0].thumbBlobId).toBe(current(svc, 'old').thumbBlobId);
  });

  it('loads a stored preview without making it again, and remakes a lost one', async () => {
    const store = new MemoryFilesStore();
    const blob = { blob: new Blob(['%PDF'], { type: 'application/pdf' }), bytes: 4, mime: 'application/pdf', createdAt: '2026-10-01T00:00:00.000Z' };
    const has = attachment({ id: 'has', blobId: 'b1', thumbBlobId: 't1', tripId: SEVILLE_IDS.trip, pages: 2 });
    await store.putAttachment(has, { id: 'b1', ...blob });
    await store.putAttachment(has, { id: 't1', blob: new Blob(['j'], { type: 'image/jpeg' }), bytes: 1, mime: 'image/jpeg', createdAt: '' });
    await store.putAttachment(attachment({ id: 'lost', blobId: 'b2', thumbBlobId: 'missing', tripId: SEVILLE_IDS.trip }), { id: 'b2', ...blob });
    const svc = make(store);
    await svc.ensureReady();
    svc.ensureThumbs(svc.attachments().filter(a => a.id === 'has' || a.id === 'lost'));
    await vi.waitFor(() => expect(svc.thumbUrl(current(svc, 'has'))).toMatch(/^blob:/));
    await vi.waitFor(() => expect(current(svc, 'lost').thumbBlobId).not.toBe('missing'));
    expect(fakeMaker).toHaveBeenCalledTimes(1);
    expect(current(svc, 'has').pages).toBe(2);
  });

  it("a file whose preview can't be made keeps its icon and is not retried this session", async () => {
    const failing = vi.fn<ThumbMaker>(async () => ({ thumb: null, pages: null }));
    const svc = make(new MemoryFilesStore(), failing);
    const a = await added(svc, textFile('Broken.pdf', 10));
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    svc.ensureThumbs(svc.attachments());
    await new Promise(r => setTimeout(r));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(svc.thumbUrl(current(svc, a.id))).toBeNull();
    expect(current(svc, a.id)).toMatchObject({ thumbBlobId: null, pages: null });
  });

  it('a file deleted while its preview is made stays deleted', async () => {
    const store = new MemoryFilesStore();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const slow = vi.fn<ThumbMaker>(async () => {
      await gate;
      return { thumb: new Blob(['j'], { type: 'image/jpeg' }), pages: 1 };
    });
    const svc = make(store, slow);
    const a = await added(svc, textFile('Hotel.pdf', 10));
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await svc.remove(a.id);
    release();
    await new Promise(r => setTimeout(r, 10));
    expect(await store.listAttachments()).toEqual([]);
    expect((await store.blobSizes()).size).toBe(0);
  });

  it('a backup never carries the preview', async () => {
    const a = attachment({ thumbBlobId: 'thumb1' });
    const out = await buildBackupWithFiles({ format: 'routes-backup' }, [a], async () => new Blob(['pdf']));
    const parsed = JSON.parse(await out.text()) as { files: { attachments: { meta: Attachment }[] } };
    expect(parsed.files.attachments[0].meta.thumbBlobId).toBeNull();
  });

  it('the trip files page shows the preview instead of the icon', async () => {
    const svc = make(new MemoryFilesStore());
    const a = await added(svc, textFile('Hotel.pdf', 100));
    await vi.waitFor(() => expect(svc.thumbUrl(current(svc, a.id))).not.toBeNull());
    const fixture = TestBed.createComponent(TripFilesPage);
    fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
    await fixture.whenStable();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
    const row = (fixture.nativeElement as HTMLElement).querySelector(`[data-item="${a.id}"]`)!;
    const img = row.querySelector('[data-thumb] img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(svc.thumbUrl(current(svc, a.id)));
    expect(img.getAttribute('alt')).toBe('');
    expect(row.textContent).toContain('PDF · 3 pages');
  });

  it('pure helpers', async () => {
    expect(wantsThumb('pdf')).toBe(true);
    expect(wantsThumb('image')).toBe(true);
    expect(wantsThumb('file')).toBe(false);
    expect(thumbScale(612, 792)).toBeCloseTo(160 / 792);
    expect(thumbScale(0, 0)).toBe(1);
    // no createImageBitmap here (jsdom): no preview, no pdf.js load
    expect(await makeThumb(new Blob(['x']), 'pdf')).toEqual({ thumb: null, pages: null });
  });
});
