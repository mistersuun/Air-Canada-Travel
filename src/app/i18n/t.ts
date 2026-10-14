/**
 * The translator: t('home.where') → 'Where to?' / 'Où aller?'.
 *
 * Pure apart from reading the locale signal, so it works the same in
 * templates, computed()s and the pure *-model.ts functions, and a computed
 * that calls it re-runs when the language changes. See docs/i18n.md.
 */
import { EN } from './en';
import { FR } from './fr';
import { INTL_TAG, Locale, intlLocale, locale } from './locale';
import { MsgParams, formatMessage, formatNumberIn } from './message-format';

export type { MsgParams } from './message-format';

/** Every message key ('home.where', 'format.daily', …). */
export type MsgKey = keyof typeof EN;

const CATALOGUES: Readonly<Record<Locale, Readonly<Record<MsgKey, string>>>> = { en: EN, fr: FR };

/** The message `key` in the active language, with `params` filled in. */
export function t(key: MsgKey, params?: MsgParams): string {
  return tIn(locale(), key, params);
}

/** The message `key` in language `l` (text that must not follow the UI, and specs). */
export function tIn(l: Locale, key: MsgKey, params?: MsgParams): string {
  const msg = CATALOGUES[l][key] ?? EN[key] ?? key;
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

/** The raw catalogue of a language (specs only). */
export function catalogue(l: Locale): Readonly<Record<MsgKey, string>> {
  return CATALOGUES[l];
}
