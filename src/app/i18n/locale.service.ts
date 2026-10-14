import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { PrefsService } from '../state/prefs.service';
import { HTML_LANG, LanguagePref, Locale, resolveLocale, setLocale } from './locale';

/**
 * Owns the UI language: the Settings preference (PrefsService.language,
 * 'auto' by default) resolved against the device's languages, pushed into
 * the module-level locale signal that t() and the formatters read, and
 * mirrored to <html lang>. Created by the app initializer, so the first
 * render is already in the right language. See docs/i18n.md.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly prefs = inject(PrefsService);
  private readonly doc = inject(DOCUMENT);
  private readonly deviceLanguages = signal(this.readLanguages());

  /** 'auto', 'en' or 'fr', as stored. */
  readonly preference = this.prefs.language;
  /** The language shown. */
  readonly locale = computed<Locale>(() => resolveLocale(this.preference(), this.deviceLanguages()));

  constructor() {
    this.apply(this.locale());
    // Preference changes (this tab or another), and device changes while on 'auto'.
    effect(() => this.apply(this.locale()));
    this.doc.defaultView?.addEventListener('languagechange', () => this.deviceLanguages.set(this.readLanguages()));
  }

  setPreference(pref: LanguagePref): void {
    this.prefs.update({ language: pref });
    // Now, not on the next effect run: the sheet that was tapped re-renders in the new language at once.
    this.apply(this.locale());
  }

  private apply(l: Locale): void {
    setLocale(l);
    this.doc.documentElement.setAttribute('lang', HTML_LANG[l]);
  }

  private readLanguages(): readonly string[] {
    const nav = this.doc.defaultView?.navigator;
    if (!nav) return [];
    return nav.languages?.length ? nav.languages : nav.language ? [nav.language] : [];
  }
}
