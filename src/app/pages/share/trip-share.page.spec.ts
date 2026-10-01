import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import type { ShareOptions } from '../../share/trip-share-text';
import { pngHeader } from '../../share/testing/stub-canvas';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY, type Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import {
  SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip,
} from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { CARD_RENDERER, SHARE_ENV, TripSharePage } from './trip-share.page';

const NOW_MS = toUtcMs('2026-10-02', '10:00', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const png = () => new NodeBlob([pngHeader(1080, 1180)], { type: 'image/png' }) as unknown as Blob;

interface Env { navigator: Record<string, unknown>; document: Document }

async function render(opts: { env?: Partial<Env>; trip?: Trip } = {}) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify(opts.trip ? { schema: 1, trips: [opts.trip] } : SEVILLE_TRIPS_FILE));
  const renderer = vi.fn(async (_t: Trip, _o: ShareOptions) => png());
  const env: Env = { navigator: {}, document, ...opts.env };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: CARD_RENDERER, useValue: renderer },
      { provide: SHARE_ENV, useValue: () => env },
    ],
  });
  const state = TestBed.inject(AppStateService);
  const flash = vi.spyOn(state, 'flash');
  const fixture = TestBed.createComponent(TripSharePage);
  fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  await stable();
  await vi.waitFor(async () => {
    await stable();
    expect(el.querySelector('[data-preview] img')).toBeTruthy();
  });
  const text = (sel: string) => clean(el.querySelector(sel)?.textContent);
  const click = async (sel: string) => {
    (el.querySelector(sel) as HTMLElement).click();
    await stable();
  };
  const toggle = async (sel: string) => {
    const i = el.querySelector(sel) as HTMLInputElement;
    i.checked = !i.checked;
    i.dispatchEvent(new Event('change'));
    await stable();
  };
  const tab = (label: string) => click(`app-seg button:nth-child(${label === 'Image' ? 1 : 2})`);
  return { fixture, el, stable, text, click, toggle, tab, renderer, flash, env, state };
}

describe('TripSharePage', () => {
  let created: string[];
  beforeEach(() => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    created = [];
    URL.createObjectURL = vi.fn(() => { const u = `blob:card-${created.length}`; created.push(u); return u; });
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('image tab: header, the drawn card, the options, what is never included and the two buttons', async () => {
    const { el, text, renderer } = await render();
    expect(text('h1')).toBe('Share trip');
    expect([...el.querySelectorAll('app-seg button')].map(b => clean(b.textContent))).toEqual(['Image', 'Text']);
    const img = el.querySelector('[data-preview] img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:card-0');
    expect(img.getAttribute('height')).toBe('1180');
    expect(img.alt).toContain('Seville · Thu Oct 8 → Tue Oct 13');
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer.mock.calls[0][1]).toEqual({ includeSplitNote: true, includeBackups: false, fmt: '24h' });
    expect([...el.querySelectorAll('.ts__sw b')].map(b => clean(b.textContent))).toEqual(['Include "If we split up"', 'Include backups']);
    expect(text('.ts__sw:nth-child(2) .ts__muted')).toBe('AC822 BCN, AC812 LIS for Thu');
    expect([...el.querySelectorAll('[data-checklist] li')].map(l => clean(l.textContent))).toEqual([
      'Legs, times and your split-up note',
      'Never included: Boarding passes and booking codes',
      'Never included: Files and photos',
    ]);
    expect(text('[data-share]')).toBe('Share…');
    expect(text('[data-save]')).toBe('Save image');
    expect(el.querySelector('[data-copy]')).toBeNull();
  });

  it('redraws the card when an option changes and frees the old image', async () => {
    const { el, toggle, renderer } = await render();
    await toggle('[data-backups]');
    await vi.waitFor(() => expect((el.querySelector('[data-preview] img') as HTMLImageElement).getAttribute('src')).toBe('blob:card-1'));
    expect(renderer.mock.calls.at(-1)![1]).toEqual({ includeSplitNote: true, includeBackups: true, fmt: '24h' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card-0');
    await toggle('[data-split]');
    await vi.waitFor(() => expect(renderer.mock.calls.at(-1)![1].includeSplitNote).toBe(false));
    expect(clean(el.querySelector('[data-checklist] li')?.textContent)).toBe('Legs and times');
  });

  it('Share and Save are disabled while the card for new options is still drawing', async () => {
    const { el, toggle, renderer } = await render();
    let finish!: (b: Blob) => void;
    renderer.mockImplementationOnce(() => new Promise<Blob>(r => (finish = r)));
    await toggle('[data-split]');
    expect((el.querySelector('[data-share]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-save]') as HTMLButtonElement).disabled).toBe(true);
    finish(png());
    await vi.waitFor(() => expect((el.querySelector('[data-save]') as HTMLButtonElement).disabled).toBe(false));
  });

  it('text tab: the plain text follows the switches, with the lock note and "Copy text"', async () => {
    const { el, text, tab, toggle } = await render();
    await tab('Text');
    const pre = el.querySelector('[data-text]') as HTMLElement;
    expect(pre.textContent!.split('\n')).toEqual([
      'Seville · Thu Oct 8 → Tue Oct 13',
      'Thu AC834 YUL 17:55 → MAD 06:50+1 (scheduled, standby)',
      'Fri Madrid → Seville, train about 2h40 (estimated)',
      'Mon Seville → Lisbon, bus 09:00 → 14:45 (saved by me)',
      'Tue AC813 LIS 11:25 → YUL 13:50 (scheduled, standby)',
      'If we split up: Meet at Seville Santa Justa station. Whoever arrives first books the room.',
      'Times are local. A standby plan, not a booking.',
    ]);
    expect(text('[data-never]')).toBe('Booking codes, boarding passes and files are never added, even if you turn everything on.');
    expect(text('[data-copy]')).toBe('Copy text');
    await toggle('[data-split]');
    await toggle('[data-backups]');
    expect(el.querySelector('[data-text]')!.textContent).toContain('Backups for Thu: AC822 to BCN 18:35, AC812 to LIS 21:45');
    expect(el.querySelector('[data-text]')!.textContent).not.toContain('If we split up');
  });

  it('"Copy text" copies and flashes "Copied"', async () => {
    const writeText = vi.fn(async () => undefined);
    const { tab, click, flash } = await render({ env: { navigator: { clipboard: { writeText } } } });
    await tab('Text');
    await click('[data-copy]');
    await vi.waitFor(() => expect(flash).toHaveBeenCalledWith('Copied'));
    expect((writeText.mock.calls[0] as unknown[])[0]).toContain('Seville · Thu Oct 8');
  });

  it('"Share…" uses Web Share for the image when canShare allows files', async () => {
    const share = vi.fn(async (_: ShareData) => undefined);
    const canShare = vi.fn(() => true);
    const { click, flash } = await render({ env: { navigator: { share, canShare } } });
    await click('[data-share]');
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    const data = share.mock.calls[0][0];
    expect(data.files![0].name).toBe('routes-seville-2026-10-08.png');
    expect(data.title).toBe('Seville trip plan');
    expect(flash).not.toHaveBeenCalled();
  });

  it('without file sharing, "Share…" and "Save image" download routes-seville-2026-10-08.png', async () => {
    const anchors: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const n = orig(tag);
      if (tag === 'a') { anchors.push(n as HTMLAnchorElement); (n as HTMLAnchorElement).click = vi.fn(); }
      return n;
    });
    const { click, flash } = await render();
    await click('[data-save]');
    expect(anchors.at(-1)!.download).toBe('routes-seville-2026-10-08.png');
    expect(flash).toHaveBeenCalledWith('Image saved');
    await click('[data-share]');
    await vi.waitFor(() => expect(flash).toHaveBeenCalledTimes(2));
    expect(anchors).toHaveLength(2);
  });

  it('text "Share…" opens the share sheet with the text', async () => {
    const share = vi.fn(async (_: ShareData) => undefined);
    const { tab, click } = await render({ env: { navigator: { share } } });
    await tab('Text');
    await click('[data-share]');
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].text).toContain('AC834 YUL 17:55');
  });

  it('hides the switches when there is no split note and no backups', async () => {
    const t = sevilleTrip();
    t.party.splitNote = '';
    for (const l of t.legs) if (l.kind === 'flight') l.alternates = [];
    const { el, text } = await render({ trip: t });
    expect(el.querySelector('.ts__opts')).toBeNull();
    expect(text('[data-checklist] li')).toBe('Legs and times');
  });

  it('never puts a booking code in the text or the card input, whatever the leg notes say', async () => {
    const t = sevilleTrip();
    for (const l of t.legs) l.note = 'PNR ABC123';
    const { el, tab, renderer, toggle } = await render({ trip: t });
    await toggle('[data-backups]');
    await tab('Text');
    expect(el.querySelector('[data-text]')!.textContent).not.toContain('ABC123');
    for (const [trip, o] of renderer.mock.calls) {
      const { tripShareText } = await import('../../share/trip-share-text');
      expect(tripShareText(trip, o)).not.toContain('ABC123');
    }
  });

  it('says so when the card cannot be drawn', async () => {
    const trips = new MemoryStorage();
    trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => NOW_MS },
        { provide: TRIPS_STORAGE, useValue: trips },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: CARD_RENDERER, useValue: async () => { throw new Error('no canvas'); } },
      ],
    });
    const fixture = TestBed.createComponent(TripSharePage);
    fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(clean(el.querySelector('.ts__fail')?.textContent)).toBe("The image couldn't be drawn on this browser. You can share the plan as text.");
    });
    expect((el.querySelector('[data-save]') as HTMLButtonElement).disabled).toBe(true);
  });
});
