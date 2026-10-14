import { afterEach, describe, expect, it } from 'vitest';
import { computed } from '@angular/core';
import { EN, EN_AREAS } from './en';
import { FR, FR_AREAS } from './fr';
import { locale, localeFromLanguages, resolveLocale, setLocale } from './locale';
import { messageArgs } from './message-format';
import { MsgKey, catalogue, formatNumber, isMsgKey, t, tIn, tOr } from './t';
import { departWindowLabel, regionLabel, tripLengthLabel, typeLabel } from './labels';

/**
 * French values allowed to equal the English ones: words that are the same
 * in both languages, language names, and messages that are only arguments.
 * Add a key here only when the French really is the same text.
 */
const SAME_IN_FRENCH: ReadonlySet<string> = new Set<MsgKey>([
  'settings.language.en', 'settings.language.fr', 'settings.theme.auto', 'settings.photo',
  'shell.title.home', 'shell.title.page',
  'data.region.europe', 'data.hub.YUL',
  'format.via', 'format.range.twoMonths',
  'home.destinations', 'home.week.destinations', 'home.badge.at', 'home.filter.sort.az', 'home.chips.via',
  'today.mode.train', 'passes.add.photo', 'passes.add.pdf', 'passes.add.date',
  'files.photos', 'files.photo', 'files.note', 'files.meta.pdfPages', 'files.meta.pdf', 'files.meta.photo', 'files.cat.photos', 'files.cat.notes',
]);

afterEach(() => setLocale('en'));

describe('catalogue', () => {
  it('keeps every key under its area prefix, so area files never collide', () => {
    for (const [area, msgs] of Object.entries(EN_AREAS)) {
      for (const key of Object.keys(msgs)) expect(key.startsWith(`${area}.`), key).toBe(true);
    }
    const total = Object.values(EN_AREAS).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(Object.keys(EN)).toHaveLength(total);
  });

  it('has the same areas and keys in French (tsc enforces this too)', () => {
    expect(Object.keys(FR_AREAS).sort()).toEqual(Object.keys(EN_AREAS).sort());
    expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('has no empty French value, and none left in English unless allowed', () => {
    const fr = catalogue('fr');
    const untranslated = (Object.keys(EN) as MsgKey[]).filter(k => fr[k] === EN[k] && !SAME_IN_FRENCH.has(k));
    expect(untranslated).toEqual([]);
    expect((Object.keys(EN) as MsgKey[]).filter(k => !fr[k].trim())).toEqual([]);
    expect((Object.keys(EN) as MsgKey[]).filter(k => !EN[k].trim())).toEqual([]);
  });

  it('keeps SAME_IN_FRENCH to keys that exist and really are the same', () => {
    for (const k of SAME_IN_FRENCH) {
      expect(isMsgKey(k), k).toBe(true);
      expect(catalogue('fr')[k as MsgKey], k).toBe(EN[k as MsgKey]);
    }
  });

  it('uses the same arguments in both languages, and every message parses', () => {
    // Messages whose callers pass parts each language picks from (week ranges: 'Oct 1 – 7' / '1–7 oct.').
    const pickParts: Partial<Record<MsgKey, string[]>> = { 'format.range.sameMonth': ['end', 'endDay', 'start', 'startDay'] };
    const mismatched = (Object.keys(EN) as MsgKey[]).filter(k => {
      const en = messageArgs(EN[k]);
      const fr = messageArgs(catalogue('fr')[k]);
      const parts = pickParts[k];
      return parts ? ![...en, ...fr].every(a => parts.includes(a)) : en.join() !== fr.join();
    });
    expect(mismatched).toEqual([]);
  });

  it('French typography: no-break space before ":" and inside « », none before ? ! ;', () => {
    const fr = catalogue('fr');
    const bad = (Object.keys(EN) as MsgKey[]).filter(k => /[^\u00a0\u202f}]:(?!\{)| :|[ \u00a0\u202f][?!;]|«(?![\u00a0\u202f])|(?<![\u00a0\u202f])»/.test(fr[k]));
    expect(bad).toEqual([]);
  });

  it('writes no ICU apostrophe quoting and no straight double quotes in French', () => {
    // Apostrophes are plain text here; French quotes are « ».
    const fr = catalogue('fr');
    expect((Object.keys(EN) as MsgKey[]).filter(k => fr[k].includes('"'))).toEqual([]);
  });
});

describe('t()', () => {
  it('translates in the active language and fills parameters', () => {
    expect(t('home.where')).toBe('Where to?');
    setLocale('fr');
    expect(t('home.where')).toBe('Où aller?');
    expect(t('home.filter.show', { n: 1 })).toBe('Afficher 1 destination');
    expect(t('home.filter.show', { n: 12 })).toBe('Afficher 12 destinations');
  });

  it('pluralises counts in each language', () => {
    const p = { city: 'Lisbonne', hours: 40, n: 1 };
    expect(tIn('en', 'home.surprise.dareWeekend', { ...p, n: 1 })).toContain('1 try home');
    expect(tIn('en', 'home.surprise.dareWeekend', { ...p, n: 2 })).toContain('2 tries home');
    expect(tIn('fr', 'home.surprise.dareWeekend', p)).toContain('1 essai pour revenir');
    expect(tIn('fr', 'home.surprise.dareWeekend', { ...p, n: 6 })).toContain('6 essais pour revenir');
  });

  it('tIn ignores the active language; tOr falls back for unknown keys', () => {
    setLocale('fr');
    expect(tIn('en', 'shell.nav.trips')).toBe('Trips');
    expect(tOr('shell.nav.trips', 'x')).toBe('Voyages');
    expect(tOr('nope.missing', 'Fallback')).toBe('Fallback');
    expect(isMsgKey('nope.missing')).toBe(false);
  });

  it('is reactive: a computed that calls it re-runs on a language switch', () => {
    const label = computed(() => t('shell.nav.explore'));
    expect(label()).toBe('Explore');
    setLocale('fr');
    expect(label()).toBe('Explorer');
    expect(locale()).toBe('fr');
  });

  it('formats numbers for the locale', () => {
    expect(formatNumber(1234)).toBe('1,234');
    setLocale('fr');
    expect(formatNumber(1234)).toMatch(/^1\s234$/u);
  });
});

describe('locale resolution', () => {
  it('takes the first supported device language, English otherwise', () => {
    expect(localeFromLanguages(['fr-CA', 'en-CA'])).toBe('fr');
    expect(localeFromLanguages(['en-US', 'fr-CA'])).toBe('en');
    expect(localeFromLanguages(['de-DE', 'fr'])).toBe('fr');
    expect(localeFromLanguages(['de-DE'])).toBe('en');
    expect(localeFromLanguages([])).toBe('en');
    expect(localeFromLanguages(undefined)).toBe('en');
  });

  it('honours an explicit preference over the device', () => {
    expect(resolveLocale('auto', ['fr-CA'])).toBe('fr');
    expect(resolveLocale('en', ['fr-CA'])).toBe('en');
    expect(resolveLocale('fr', ['en-US'])).toBe('fr');
  });
});

describe('data labels', () => {
  it('shows identifiers in the UI language, unknown ones as they are', () => {
    expect(regionLabel('All')).toBe('All regions');
    expect(regionLabel('Asia & Pacific')).toBe('Asia & Pacific');
    expect(regionLabel('Atlantis')).toBe('Atlantis');
    setLocale('fr');
    expect(regionLabel('Starred')).toBe('★ Favoris');
    expect(regionLabel('USA')).toBe('États-Unis');
    expect(typeLabel('Sun')).toBe('Soleil');
    expect(departWindowLabel('redeye')).toBe('Vol de nuit');
    expect(tripLengthLabel('weekend')).toBe('Longue fin de semaine');
  });
});
