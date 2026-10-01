import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory } from 'fake-indexeddb';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { parseBcbp } from '../passes/bcbp';
import { PassesService } from '../passes/passes.service';
import { BCBP_FULL, BCBP_MINIMAL } from '../passes/testing/bcbp-fixtures';
import { AppStateService, NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { BlockedStorage, MemoryStorage } from '../state/testing';
import { TRIPS_KEY } from '../trips/model';
import { decodeTripShare, encodeTripShare } from '../trips/share-codec';
import { TRIPS_STORAGE } from '../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIP, SEVILLE_TRIPS_FILE } from '../trips/testing/seville-fixture';
import { TripsService } from '../trips/trips.service';
import { toUtcMs } from '../utils/time';
import { FilesDb } from './files-db';
import { FILES_STORE, FilesStore, IdbFilesStore, MemoryFilesStore, STORES, upgradeFilesDb } from './files-store';
import { FILES_PREFS_STORAGE, FilesService, kindForMime, mapsUrl, sanitizeFilesPrefs, summarizeUsage, titleFromName } from './files.service';
import { openDb } from './idb';
import { FILES_DB, FILES_PREFS_KEY, MAX_FILE_BYTES } from './model';
import { attachment, provideFakeIdb, provideFilesStore, textFile, useNodeBlobs } from './testing/files-testing';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const flash = vi.fn();
let restore: () => void;

function seededTrips(): MemoryStorage {
  const s = new MemoryStorage();
  s.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  return s;
}

function make(storeProvider: unknown, opts: { trips?: Storage; prefs?: Storage | null } = {}): FilesService {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: opts.trips ?? seededTrips() },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: opts.prefs === undefined ? new MemoryStorage() : opts.prefs },
      { provide: AppStateService, useValue: { flash } },
      storeProvider as never,
    ],
  });
  return TestBed.inject(FilesService);
}

async function savePass(raw = BCBP_MINIMAL, tripId: string = SEVILLE_IDS.trip) {
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('bcbp');
  const l = r.legs[0];
  const saved = await TestBed.inject(PassesService).save({
    tripId, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw, format: 'PDF417', bcbpLeg: 0,
    lastName: r.passenger.lastName, firstName: r.passenger.firstName, pnr: l.pnr, from: l.from, to: l.to,
    flightNumber: `AC${l.flightNumber}`, julian: l.julian, dateKey: '2026-10-08', cabin: l.cabin, seat: l.seat, sequence: l.sequence,
    source: 'image', page: null, deleteAfterTrip: false,
  }, new Blob(['pass image'], { type: 'image/png' }));
  if ('error' in saved) throw new Error(saved.error);
  return saved;
}

/** Runs `fn` with URL.createObjectURL stubbed ('blob:1', 'blob:2', …); returns the blobs it was given. */
async function withObjectUrls(fn: () => Promise<unknown>): Promise<Blob[]> {
  const seen: Blob[] = [];
  const u = URL as unknown as { createObjectURL?: (b: Blob) => string };
  const prev = u.createObjectURL;
  u.createObjectURL = (b: Blob) => `blob:${seen.push(b)}`;
  try {
    await fn();
  } finally {
    u.createObjectURL = prev;
  }
  return seen;
}

beforeEach(() => {
  restore = useNodeBlobs();
  flash.mockReset();
  setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
});
afterEach(() => {
  restore();
  resetScheduleSource();
});

describe('FilesService', () => {
  it('adds a PDF, a note and an address to a trip, a leg and a day', async () => {
    const svc = make(provideFakeIdb());
    await svc.ensureReady();
    expect(svc.status()).toBe('ready');
    const pdf = await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('Hotel Alfonso.pdf', 1200));
    const note = await svc.addNote(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train }, 'Platform', ' Coach 4, seats 7–8 ');
    const addr = await svc.addAddress(SEVILLE_IDS.trip, { kind: 'day', dateKey: '2026-10-09' }, '', 'Calle Betis 12, Sevilla');
    if ('error' in pdf || 'error' in note || 'error' in addr) throw new Error('add');
    expect(pdf).toMatchObject({ kind: 'pdf', title: 'Hotel Alfonso', bytes: 1200, mime: 'application/pdf', scope: { kind: 'trip' } });
    expect(note).toMatchObject({ kind: 'note', text: 'Coach 4, seats 7–8', bytes: 0, blobId: null });
    expect(addr).toMatchObject({ kind: 'address', title: 'Address', text: 'Calle Betis 12, Sevilla' });
    expect(svc.forTrip(SEVILLE_IDS.trip)).toHaveLength(3);
    expect(svc.forScope(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train }).map(a => a.id)).toEqual([note.id]);
    expect(svc.forScope(SEVILLE_IDS.trip, { kind: 'day', dateKey: '2026-10-09' }).map(a => a.id)).toEqual([addr.id]);
    expect(svc.usage()).toEqual({ count: 3, bytes: 1200, byCategory: { passes: 0, pdfs: 1200, photos: 0, notes: 0, other: 0 } });
    const blobs = await withObjectUrls(async () => expect(await svc.objectUrl(pdf.blobId!)).toBe('blob:1'));
    expect(await blobs[0].text()).toBe('x'.repeat(1200));
    // a fresh service reads them back from IndexedDB
    expect(await svc.objectUrl('missing')).toBeNull();
  });

  it('counts passes, PDFs, photos, notes and other files in usage', async () => {
    const svc = make(provideFilesStore(new MemoryFilesStore()));
    await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('a.pdf', 10));
    await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('b.jpg', 20, 'image/jpeg'));
    await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('c.txt', 30, 'text/plain'));
    await svc.addNote(SEVILLE_IDS.trip, { kind: 'trip' }, 'n', 'x');
    await savePass();
    expect(svc.usage()).toEqual({ count: 5, bytes: 70, byCategory: { passes: 10, pdfs: 10, photos: 20, notes: 0, other: 30 } });
  });

  it('falls back to memory when IndexedDB is missing, and still works', async () => {
    const svc = make([]); // the app's own FILES_STORE factory
    expect(globalThis.indexedDB).toBeUndefined();
    await svc.ensureReady();
    expect(svc.status()).toBe('memory');
    const n = await svc.addNote(SEVILLE_IDS.trip, { kind: 'trip' }, 'Hotel', 'Room 12');
    expect('error' in n).toBe(false);
    expect(svc.attachments()).toHaveLength(1);
  });

  it('is read-only over a database from a newer version', async () => {
    const factory = new IDBFactory();
    const { db } = await openDb(FILES_DB, 99, upgradeFilesDb, factory);
    db.close();
    const svc = make(provideFakeIdb(factory));
    await svc.ensureReady();
    expect(svc.status()).toBe('readOnly');
    expect(await svc.addNote(SEVILLE_IDS.trip, { kind: 'trip' }, 'x', 'y')).toEqual({ error: 'readOnly' });
    expect(await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('a.pdf', 3))).toEqual({ error: 'readOnly' });
  });

  it('refuses files over 50 MB and reports a full disk without writing anything', async () => {
    const svc = make(provideFilesStore(new MemoryFilesStore({ quotaBytes: 100 })));
    const huge = { name: 'big.pdf', size: MAX_FILE_BYTES + 1, type: 'application/pdf' } as File;
    expect(await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, huge)).toEqual({ error: 'tooLarge' });
    expect(await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('a.pdf', 101))).toEqual({ error: 'quota' });
    expect(svc.attachments()).toEqual([]);
    expect('error' in (await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('a.pdf', 100)))).toBe(false);
  });

  it('checks free space before saving', async () => {
    const nav = globalThis.navigator as Navigator & { storage?: unknown };
    const prev = Object.getOwnPropertyDescriptor(nav, 'storage');
    Object.defineProperty(nav, 'storage', { configurable: true, value: { estimate: async () => ({ quota: 10e6, usage: 9e6 }) } });
    try {
      const svc = make(provideFilesStore(new MemoryFilesStore()));
      expect(await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('a.pdf', 1000))).toEqual({ error: 'quota' });
    } finally {
      if (prev) Object.defineProperty(nav, 'storage', prev);
      else delete (nav as { storage?: unknown }).storage;
    }
  });

  it('renames and moves, and deletes with Undo that restores the file and its blob', async () => {
    const store = new MemoryFilesStore();
    const svc = make(provideFilesStore(store));
    const a = await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('Train.pdf', 40));
    if ('error' in a) throw new Error(a.error);
    await svc.update(a.id, { title: 'Train tickets', scope: { kind: 'leg', legId: SEVILLE_IDS.train } });
    expect(svc.forScope(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train })[0].title).toBe('Train tickets');
    expect((await store.listAttachments())[0].scope).toEqual({ kind: 'leg', legId: SEVILLE_IDS.train });
    await svc.remove(a.id);
    expect(svc.attachments()).toEqual([]);
    expect(await store.getBlob(a.blobId!)).toBeNull();
    expect(flash).toHaveBeenCalledWith('File deleted', expect.objectContaining({ label: 'Undo' }));
    flash.mock.calls[0][1].run();
    await vi.waitFor(() => expect(svc.attachments().map(x => x.id)).toEqual([a.id]));
    expect((await store.getBlob(a.blobId!))!.size).toBe(40);
  });

  it('keeps prefs, sanitised, and in memory when storage is blocked', () => {
    const prefs = new MemoryStorage();
    prefs.setItem(FILES_PREFS_KEY, JSON.stringify({ includeInBackup: 'yes', compressPhotos: false }));
    const svc = make(provideFilesStore(new MemoryFilesStore()), { prefs });
    expect(svc.prefs()).toEqual({ includeInBackup: false, deletePassesAfterTrip: false, compressPhotos: false });
    svc.setPrefs({ includeInBackup: true });
    expect(JSON.parse(prefs.getItem(FILES_PREFS_KEY)!)).toEqual({ includeInBackup: true, deletePassesAfterTrip: false, compressPhotos: false });
    TestBed.resetTestingModule();
    const blocked = make(provideFilesStore(new MemoryFilesStore()), { prefs: new BlockedStorage() });
    blocked.setPrefs({ deletePassesAfterTrip: true });
    expect(blocked.prefs().deletePassesAfterTrip).toBe(true);
    expect(sanitizeFilesPrefs(null)).toEqual({ includeInBackup: false, deletePassesAfterTrip: false, compressPhotos: true });
  });

  it('counts and removes files and passes of deleted trips', async () => {
    const svc = make(provideFilesStore(new MemoryFilesStore()));
    await svc.addFile('gone-trip', { kind: 'trip' }, textFile('old.pdf', 70));
    await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('keep.pdf', 5));
    await savePass(BCBP_MINIMAL, 'gone-trip');
    expect(svc.orphans([SEVILLE_IDS.trip])).toEqual({ count: 2, bytes: 80 });
    expect(await svc.removeOrphans([SEVILLE_IDS.trip])).toBe(2);
    expect(svc.orphans([SEVILLE_IDS.trip])).toEqual({ count: 0, bytes: 0 });
    expect(svc.attachments()).toHaveLength(1);
    expect(TestBed.inject(PassesService).passes()).toEqual([]);
  });

  it('never opens HTML or SVG in a tab: they download as application/octet-stream', async () => {
    const svc = make(provideFilesStore(new MemoryFilesStore()));
    const html = await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('confirmation.html', 10, 'text/html'));
    const svg = await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('photo.svg', 10, 'image/svg+xml'));
    const pdf = await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('Hotel.pdf', 10));
    if ('error' in html || 'error' in svg || 'error' in pdf) throw new Error('add');
    expect(svg.kind).toBe('file');
    const win = TestBed.inject(DOCUMENT).defaultView!;
    const opened = vi.spyOn(win, 'open').mockReturnValue({} as Window);
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    try {
      const blobs = await withObjectUrls(async () => {
        await svc.open(html);
        await svc.open(svg);
        await svc.open(pdf);
      });
      expect(blobs.map(b => b.type)).toEqual(['application/octet-stream', 'application/octet-stream', 'application/pdf']);
      expect(opened).toHaveBeenCalledTimes(1);
      expect(clicks).toEqual(['confirmation.html', 'photo.svg']);
      // object URLs for <img> are re-typed the same way
      const typed = await withObjectUrls(() => svc.objectUrl(html.blobId!, html.mime));
      expect(typed[0].type).toBe('application/octet-stream');
    } finally {
      opened.mockRestore();
      click.mockRestore();
    }
  });

  it('keeps the sheet informed when a save fails', async () => {
    const store = new MemoryFilesStore();
    const svc = make(provideFilesStore(store));
    const a = await svc.addNote(SEVILLE_IDS.trip, { kind: 'trip' }, 'Platform', 'Coach 4');
    if ('error' in a) throw new Error(a.error);
    vi.spyOn(store, 'putAttachment').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect(await svc.update(a.id, { text: 'Coach 5' })).toBe('quota');
    expect(svc.attachments()[0].text).toBe('Coach 4');
    expect(await svc.update(a.id, { text: 'Coach 5' })).toBeNull();
    expect(svc.attachments()[0].text).toBe('Coach 5');
  });

  it('opens an address in Google Maps', () => {
    expect(mapsUrl('Calle Betis 12, Sevilla')).toBe('https://www.google.com/maps/search/?api=1&query=Calle%20Betis%2012%2C%20Sevilla');
  });

  it('pure helpers', () => {
    expect(kindForMime('application/pdf')).toBe('pdf');
    expect(kindForMime('image/heic')).toBe('image');
    expect(kindForMime('text/plain')).toBe('file');
    expect(kindForMime('image/svg+xml')).toBe('file');
    expect(kindForMime('image/PNG')).toBe('image');
    expect(titleFromName('Train tickets.pdf')).toBe('Train tickets');
    expect(titleFromName('.env')).toBe('.env');
    expect(summarizeUsage([attachment({ kind: 'address', bytes: 0 })], 0, 0).count).toBe(1);
  });
});

describe('backup with files', () => {
  async function seeded(): Promise<FilesService> {
    const svc = make(provideFilesStore(new MemoryFilesStore()));
    await svc.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('Hotel.pdf', 7));
    await svc.addFile(SEVILLE_IDS.trip, { kind: 'day', dateKey: '2026-10-09' }, textFile('photo.png', 4, 'image/png'));
    await svc.addNote(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train }, 'Platform', 'Coach 4');
    await savePass(BCBP_MINIMAL);
    await savePass(BCBP_FULL);
    return svc;
  }

  it('refuses to export while "Include files in backups" is off', async () => {
    const svc = await seeded();
    await expect(svc.exportWithFiles()).rejects.toThrow();
  });

  it('exports trips and attachments with base64 data, and never a pass', async () => {
    const svc = await seeded();
    svc.setPrefs({ includeInBackup: true });
    const text = await (await svc.exportWithFiles()).text();
    const json = JSON.parse(text);
    expect(json.kind).toBe('routes-backup');
    expect(json.schema).toBe(1);
    expect(json.trips.map((t: { id: string }) => t.id)).toEqual([SEVILLE_IDS.trip]);
    expect(json.flightlog).toBeTruthy();
    expect(json.files.schema).toBe(1);
    expect(json.files.attachments).toHaveLength(3);
    const pdf = json.files.attachments.find((e: { meta: { title: string } }) => e.meta.title === 'Hotel');
    expect(atob(pdf.data)).toBe('xxxxxxx');
    expect(json.files.attachments.find((e: { meta: { kind: string } }) => e.meta.kind === 'note').data).toBeNull();
    for (const banned of ['ABC123', 'XK7Q2B', BCBP_MINIMAL, 'M1DOE', 'TREMBLAY', 'pass image', '"passes"']) {
      expect(text, banned).not.toContain(banned);
    }
    expect(svc.backupFilename()).toBe('routes-backup-with-files-2026-10-01.json');
    // the trips part is the same as "Export trips"
    const plain = JSON.parse(TestBed.inject(TripsService).exportBackup());
    expect(json.trips).toEqual(plain.trips);
    expect(json.flightlog).toEqual(plain.flightlog);
  });

  it('imports into empty storage, then a second import adds nothing', async () => {
    const svc = await seeded();
    svc.setPrefs({ includeInBackup: true });
    const backup = await svc.exportWithFiles();
    TestBed.resetTestingModule();
    const fresh = make(provideFilesStore(new MemoryFilesStore()), { trips: new MemoryStorage() });
    expect(TestBed.inject(TripsService).trips()).toEqual([]);
    const first = await fresh.importWithFiles(backup);
    expect(first).toEqual({ trips: { added: 1, updated: 0 }, files: { added: 3, skipped: 0 } });
    expect(fresh.attachments()).toHaveLength(3);
    const pdf = fresh.attachments().find(a => a.title === 'Hotel')!;
    const blobs = await withObjectUrls(() => fresh.objectUrl(pdf.blobId!));
    expect(await blobs[0].text()).toBe('xxxxxxx');
    expect(TestBed.inject(PassesService).passes()).toEqual([]);
    const second = await fresh.importWithFiles(backup);
    expect(second).toEqual({ trips: { added: 0, updated: 0 }, files: { added: 0, skipped: 3 } });
  });

  it('plain "Import trips" reads a backup with files (the extra key is ignored)', async () => {
    const svc = await seeded();
    svc.setPrefs({ includeInBackup: true });
    const text = await (await svc.exportWithFiles()).text();
    TestBed.resetTestingModule();
    make(provideFilesStore(new MemoryFilesStore()), { trips: new MemoryStorage() });
    expect(TestBed.inject(TripsService).importBackup(text)).toEqual({ added: 1, updated: 0 });
  });

  it('skips attachments whose trip is not in the backup or on the phone', async () => {
    const svc = make(provideFilesStore(new MemoryFilesStore()));
    const base = JSON.parse(TestBed.inject(TripsService).exportBackup());
    base.files = { schema: 1, attachments: [
      { meta: attachment({ id: 'a1', tripId: 'nope', blobId: null, kind: 'note', bytes: 0 }), data: null },
      { meta: attachment({ id: 'a2', blobId: 'b2' }), data: 'not base64!' },
      { meta: attachment({ id: 'a3', blobId: null, kind: 'note', bytes: 0 }), data: null },
    ] };
    const r = await svc.importWithFiles(new Blob([JSON.stringify(base)]));
    expect(r).toEqual({ trips: { added: 0, updated: 0 }, files: { added: 1, skipped: 2 } });
    expect(await svc.importWithFiles(new Blob(['nope']))).toEqual({ error: "This file isn't a Routes backup." });
  });

  it('imports a crafted entry safely: kind follows mime, never HTML as a PDF; empty files survive', async () => {
    const svc = make(provideFilesStore(new MemoryFilesStore()));
    const base = JSON.parse(TestBed.inject(TripsService).exportBackup());
    base.files = { schema: 1, attachments: [
      { meta: attachment({ id: 'h1', blobId: 'b1', kind: 'pdf', mime: 'text/html', title: 'Train tickets' }), data: btoa('<script>x</script>') },
      { meta: attachment({ id: 's1', blobId: 'b2', kind: 'image', mime: 'image/svg+xml' }), data: btoa('<svg/>') },
      { meta: attachment({ id: 'e1', blobId: 'b3', kind: 'pdf', mime: 'application/pdf' }), data: '' },
      { meta: attachment({ id: 'm1', blobId: 'b4', kind: 'image', mime: 'image/png; x="<b>"' }), data: btoa('png') },
    ] };
    const r = await svc.importWithFiles(new Blob([JSON.stringify(base)]));
    expect(r).toEqual({ trips: { added: 0, updated: 0 }, files: { added: 4, skipped: 0 } });
    const by = (id: string) => svc.attachments().find(a => a.id === id)!;
    expect([by('h1').kind, by('h1').mime]).toEqual(['file', 'text/html']);
    expect([by('s1').kind, by('s1').mime]).toEqual(['file', 'image/svg+xml']);
    expect([by('e1').kind, by('e1').bytes]).toEqual(['pdf', 0]);
    expect([by('m1').kind, by('m1').mime]).toEqual(['file', 'application/octet-stream']);
  });

  it('a share link never carries a saved pass', async () => {
    await seeded();
    const payload = await encodeTripShare(SEVILLE_TRIP, [], NOW_MS);
    expect(payload).not.toContain('ABC123');
    const decoded = await decodeTripShare(payload);
    expect(JSON.stringify(decoded)).not.toContain('ABC123');
    expect(JSON.stringify(decoded)).not.toContain('XK7Q2B');
  });
});

describe('FilesDb', () => {
  it('opens the store once and reports errors', async () => {
    let opens = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: FILES_STORE, useValue: async () => { opens++; throw new Error('blocked'); } }],
    });
    const db = TestBed.inject(FilesDb);
    expect(db.status()).toBe('idle');
    expect(await db.store()).toBeNull();
    expect(await db.store()).toBeNull();
    expect(opens).toBe(1);
    expect(db.status()).toBe('error');
  });

  it('switches to error and tells the user when another tab upgrades', async () => {
    const factory = new IDBFactory();
    let store: FilesStore | null = null;
    TestBed.configureTestingModule({
      providers: [
        { provide: AppStateService, useValue: { flash } },
        { provide: FILES_STORE, useValue: async (h: { onVersionChange: () => void }) => (store = await IdbFilesStore.open({ factory, onVersionChange: h.onVersionChange })) },
      ],
    });
    const db = TestBed.inject(FilesDb);
    await db.store();
    expect(db.status()).toBe('ready');
    const { db: other } = await openDb(FILES_DB, 2, () => undefined, factory);
    expect(db.status()).toBe('error');
    expect(flash).toHaveBeenCalledWith('Routes was updated in another tab. Reload to keep using files.', undefined);
    other.close();
    expect(store).not.toBeNull();
    expect(STORES.blobs).toBe('blobs');
  });
});
