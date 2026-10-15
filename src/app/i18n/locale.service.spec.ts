import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { PREFS_KEY, PREFS_STORAGE, PrefsService } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { locale, setLocale } from './locale';
import { CATALOGUE_LOADER, CatalogueLoader, LOCALE_BUDGET_MS, LocaleService } from './locale.service';
import { isCatalogueLoaded, loadCatalogue, t } from './t';
import { I18nTitleStrategy } from './title-strategy';

function setLanguages(langs: string[] | null): void {
  Object.defineProperty(window.navigator, 'languages', { configurable: true, get: () => langs ?? undefined });
}

@Component({ selector: 'app-blank', standalone: true, template: '' })
class BlankComponent {}

describe('LocaleService', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    setLanguages(['en-US']);
  });

  afterEach(() => {
    setLocale('en');
    document.documentElement.setAttribute('lang', 'en');
    setLanguages(null);
    delete (window.navigator as unknown as Record<string, unknown>)['languages'];
  });

  function create(): LocaleService {
    TestBed.configureTestingModule({ providers: [{ provide: PREFS_STORAGE, useValue: storage }] });
    return TestBed.inject(LocaleService);
  }

  it('follows the device by default and sets <html lang> at once', () => {
    setLanguages(['fr-CA', 'en-CA']);
    const svc = create();
    expect(svc.preference()).toBe('auto');
    expect(svc.locale()).toBe('fr');
    expect(locale()).toBe('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr-CA');
    expect(t('shell.nav.trips')).toBe('Voyages');
  });

  it('stays English on an English device', () => {
    create();
    expect(locale()).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('an explicit choice wins over the device, applies at once and is saved in prefs', () => {
    const svc = create();
    svc.setPreference('fr');
    expect(locale()).toBe('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr-CA');
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).language).toBe('fr');
    svc.setPreference('auto');
    expect(locale()).toBe('en');
  });

  it('reads a saved choice on start, and keeps it through a settings reset', () => {
    storage.setItem(PREFS_KEY, JSON.stringify({ language: 'fr' }));
    create();
    expect(locale()).toBe('fr');
    TestBed.inject(PrefsService).reset();
    expect(TestBed.inject(PrefsService).language()).toBe('fr');
  });

  it('follows a device language change while on Automatic', () => {
    const svc = create();
    setLanguages(['fr-FR']);
    window.dispatchEvent(new Event('languagechange'));
    expect(svc.locale()).toBe('fr');
    TestBed.tick();
    expect(locale()).toBe('fr');
  });

  it('adopts a language another tab saved', () => {
    const svc = create();
    TestBed.inject(PrefsService).onStorage({ key: PREFS_KEY, newValue: JSON.stringify({ language: 'fr' }), storageArea: null });
    expect(svc.locale()).toBe('fr');
    TestBed.tick();
    expect(document.documentElement.getAttribute('lang')).toBe('fr-CA');
  });
});

describe('LocaleService with a lazy catalogue', () => {
  let storage: MemoryStorage;
  /** A loader whose French catalogue arrives (or fails) when the spec says so. */
  let loaded: boolean;
  let calls: number;
  let finish: (ok: boolean) => void;

  const fakeLoader: CatalogueLoader = {
    isLoaded: l => l === 'en' || loaded,
    load: () => {
      calls++;
      return new Promise<void>((resolve, reject) => {
        finish = ok => {
          if (ok) loaded = true;
          (ok ? resolve : reject)();
        };
      });
    },
  };

  beforeEach(() => {
    storage = new MemoryStorage();
    loaded = false;
    calls = 0;
    setLanguages(['en-US']);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.setAttribute('lang', 'en');
    delete (window.navigator as unknown as Record<string, unknown>)['languages'];
  });

  function create(): LocaleService {
    TestBed.configureTestingModule({
      providers: [
        { provide: PREFS_STORAGE, useValue: storage },
        { provide: CATALOGUE_LOADER, useValue: fakeLoader },
      ],
    });
    return TestBed.inject(LocaleService);
  }

  it('the real loader fetches French once (the setup file already did)', async () => {
    expect(isCatalogueLoaded('en')).toBe(true);
    expect(isCatalogueLoaded('fr')).toBe(true);
    await expect(loadCatalogue('fr')).resolves.toBeUndefined();
  });

  it('English needs no load and is ready at once', async () => {
    const svc = create();
    await svc.ready;
    expect(calls).toBe(0);
    expect(locale()).toBe('en');
  });

  it('a French device stays English until the catalogue arrives, then switches; ready waits for it', async () => {
    setLanguages(['fr-CA']);
    const svc = create();
    let ready = false;
    void svc.ready.then(() => (ready = true));
    TestBed.tick();
    expect(locale()).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(calls).toBe(1);
    finish(true);
    await svc.ready;
    expect(locale()).toBe('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr-CA');
  });

  it('ready gives up after the budget so a slow chunk cannot hold the first render', async () => {
    vi.useFakeTimers();
    setLanguages(['fr-CA']);
    const svc = create();
    let ready = false;
    void svc.ready.then(() => (ready = true));
    await vi.advanceTimersByTimeAsync(LOCALE_BUDGET_MS - 1);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBe(true);
    expect(locale()).toBe('en');
    // The chunk arriving later still switches.
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(locale()).toBe('fr');
  });

  it('a failed load starts in English at once and the next choice of French retries', async () => {
    setLanguages(['fr-CA']);
    const svc = create();
    finish(false);
    await svc.ready;
    expect(locale()).toBe('en');
    svc.setPreference('en');
    svc.setPreference('fr');
    expect(calls).toBe(2);
    finish(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(locale()).toBe('fr');
  });

  it('a slow French load does not override a later switch back to English', async () => {
    const svc = create();
    svc.setPreference('fr');
    svc.setPreference('en');
    finish(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(locale()).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('stops following languagechange once destroyed', () => {
    const svc = create();
    TestBed.resetTestingModule();
    setLanguages(['fr-FR']);
    window.dispatchEvent(new Event('languagechange'));
    expect(svc.locale()).toBe('en');
  });
});

describe('I18nTitleStrategy', () => {
  afterEach(() => setLocale('en'));

  it('translates key titles, re-runs title resolvers, and follows a language switch', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankComponent, title: 'shell.title.map' },
          { path: 'x/:name', component: BlankComponent, title: r => t('shell.title.page', { page: r.paramMap.get('name')! }) },
          { path: 'plain', component: BlankComponent, title: 'Plain title' },
        ]),
        { provide: TitleStrategy, useClass: I18nTitleStrategy },
      ],
    });
    const router = TestBed.inject(Router);
    const title = TestBed.inject(Title);
    await router.navigateByUrl('/');
    expect(title.getTitle()).toBe('Map · Routes');
    setLocale('fr');
    TestBed.tick();
    expect(title.getTitle()).toBe('Carte · Routes');
    await router.navigateByUrl('/x/Lisbonne');
    expect(title.getTitle()).toBe('Lisbonne · Routes');
    await router.navigateByUrl('/plain');
    expect(title.getTitle()).toBe('Plain title');
  });

  it('re-runs title resolvers on a language switch only, not when a signal they read changes', async () => {
    const name = signal('Lisbon');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: BlankComponent, title: () => t('shell.title.page', { page: name() }) }]),
        { provide: TitleStrategy, useClass: I18nTitleStrategy },
      ],
    });
    const router = TestBed.inject(Router);
    const title = TestBed.inject(Title);
    await router.navigateByUrl('/');
    TestBed.tick();
    expect(title.getTitle()).toBe('Lisbon · Routes');
    name.set('Porto');
    TestBed.tick();
    expect(title.getTitle()).toBe('Lisbon · Routes');
    setLocale('fr');
    TestBed.tick();
    expect(title.getTitle()).toBe('Porto · Routes');
  });
});
