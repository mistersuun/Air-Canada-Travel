import { DOCUMENT, DestroyRef, Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { PrefsService } from '../state/prefs.service';
import { HTML_LANG, LanguagePref, Locale, resolveLocale, setLocale } from './locale';
import { isCatalogueLoaded, loadCatalogue } from './t';

/** How long the first render waits for the French catalogue before starting in English. */
export const LOCALE_BUDGET_MS = 3_000;

/** Where catalogues come from: t.ts's lazy chunks in the app, a fake in specs. */
export interface CatalogueLoader {
  isLoaded(l: Locale): boolean;
  load(l: Locale): Promise<void>;
}

export const CATALOGUE_LOADER = new InjectionToken<CatalogueLoader>('CATALOGUE_LOADER', {
  providedIn: 'root',
  factory: () => ({ isLoaded: isCatalogueLoaded, load: loadCatalogue }),
});

/**
 * Owns the UI language: the Settings preference (PrefsService.language,
 * 'auto' by default) resolved against the device's languages, pushed into
 * the module-level locale signal that t() and the formatters read, and
 * mirrored to <html lang>. Created by the app initializer, which waits for
 * `ready`, so the first render is already in the right language. See docs/i18n.md.
 *
 * A language whose catalogue is not loaded yet (French: a lazy chunk) is
 * switched to only once it arrives; until then the previous language stays,
 * so no screen shows a half-translated mix mid-switch.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly prefs = inject(PrefsService);
  private readonly doc = inject(DOCUMENT);
  private readonly loader = inject(CATALOGUE_LOADER);
  private readonly deviceLanguages = signal(this.readLanguages());
  /** The language last asked for, and the promise that applies it. */
  private target: Locale | null = null;
  private pending: Promise<void> = Promise.resolve();
  /** Bumped by every new target: a slow load for a language no longer wanted does not apply. */
  private seq = 0;

  /** 'auto', 'en' or 'fr', as stored. */
  readonly preference = this.prefs.language;
  /** The language asked for (shown once its catalogue is loaded). */
  readonly locale = computed<Locale>(() => resolveLocale(this.preference(), this.deviceLanguages()));
  /**
   * Resolves when the starting language is applied, or after LOCALE_BUDGET_MS
   * (a failed or slow chunk load starts the app in English; the language
   * still switches if the chunk arrives later). Never rejects.
   */
  readonly ready: Promise<void>;

  constructor() {
    const first = this.apply(this.locale());
    this.ready = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, LOCALE_BUDGET_MS);
      void first.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Preference changes (this tab or another), and device changes while on 'auto'.
    effect(() => {
      const l = this.locale();
      untracked(() => this.apply(l));
    });
    const win = this.doc.defaultView;
    const onLanguageChange = (): void => this.deviceLanguages.set(this.readLanguages());
    win?.addEventListener('languagechange', onLanguageChange);
    inject(DestroyRef).onDestroy(() => win?.removeEventListener('languagechange', onLanguageChange));
  }

  setPreference(pref: LanguagePref): void {
    this.prefs.update({ language: pref });
    // Now, not on the next effect run: the sheet that was tapped re-renders in the new
    // language at once (or as soon as its catalogue arrives).
    void this.apply(this.locale());
  }

  /** Switches to `l`: at once when its catalogue is loaded, else once it is. Never rejects. */
  private apply(l: Locale): Promise<void> {
    if (l === this.target) return this.pending;
    this.target = l;
    const seq = ++this.seq;
    const commit = (): void => {
      if (seq !== this.seq) return;
      setLocale(l);
      this.doc.documentElement.setAttribute('lang', HTML_LANG[l]);
    };
    if (this.loader.isLoaded(l)) {
      commit();
      this.pending = Promise.resolve();
    } else {
      this.pending = this.loader.load(l).then(commit, () => {
        // Offline with no cached chunk, or a stale deploy: stay in the current
        // language, and let the next request for `l` try again.
        if (seq === this.seq) this.target = null;
      });
    }
    return this.pending;
  }

  private readLanguages(): readonly string[] {
    const nav = this.doc.defaultView?.navigator;
    if (!nav) return [];
    return nav.languages?.length ? nav.languages : nav.language ? [nav.language] : [];
  }
}
