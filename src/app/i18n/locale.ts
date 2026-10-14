import { signal } from '@angular/core';

/**
 * The UI language, as one module-level signal (docs/i18n.md).
 *
 * LocaleService owns it in the app (preference, device language, <html lang>);
 * pure code reads it through t() and the formatters, so a computed() that
 * builds text re-runs when the language changes. Specs set it with setLocale()
 * and put it back with setLocale('en') in afterEach.
 */

export type Locale = 'en' | 'fr';
/** What Settings stores: a language, or 'auto' to follow the device. */
export type LanguagePref = 'auto' | Locale;

export const LOCALES: readonly Locale[] = ['en', 'fr'];
export const LANGUAGE_PREFS: readonly LanguagePref[] = ['auto', 'en', 'fr'];

/**
 * Tag passed to Intl. English stays en-US (the app's dates were always
 * 'Wed, Oct 7'); French is Canadian French ('mer. 7 oct.').
 */
export const INTL_TAG: Readonly<Record<Locale, string>> = { en: 'en-US', fr: 'fr-CA' };
/** Value of <html lang>. */
export const HTML_LANG: Readonly<Record<Locale, string>> = { en: 'en', fr: 'fr-CA' };

const current = signal<Locale>('en');

/** The active UI language (a signal read: reactive inside computed() and templates). */
export const locale = current.asReadonly();

/** Sets the active language. LocaleService calls this; specs may too. */
export function setLocale(l: Locale): void {
  current.set(l);
}

/** The Intl tag of the active language. */
export function intlLocale(): string {
  return INTL_TAG[current()];
}

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'fr';
}

/** The first supported language in a navigator.languages list; English when none is. */
export function localeFromLanguages(langs: readonly string[] | null | undefined): Locale {
  for (const l of langs ?? []) {
    const base = String(l).toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

/** The language to show for a preference and the device's language list. */
export function resolveLocale(pref: LanguagePref, langs: readonly string[] | null | undefined): Locale {
  return pref === 'auto' ? localeFromLanguages(langs) : pref;
}
