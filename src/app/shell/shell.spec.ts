import { describe, it, expect, afterEach, vi } from 'vitest';
import { stageDeepLink } from './deep-link';
import { hasSkywash, hidesTopNav, isDetailPath, isPassView, navSection } from './nav-model';
import { SHORTCUTS } from './shortcuts-sheet.component';

describe('nav-model', () => {
  it('isPassView matches pass views and the add flow only', () => {
    expect(isPassView('/trips/t1/pass/p1')).toBe(true);
    expect(isPassView('/trips/t1/passes/add')).toBe(true);
    expect(isPassView('/passes/p1')).toBe(true);
    expect(isPassView('/trips/t1')).toBe(false);
    expect(isPassView('/saved')).toBe(false);
  });

  it('maps paths to nav sections and chrome', () => {
    expect(navSection('/')).toBe('explore');
    expect(navSection('/to/LIS')).toBe('explore');
    expect(navSection('/flight/LIS/2026-10-01')).toBe('explore');
    expect(navSection('/map')).toBe('map');
    expect(navSection('/saved')).toBe('trips');
    expect(navSection('/trips')).toBe('trips');
    expect(navSection('/trips/abc/recover')).toBe('trips');
    expect(navSection('/today')).toBe('trips');
    expect(navSection('/reach/gn-2510911')).toBe('explore');
    expect(navSection('/calendar/CUN')).toBe('calendar');
    expect(['/to/LIS', '/flight/LIS/2026-10-01/AC812', '/calendar', '/calendar/CUN'].every(isDetailPath)).toBe(true);
    expect(['/trips/abc', '/trips/abc/recover', '/trips/import', '/today', '/reach/gn-1', '/reach/gn-1/MAD'].every(isDetailPath)).toBe(true);
    expect(['/profile', '/trips/abc/files', '/trips/abc/passes/add', '/trips/abc/pass/p1', '/trips/abc/share'].every(isDetailPath)).toBe(true);
    expect(['/', '/map', '/saved', '/trips'].some(isDetailPath)).toBe(false);
    expect(hidesTopNav('/to/LIS')).toBe(true);
    expect(hidesTopNav('/flight/LIS/2026-10-01')).toBe(false);
    expect(['/', '/saved', '/flight/LIS/2026-10-01'].every(hasSkywash)).toBe(true);
    expect(['/trips', '/trips/abc', '/reach/gn-1', '/profile'].every(hasSkywash)).toBe(true);
    expect(['/to/LIS', '/map', '/calendar', '/today'].some(hasSkywash)).toBe(false);
  });

  it('lists Esc in the shortcuts', () => {
    expect(SHORTCUTS.some(s => s.keys.includes('Esc') && s.label === 'Back / close')).toBe(true);
  });
});

describe('stageDeepLink', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('stages Explore (global keys only) under a detail-page landing', () => {
    window.history.replaceState(null, '', '/to/LIS?from=YYZ&tab=map');
    const before = window.history.length;
    expect(stageDeepLink(window)).toBe(true);
    expect(window.location.pathname).toBe('/to/LIS');
    expect(window.location.search).toBe('?from=YYZ&tab=map');
    expect(window.history.length).toBe(before + 1);
  });

  it('turns a legacy ?dest= link into /to/CODE on top of Explore', () => {
    window.history.replaceState(null, '', '/?dest=pbi&from=YYZ');
    expect(stageDeepLink(window)).toBe(true);
    expect(window.location.pathname).toBe('/to/DJT');
    expect(window.location.search).toBe('?from=YYZ');
  });

  it('leaves Explore, unknown legacy codes and missing windows alone', () => {
    window.history.replaceState(null, '', '/?from=YYZ');
    expect(stageDeepLink(window)).toBe(false);
    window.history.replaceState(null, '', '/?dest=ZZZ');
    expect(stageDeepLink(window)).toBe(false);
    expect(stageDeepLink(null)).toBe(false);
    const broken = { location: { pathname: '/to/LIS', search: '', hash: '' }, history: { replaceState: () => { throw new Error('x'); } } };
    expect(stageDeepLink(broken as unknown as Window)).toBe(false);
  });

  it('leaves the history alone on a reload or back/forward load of an app entry', () => {
    window.history.replaceState({ navigationId: 3 }, '', '/to/LIS');
    const before = window.history.length;
    expect(stageDeepLink(window)).toBe(false);
    expect(window.history.length).toBe(before);
    const reload = {
      location: { pathname: '/to/LIS', search: '', hash: '' },
      history: { state: null, replaceState: vi.fn(), pushState: vi.fn() },
      performance: { getEntriesByType: () => [{ type: 'reload' }] },
    };
    expect(stageDeepLink(reload as unknown as Window)).toBe(false);
    expect(reload.history.pushState).not.toHaveBeenCalled();
  });
});
