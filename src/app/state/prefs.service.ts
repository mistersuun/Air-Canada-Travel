import { DOCUMENT, Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core';
import { DESTINATIONS, HUBS, REGIONS } from '../data/destinations';
import { STARRED_REGION } from '../utils/routes';
import type { ConnectOptions } from '../utils/connections';

/**
 * User preferences, persisted as JSON in localStorage['ac.prefs.v1'].
 *
 * This is the single store for the theme too (critique 23): the pre-paint
 * script in index.html reads `theme` from the same key. Every storage access
 * is wrapped in try/catch so the app works with storage blocked (private
 * windows, disabled site data); in that case preferences live for the session.
 */

export type ThemePref = 'auto' | 'light' | 'dark';
export type TimeFormat = '12h' | '24h';

export interface Prefs {
  /** Home airport code (one of HUBS). */
  hub: string;
  /** 'All', a REGIONS entry, or 'Starred'. */
  region: string;
  showConnections: boolean;
  theme: ThemePref;
  timeFormat: TimeFormat;
  /** Minimum connection time, minutes. */
  minConnect: number;
  /** Maximum same-day layover, minutes. */
  maxLayover: number;
  allowOvernight: boolean;
  /** Starred destination codes, in the order they were starred. */
  favourites: string[];
}

export const PREFS_KEY = 'ac.prefs.v1';
/** The one fallback hub for the parent and every child (was YYZ in one place, Toronto in another). */
export const DEFAULT_HUB = 'YUL';
export const THEMES: readonly ThemePref[] = ['auto', 'light', 'dark'];
export const MIN_CONNECT_OPTIONS: readonly number[] = [45, 60, 90, 120];
export const MAX_LAYOVER_OPTIONS: readonly number[] = [240, 360, 480, 720];

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  hub: DEFAULT_HUB,
  region: 'All',
  showConnections: true,
  theme: 'auto',
  timeFormat: '24h',
  minConnect: 60,
  maxLayover: 360,
  allowOvernight: false,
  favourites: [] as string[],
}) as Readonly<Prefs>;

const HUB_CODES = new Set(HUBS.map(h => h.code));
const DEST_CODES = new Set(DESTINATIONS.map(d => d.code));

export function isHubCode(v: unknown): v is string {
  return typeof v === 'string' && HUB_CODES.has(v);
}

export function isRegion(v: unknown): v is string {
  return typeof v === 'string' && (REGIONS.includes(v) || v === STARRED_REGION);
}

export function isDestinationCode(v: unknown): v is string {
  return typeof v === 'string' && DEST_CODES.has(v);
}

/** Codes a destination used to have: stars and links saved with them keep working. */
const RENAMED_DEST_CODES: Readonly<Record<string, string>> = {
  PBI: 'DJT', // Palm Beach International's IATA code since 2026
};

/** A saved destination code, mapped to its current code when it was renamed. */
export function currentDestinationCode(v: unknown): unknown {
  return typeof v === 'string' ? RENAMED_DEST_CODES[v] ?? v : v;
}

/** Coerce anything (parsed JSON, a patch) into valid Prefs; unknown or invalid fields take defaults. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const favs = Array.isArray(r['favourites'])
    ? [...new Set(r['favourites'].map(currentDestinationCode).filter(isDestinationCode))]
    : [];
  return {
    hub: isHubCode(r['hub']) ? r['hub'] : d.hub,
    region: isRegion(r['region']) ? r['region'] : d.region,
    showConnections: typeof r['showConnections'] === 'boolean' ? r['showConnections'] : d.showConnections,
    theme: THEMES.includes(r['theme'] as ThemePref) ? (r['theme'] as ThemePref) : d.theme,
    timeFormat: r['timeFormat'] === '12h' || r['timeFormat'] === '24h' ? r['timeFormat'] : d.timeFormat,
    minConnect: MIN_CONNECT_OPTIONS.includes(r['minConnect'] as number) ? (r['minConnect'] as number) : d.minConnect,
    maxLayover: MAX_LAYOVER_OPTIONS.includes(r['maxLayover'] as number) ? (r['maxLayover'] as number) : d.maxLayover,
    allowOvernight: typeof r['allowOvernight'] === 'boolean' ? r['allowOvernight'] : d.allowOvernight,
    favourites: favs,
  };
}

/** Storage backing the prefs. Tests provide an in-memory Storage, or null for "blocked". */
export const PREFS_STORAGE = new InjectionToken<Storage | null>('PREFS_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null; // SecurityError when site data is blocked
    }
  },
});

export const THEME_META: Record<'light' | 'dark', string> = { light: '#CFE6FF', dark: '#0F2238' };

/**
 * Apply the theme contract from WS4: html[data-theme] is 'light' | 'dark', or
 * absent for auto. The theme-color metas follow: a forced theme overrides both
 * media variants, auto restores each to its own scheme.
 */
export function applyTheme(doc: Document, theme: ThemePref): void {
  const root = doc.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  doc.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    const media = meta.getAttribute('media') ?? '';
    const scheme: 'light' | 'dark' = theme !== 'auto' ? theme : media.includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', THEME_META[scheme]);
  });
}

@Injectable({ providedIn: 'root' })
export class PrefsService {
  private readonly storage = inject(PREFS_STORAGE);
  private readonly doc = inject(DOCUMENT);
  private readonly state = signal<Prefs>(this.load());

  readonly prefs = this.state.asReadonly();
  readonly hub = computed(() => this.state().hub);
  readonly region = computed(() => this.state().region);
  readonly showConnections = computed(() => this.state().showConnections);
  readonly theme = computed(() => this.state().theme);
  readonly timeFormat = computed(() => this.state().timeFormat);
  readonly favourites = computed(() => this.state().favourites, {
    equal: (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
  });
  /**
   * Connection preferences for the engine. A new object only when a value
   * changes, because the engine memoises ConnectOptions by identity.
   */
  readonly connectOptions = computed<ConnectOptions>(
    () => {
      const p = this.state();
      return { minConnect: p.minConnect, maxLayover: p.maxLayover, allowOvernight: p.allowOvernight };
    },
    {
      equal: (a, b) =>
        a.minConnect === b.minConnect && a.maxLayover === b.maxLayover && a.allowOvernight === b.allowOvernight,
    },
  );

  constructor() {
    effect(() => applyTheme(this.doc, this.theme()));
  }

  update(patch: Partial<Prefs>): void {
    const next = sanitizePrefs({ ...this.state(), ...patch });
    this.state.set(next);
    this.save(next);
  }

  setTheme(theme: ThemePref): void {
    this.update({ theme });
  }

  /** auto → light → dark → auto. */
  cycleTheme(): void {
    const i = THEMES.indexOf(this.theme());
    this.setTheme(THEMES[(i + 1) % THEMES.length]);
  }

  isFavourite(code: string): boolean {
    return this.state().favourites.includes(code);
  }

  toggleFavourite(code: string): void {
    const favs = this.state().favourites;
    this.update({ favourites: favs.includes(code) ? favs.filter(c => c !== code) : [...favs, code] });
  }

  /** Reset every setting to its default. Favourites are kept: they are data, not settings. */
  reset(): void {
    this.update({ ...DEFAULT_PREFS, favourites: this.state().favourites });
  }

  private load(): Prefs {
    try {
      const raw = this.storage?.getItem(PREFS_KEY);
      return sanitizePrefs(raw ? JSON.parse(raw) : null);
    } catch {
      return sanitizePrefs(null);
    }
  }

  private save(p: Prefs): void {
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      // Quota exceeded or storage blocked: keep the in-memory value.
    }
  }
}
