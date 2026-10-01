import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PHOTO_FETCH, PhotoService } from './photo.service';
import { GeoService, LAND_FETCH } from './geo.service';
import { ShareService } from './share.service';
import { AppStateService } from './app-state.service';
import { PREFS_STORAGE } from './prefs.service';
import { MemoryStorage } from './testing';

describe('PhotoService', () => {
  function setup(fetcher: (url: string) => Promise<unknown>) {
    TestBed.configureTestingModule({ providers: [{ provide: PHOTO_FETCH, useValue: fetcher }] });
    return TestBed.inject(PhotoService);
  }

  it('loads credits.json and answers has/src/srcset/credit/position', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      version: 1,
      photos: { LIS: { author: 'A', source: 'unsplash', sourceUrl: 'u', license: 'Unsplash License', position: '50% 40%' } },
    });
    const photos = setup(fetcher);
    await photos.load();
    expect(fetcher).toHaveBeenCalledWith('img/dest/credits.json');
    expect(photos.loaded()).toBe(true);
    expect(photos.has('LIS')).toBe(true);
    expect(photos.has('LHR')).toBe(false);
    expect(photos.src('LIS')).toBe('img/dest/LIS.webp');
    expect(photos.src('LIS', 400)).toBe('img/dest/LIS-400.webp');
    expect(photos.srcset('LIS')).toBe('img/dest/LIS-400.webp 400w, img/dest/LIS.webp 960w');
    expect(photos.credit('LIS')?.author).toBe('A');
    expect(photos.credit('LHR')).toBeNull();
    expect(photos.position('LIS')).toBe('50% 40%');
    expect(photos.position('LHR')).toBe('50% 50%');
  });

  it('a failed or malformed manifest leaves no photos', async () => {
    const photos = setup(() => Promise.reject(new Error('offline')));
    await photos.load();
    expect(photos.loaded()).toBe(true);
    expect(photos.has('LIS')).toBe(false);
    photos.setManifest(null);
    expect(photos.has('LIS')).toBe(false);
    TestBed.resetTestingModule();
    const junk = setup(() => Promise.resolve({ nope: true }));
    await junk.load();
    expect(junk.has('LIS')).toBe(false);
  });
});

describe('GeoService', () => {
  it('fetches once, and retries after a failure', async () => {
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: LAND_FETCH, useValue: () => (++calls === 1 ? Promise.reject(new Error('x')) : Promise.resolve(null)) }],
    });
    const geo = TestBed.inject(GeoService);
    await geo.ensureLoaded();
    expect(geo.land()).toBeNull();
    await geo.ensureLoaded();
    await geo.ensureLoaded();
    expect(calls).toBe(2);
  });
});

describe('ShareService', () => {
  const nav = window.navigator as Navigator & { share?: unknown; clipboard?: unknown };
  afterEach(() => {
    Object.defineProperty(nav, 'share', { configurable: true, value: undefined });
    Object.defineProperty(nav, 'clipboard', { configurable: true, value: undefined });
  });

  function setup() {
    TestBed.configureTestingModule({ providers: [{ provide: PREFS_STORAGE, useValue: new MemoryStorage() }] });
    return { share: TestBed.inject(ShareService), state: TestBed.inject(AppStateService) };
  }

  it('uses Web Share when available, and stays quiet when cancelled', async () => {
    const { share, state } = setup();
    const fn = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'share', { configurable: true, value: fn });
    await share.share('YUL → LIS · Lisbon');
    expect(fn).toHaveBeenCalledWith({ title: 'YUL → LIS · Lisbon', url: window.location.href });
    fn.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
    await share.share('x');
    expect(state.notice()).toBeNull();
  });

  it('falls back to the clipboard and confirms, or reports a failure', async () => {
    const { share, state } = setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new Error('no')) });
    Object.defineProperty(nav, 'clipboard', { configurable: true, value: { writeText } });
    await share.share('x');
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(state.notice()?.message).toBe('Link copied');
    Object.defineProperty(nav, 'share', { configurable: true, value: undefined });
    Object.defineProperty(nav, 'clipboard', { configurable: true, value: undefined });
    await share.share('x');
    expect(state.notice()?.message).toBe('Could not copy the link');
    state.dismissNotice();
  });
});
