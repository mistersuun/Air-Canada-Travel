/**
 * The translator: t('home.where') → 'Where to?' / 'Où aller?'.
 *
 * Pure apart from reading the locale signal, so it works the same in
 * templates, computed()s and the pure *-model.ts functions, and a computed
 * that calls it re-runs when the language changes. See docs/i18n.md.
 *
 * English is bundled (the source of every MsgKey and the fallback for a
 * missing message); French is a lazy chunk that loadCatalogue('fr') fetches
 * before LocaleService switches to it, so English users never download it.
 */
import { signal } from '@angular/core';
import { EN } from './en';
import { INTL_TAG, Locale, intlLocale, locale } from './locale';
import { MsgParams, formatMessage, formatNumberIn } from './message-format';

export type { MsgParams } from './message-format';

/** Every message key ('home.where', 'format.daily', …). */
export type MsgKey = keyof typeof EN;

type Catalogue = Readonly<Record<MsgKey, string>>;

/** Catalogues loaded so far (English always). A signal, so text re-renders when one arrives. */
const loaded = signal<Partial<Record<Locale, Catalogue>>>({ en: EN });
const loading = new Map<Locale, Promise<void>>();

const IMPORTERS: Readonly<Record<Exclude<Locale, 'en'>, () => Promise<Catalogue>>> = {
  fr: () => import('./fr').then(m => m.FR),
};

/**
 * Fetches language `l`'s catalogue (once; a failed fetch can be retried).
 * Until it resolves, tIn(l, …) falls back to English.
 */
export function loadCatalogue(l: Locale): Promise<void> {
  if (l === 'en' || loaded()[l]) return Promise.resolve();
  let p = loading.get(l);
  if (!p) {
    p = IMPORTERS[l]().then(
      c => loaded.update(all => ({ ...all, [l]: c })),
      e => {
        loading.delete(l);
        throw e;
      },
    );
    loading.set(l, p);
  }
  return p;
}

/** True once language `l`'s catalogue is in memory. */
export function isCatalogueLoaded(l: Locale): boolean {
  return !!loaded()[l];
}

/** The message `key` in the active language, with `params` filled in. */
export function t(key: MsgKey, params?: MsgParams): string {
  return tIn(locale(), key, params);
}

/** The message `key` in language `l` (text that must not follow the UI, and specs). */
export function tIn(l: Locale, key: MsgKey, params?: MsgParams): string {
  const msg = loaded()[l]?.[key] ?? EN[key] ?? key;
  return formatMessage(msg, params, INTL_TAG[l]);
}

/** True when `key` is in the catalogue (for keys built from data, e.g. `data.region.${r}`). */
export function isMsgKey(key: string): key is MsgKey {
  return Object.prototype.hasOwnProperty.call(EN, key);
}

/** `t(key)` when the key exists, else `fallback` (a data value with no translation). */
export function tOr(key: string, fallback: string, params?: MsgParams): string {
  return isMsgKey(key) ? t(key, params) : fallback;
}

/** '1,234' / '1 234' in the active language. */
export function formatNumber(n: number): string {
  return formatNumberIn(intlLocale(), n);
}

/** The raw catalogue of a language, English until it is loaded (specs only). */
export function catalogue(l: Locale): Catalogue {
  return loaded()[l] ?? EN;
}
