import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_HUB, DEFAULT_PREFS, PREFS_KEY, PREFS_STORAGE, PrefsService, applyTheme, sanitizePrefs } from './prefs.service';
import { BlockedStorage, MemoryStorage } from './testing';

function setup(storage: Storage | null): PrefsService {
  TestBed.configureTestingModule({ providers: [{ provide: PREFS_STORAGE, useValue: storage }] });
  return TestBed.inject(PrefsService);
}

describe('sanitizePrefs', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs('nope')).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs([1, 2])).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and drops invalid ones independently', () => {
    const p = sanitizePrefs({
      hub: 'YVR', region: 'Mars', showConnections: false, theme: 'neon', timeFormat: '12h',
      minConnect: 90, maxLayover: 7, allowOvernight: 'yes', favourites: ['LHR', 'XXX', 'LHR', 42, 'ATH', 'PBI'],
    });
    expect(p).toEqual({
      hub: 'YVR', region: 'All', showConnections: false, theme: 'auto', timeFormat: '12h',
      minConnect: 90, maxLayover: 360, allowOvernight: false, favourites: ['LHR', 'ATH', 'DJT'],
    });
  });

  it('accepts the Starred pseudo-region', () => {
    expect(sanitizePrefs({ region: 'Starred' }).region).toBe('Starred');
  });

  it('uses YUL as the single default hub', () => {
    expect(DEFAULT_HUB).toBe('YUL');
    expect(sanitizePrefs({ hub: 'Toronto' }).hub).toBe('YUL');
  });
});

describe('PrefsService', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('loads saved prefs from ac.prefs.v1', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ hub: 'YYZ', theme: 'dark', favourites: ['LHR'] }));
    const prefs = setup(storage);
    expect(prefs.hub()).toBe('YYZ');
    expect(prefs.theme()).toBe('dark');
    expect(prefs.favourites()).toEqual(['LHR']);
  });

  it('survives malformed JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_KEY, '{not json');
    expect(setup(storage).prefs()).toEqual(DEFAULT_PREFS);
  });

  it('persists every update synchronously', () => {
    const storage = new MemoryStorage();
    const prefs = setup(storage);
    prefs.update({ hub: 'YHZ', showConnections: false });
    expect(JSON.parse(storage.getItem(PREFS_KEY)!)).toMatchObject({ hub: 'YHZ', showConnections: false });
  });

  it('rejects invalid updates field by field', () => {
    const prefs = setup(new MemoryStorage());
    prefs.update({ hub: 'ZZZ', minConnect: 90 });
    expect(prefs.hub()).toBe('YUL');
    expect(prefs.prefs().minConnect).toBe(90);
  });

  it('works in memory when storage is blocked', () => {
    const prefs = setup(new BlockedStorage());
    expect(prefs.prefs()).toEqual(DEFAULT_PREFS);
    expect(() => prefs.update({ hub: 'YVR' })).not.toThrow();
    expect(prefs.hub()).toBe('YVR');
  });

  it('works with no storage at all', () => {
    const prefs = setup(null);
    prefs.toggleFavourite('LHR');
    expect(prefs.favourites()).toEqual(['LHR']);
  });

  it('toggles favourites', () => {
    const prefs = setup(new MemoryStorage());
    prefs.toggleFavourite('LHR');
    prefs.toggleFavourite('ATH');
    expect(prefs.favourites()).toEqual(['LHR', 'ATH']);
    expect(prefs.isFavourite('LHR')).toBe(true);
    prefs.toggleFavourite('LHR');
    expect(prefs.favourites()).toEqual(['ATH']);
    prefs.toggleFavourite('NOPE');
    expect(prefs.favourites()).toEqual(['ATH']);
  });

  it('reset restores defaults but keeps favourites', () => {
    const prefs = setup(new MemoryStorage());
    prefs.update({ hub: 'YVR', theme: 'dark', minConnect: 120, favourites: ['LHR'] });
    prefs.reset();
    expect(prefs.prefs()).toEqual({ ...DEFAULT_PREFS, favourites: ['LHR'] });
  });

  it('cycles theme auto → light → dark → auto', () => {
    const prefs = setup(new MemoryStorage());
    const seen = [prefs.theme()];
    for (let i = 0; i < 3; i++) {
      prefs.cycleTheme();
      seen.push(prefs.theme());
    }
    expect(seen).toEqual(['auto', 'light', 'dark', 'auto']);
  });

  it('keeps connectOptions identity until a connection pref changes', () => {
    const prefs = setup(new MemoryStorage());
    const a = prefs.connectOptions();
    prefs.update({ theme: 'dark' });
    expect(prefs.connectOptions()).toBe(a);
    prefs.update({ minConnect: 90 });
    expect(prefs.connectOptions()).not.toBe(a);
    expect(prefs.connectOptions()).toEqual({ minConnect: 90, maxLayover: 360, allowOvernight: false });
  });

  it('applies the theme to <html data-theme> through an effect', () => {
    const prefs = setup(new MemoryStorage());
    prefs.setTheme('dark');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    prefs.setTheme('auto');
    TestBed.tick();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('applyTheme', () => {
  let metas: HTMLMetaElement[];
  beforeEach(() => {
    metas = ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'].map(media => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      m.setAttribute('media', media);
      document.head.appendChild(m);
      return m;
    });
  });
  afterEach(() => {
    metas.forEach(m => m.remove());
    document.documentElement.removeAttribute('data-theme');
  });

  it('forces both theme-color metas for a fixed theme and restores them for auto', () => {
    applyTheme(document, 'dark');
    expect(metas.map(m => m.content)).toEqual(['#0F2238', '#0F2238']);
    applyTheme(document, 'light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(metas.map(m => m.content)).toEqual(['#CFE6FF', '#CFE6FF']);
    applyTheme(document, 'auto');
    expect(metas.map(m => m.content)).toEqual(['#CFE6FF', '#0F2238']);
  });
});
