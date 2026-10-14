import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { PREFS_KEY, PREFS_STORAGE, PrefsService } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { locale, setLocale } from './locale';
import { LocaleService } from './locale.service';
import { t } from './t';
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
});
