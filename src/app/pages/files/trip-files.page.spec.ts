import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FilesService, FILES_PREFS_STORAGE } from '../../files/files.service';
import { MemoryFilesStore, provideFilesStore, textFile, useNodeBlobs } from '../../files/testing/files-testing';
import { TripExtrasComponent } from '../../files/ui/trip-extras.component';
import { LegFilesComponent } from '../../files/ui/leg-files.component';
import { SettingsFilesBodyComponent, orphansLine, settingsUsageLine } from '../../files/ui/settings-files-body.component';
import { PassesService } from '../../passes/passes.service';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIP, SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { toUtcMs } from '../../utils/time';
import { TripFilesPage } from './trip-files.page';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
let restoreBlobs: () => void;
let store: MemoryFilesStore;

function configure(quotaBytes?: number) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  store = new MemoryFilesStore(quotaBytes === undefined ? {} : { quotaBytes });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: FILES_PREFS_STORAGE, useValue: new MemoryStorage() },
      provideFilesStore(store),
    ],
  });
}

async function seed() {
  const files = TestBed.inject(FilesService);
  await files.ensureReady();
  await files.addFile(SEVILLE_IDS.trip, { kind: 'trip' }, textFile('Travel insurance.pdf', 4000));
  await files.addFile(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train }, textFile('Train tickets.pdf', 2000));
  await files.addAddress(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train }, 'Apartment address', 'Calle Ejemplo 12, Seville');
  await files.addNote(SEVILLE_IDS.trip, { kind: 'day', dateKey: '2026-10-10' }, 'Note', 'Alcázar tickets: 10:30 slot');
  const passes = TestBed.inject(PassesService);
  for (const [seat, first] of [['34K', 'ALEX'], ['34J', 'SAM']]) {
    await passes.save({
      tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw: 'M1EXAMPLE/' + first, format: 'PDF417',
      bcbpLeg: 0, lastName: 'EXAMPLE', firstName: first, pnr: 'ABC123', from: 'YUL', to: 'MAD', flightNumber: 'AC834', julian: 281,
      dateKey: '2026-10-08', cabin: 'Y', seat, sequence: '0045', source: 'image', page: null, deleteAfterTrip: false,
    }, new Blob(['pass image ' + first], { type: 'image/png' }));
  }
}

async function render() {
  const fixture = TestBed.createComponent(TripFilesPage);
  fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
  await fixture.whenStable();
  await new Promise(r => setTimeout(r));
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, stable };
}

describe('TripFilesPage', () => {
  beforeEach(() => {
    restoreBlobs = useNodeBlobs();
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    (globalThis as { URL: typeof URL }).URL.createObjectURL ??= () => 'blob:x';
    (globalThis as { URL: typeof URL }).URL.revokeObjectURL ??= () => undefined;
  });
  afterEach(() => {
    resetScheduleSource();
    restoreBlobs();
    vi.restoreAllMocks();
  });

  it('shows the usage card, the groups in order and the passes row (Not shared, no PNR)', async () => {
    configure();
    await seed();
    const { el } = await render();
    expect(clean(el.querySelector('h1')?.textContent)).toBe('Files');
    expect(clean(el.querySelector('[data-usage-title]')?.textContent)).toMatch(/^6 files · \d+(\.\d)? KB$/);
    const usage = TestBed.inject(FilesService).usage();
    expect(usage.bytes).toBe(4000 + 2000 + 'pass image ALEX'.length + 'pass image SAM'.length);
    expect(clean(el.querySelector('[data-legend]')?.textContent)).toContain('PDFs');
    expect([...el.querySelectorAll('.tf__day h2')].map(h => clean(h.textContent))).toEqual([
      'Whole trip', 'Thu Oct 8 · AC834 YUL → MAD', 'Fri Oct 9 · Madrid → Seville', 'Sat Oct 10',
      'Mon Oct 12 · Seville → Lisbon', 'Tue Oct 13 · AC813 LIS → YUL',
    ]);
    const passRow = clean(el.querySelector('[data-passes]')?.textContent);
    expect(clean(el.querySelector('[data-passes] .m')?.textContent)).toMatch(/^2 passes · seat (34K, 34J|34J, 34K)$/);
    expect(clean(el.querySelector('[data-passes] .lock')?.textContent)).toBe('Not shared');
    expect(passRow).toContain('Boarding passes');
    expect(el.textContent).not.toContain('ABC123');
    expect(el.querySelectorAll('[data-empty-leg]')).toHaveLength(2);
    expect(clean(el.querySelector('[data-backup-state]')?.textContent)).toBe('Off · passes are never shared');
  });

  it('the backup switch writes the pref', async () => {
    configure();
    const { el, stable } = await render();
    const sw = el.querySelector<HTMLInputElement>('[data-backup]')!;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    await stable();
    expect(TestBed.inject(FilesService).prefs().includeInBackup).toBe(true);
    expect(clean(el.querySelector('[data-backup-state]')?.textContent)).toBe('On · passes are never included');
  });

  it('adds a note from the add sheet to the chosen target', async () => {
    configure();
    const { el, stable } = await render();
    const flash = vi.spyOn(TestBed.inject(AppStateService), 'flash');
    el.querySelector<HTMLButtonElement>('[data-day="2026-10-12"] [data-empty-leg]')!.click();
    await stable();
    const sheet = () => document.querySelector('app-add-file-sheet') as HTMLElement;
    expect((sheet().querySelector('[data-target]') as HTMLSelectElement).value).toBe(`leg:${SEVILLE_IDS.bus}`);
    sheet().querySelector<HTMLButtonElement>('[data-add-note]')!.click();
    await stable();
    sheet().querySelector<HTMLTextAreaElement>('[data-body]')!.value = 'Door code 4512';
    sheet().querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await stable();
    await stable();
    const files = TestBed.inject(FilesService);
    expect(files.forScope(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.bus }).map(a => [a.kind, a.title, a.text]))
      .toEqual([['note', 'Note', 'Door code 4512']]);
    expect(flash).toHaveBeenCalledWith('Saved to Seville → Lisbon');
    expect(clean(el.textContent)).toContain('Door code 4512');
  });

  it('a quota error shows the quota copy and saves nothing', async () => {
    configure(1000);
    const { el, stable } = await render();
    el.querySelector<HTMLButtonElement>('[data-add]')!.click();
    await stable();
    const sheet = document.querySelector('app-add-file-sheet') as HTMLElement;
    const input = sheet.querySelector<HTMLInputElement>('[data-add-file]')!;
    Object.defineProperty(input, 'files', { value: [textFile('Big.pdf', 5000)], configurable: true });
    input.dispatchEvent(new Event('change'));
    await stable();
    await stable();
    expect(clean(sheet.querySelector('[data-error]')?.textContent)).toMatch(/^Not enough space on this phone for this file \(5 KB\)\./);
    expect(TestBed.inject(FilesService).attachments()).toHaveLength(0);
  });

  it('Move to… persists the new scope; Delete flashes Undo, which restores the file and its blob', async () => {
    configure();
    await seed();
    const { el, stable } = await render();
    const files = TestBed.inject(FilesService);
    const train = files.attachments().find(a => a.title === 'Train tickets')!;
    el.querySelector<HTMLButtonElement>(`[data-item="${train.id}"] [data-item-more]`)!.click();
    await stable();
    const sheet = () => document.querySelector('app-file-item-sheet') as HTMLElement;
    sheet().querySelector<HTMLButtonElement>('[data-act="move"]')!.click();
    await stable();
    const radio = sheet().querySelector<HTMLInputElement>('input[value="day:2026-10-10"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await stable();
    sheet().querySelector<HTMLButtonElement>('[data-move-save]')!.click();
    await stable();
    expect(files.attachments().find(a => a.id === train.id)!.scope).toEqual({ kind: 'day', dateKey: '2026-10-10' });
    expect((await store.listAttachments()).find(a => a.id === train.id)!.scope).toEqual({ kind: 'day', dateKey: '2026-10-10' });

    const flash = vi.spyOn(TestBed.inject(AppStateService), 'flash');
    el.querySelector<HTMLButtonElement>(`[data-item="${train.id}"] [data-item-more]`)!.click();
    await stable();
    sheet().querySelector<HTMLButtonElement>('[data-act="delete"]')!.click();
    await stable();
    await stable();
    expect(files.attachments().some(a => a.id === train.id)).toBe(false);
    expect(await store.getBlob(train.blobId!)).toBeNull();
    const [msg, action] = flash.mock.calls[0];
    expect(msg).toBe('File deleted');
    action!.run();
    await stable();
    await stable();
    expect(files.attachments().some(a => a.id === train.id)).toBe(true);
    expect(await (await store.getBlob(train.blobId!))!.text()).toBe('x'.repeat(2000));
  });

  it('an address opens the maps search', async () => {
    configure();
    await seed();
    const { el, stable } = await render();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const addr = TestBed.inject(FilesService).attachments().find(a => a.kind === 'address')!;
    el.querySelector<HTMLButtonElement>(`[data-item="${addr.id}"] .row__main`)!.click();
    await stable();
    expect(open).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=Calle%20Ejemplo%2012%2C%20Seville', '_blank', 'noopener');
  });
});

describe('trip extras, leg files and settings files', () => {
  beforeEach(() => {
    restoreBlobs = useNodeBlobs();
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  });
  afterEach(() => {
    resetScheduleSource();
    restoreBlobs();
    vi.restoreAllMocks();
  });

  async function host<T>(cmp: new (...a: never[]) => T, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(cmp);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    const stable = async () => {
      await new Promise(r => setTimeout(r));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await stable();
    return { el: fixture.nativeElement as HTMLElement, stable };
  }

  it('chips: "Add pass" and "Files" when empty; counts and links when there are some', async () => {
    configure();
    const empty = await host(TripExtrasComponent, { trip: SEVILLE_TRIP });
    expect(clean(empty.el.querySelector('[data-chip="passes"]')?.textContent)).toBe('Add pass');
    expect(empty.el.querySelector('[data-chip="passes"]')!.getAttribute('href')).toBe('/trips/sevtrip001/passes/add');
    expect(clean(empty.el.querySelector('[data-chip="files"]')?.textContent)).toBe('Files');
    await seed();
    await empty.stable();
    expect(clean(empty.el.querySelector('[data-chip="passes"]')?.textContent)).toBe('Passes · 2');
    const first = TestBed.inject(PassesService).passes()[0].id;
    expect(empty.el.querySelector('[data-chip="passes"]')!.getAttribute('href')).toBe(`/trips/sevtrip001/pass/${first}`);
    expect(clean(empty.el.querySelector('[data-chip="files"]')?.textContent)).toBe('Files · 4');
    expect(empty.el.querySelector('[data-chip="files"]')!.getAttribute('href')).toBe('/trips/sevtrip001/files');
  });

  it('leg files: the leg\'s rows, the day link, and Add a file saves to the leg', async () => {
    configure();
    await seed();
    const train = SEVILLE_TRIP.legs.find(l => l.id === SEVILLE_IDS.train)!;
    const { el, stable } = await host(LegFilesComponent, { trip: SEVILLE_TRIP, leg: train });
    expect([...el.querySelectorAll('.lf__tx b')].map(b => clean(b.textContent)).sort()).toEqual(['Apartment address', 'Train tickets']);
    expect(el.querySelector('[data-see-all]')!.getAttribute('href')).toBe('/trips/sevtrip001/files?day=2026-10-09');
    const input = el.querySelector<HTMLInputElement>('[data-leg-add]')!;
    Object.defineProperty(input, 'files', { value: [textFile('Seat map.pdf', 10)], configurable: true });
    input.dispatchEvent(new Event('change'));
    await stable();
    await stable();
    expect(TestBed.inject(FilesService).forScope(SEVILLE_IDS.trip, { kind: 'leg', legId: SEVILLE_IDS.train }).map(a => a.title))
      .toContain('Seat map');
  });

  it('settings: usage, the toggle reveals export/import, export has no passes, orphans delete after confirming', async () => {
    configure();
    await seed();
    const files = TestBed.inject(FilesService);
    await files.addNote('deletedtrip', { kind: 'trip' }, 'Old', 'gone');
    const { el, stable } = await host(SettingsFilesBodyComponent);
    expect(clean(el.querySelector('[data-files-usage]')?.textContent)).toMatch(/· 7 files in 2 trips$/);
    expect(el.querySelector('[data-sf-export]')).toBeNull();
    const sw = el.querySelector<HTMLInputElement>('[data-sf-backup]')!;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    await stable();
    expect(el.querySelector('[data-sf-export]')).toBeTruthy();
    expect(el.querySelector('[data-sf-import]')).toBeTruthy();
    const json = await (await files.exportWithFiles()).text();
    expect(json).not.toContain('ABC123');
    expect(json).not.toContain('"passes"');

    expect(clean(el.querySelector('[data-sf-orphans] .hint')?.textContent)).toBe('1 file from deleted trips · 0 B');
    el.querySelector<HTMLButtonElement>('[data-sf-orphans-delete]')!.click();
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sf-orphans-confirm]')!.click();
    await stable();
    await stable();
    expect(files.attachments().some(a => a.tripId === 'deletedtrip')).toBe(false);
    expect(el.querySelector('[data-sf-orphans]')).toBeNull();
    expect(TestBed.inject(TripsService).trips()).toHaveLength(1);
  });

  it('settings copy helpers', () => {
    expect(settingsUsageLine(9, 14.2 * 1024 * 1024, 2)).toBe('14.2 MB · 9 files in 2 trips');
    expect(settingsUsageLine(0, 0, 0)).toBe('No files yet');
    expect(orphansLine(3, 4.1 * 1024 * 1024)).toBe('3 files from deleted trips · 4.1 MB');
  });
});
