import { DOCUMENT, DestroyRef, Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { Destination } from '../data/destinations';
import { Coverage, getCoverage } from '../data/schedule-index';
import { findDestination, findHub } from '../utils/airports';
import { summarizeWeek } from '../utils/connections';
import { EMPTY_FILTERS, Filters, RouteEntry, SortKey, activeFilterCount, computeRoutes, hubStats } from '../utils/routes';
import { WEEKDAY_SHORT, addDays, isDateKey, todayKey, weekStartKey, weekdayIndex } from '../utils/time';
import { getFlightsForWeek } from '../utils/week';
import { DEFAULT_HUB, PrefsService, isHubCode, isRegion } from './prefs.service';
import { UrlState, parseUrlState, serializeUrlState } from './url-state';

/**
 * The schedule functions the shell calls, behind a token so specs can count
 * or replace calls (critique 22: vi.spyOn cannot intercept ESM named exports).
 */
export interface RoutesEngine {
  computeRoutes: typeof computeRoutes;
  hubStats: typeof hubStats;
  getCoverage: typeof getCoverage;
  getFlightsForWeek: typeof getFlightsForWeek;
  summarizeWeek: typeof summarizeWeek;
}

export const ROUTES_ENGINE = new InjectionToken<RoutesEngine>('ROUTES_ENGINE', {
  providedIn: 'root',
  factory: () => ({ computeRoutes, hubStats, getCoverage, getFlightsForWeek, summarizeWeek }),
});

/** Clock source; specs can pin it. Returns epoch ms. */
export const NOW = new InjectionToken<() => number>('NOW', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

/** One entry of the header's "Your starred places this week" strip. */
export interface StarredItem {
  code: string;
  city: string;
  country: string;
  /** Date keys this week with a direct flight, or else a connection. */
  dayKeys: string[];
  /** 'Tue Thu Sat', or '' when nothing operates this week. */
  days: string;
  /** True when at least one day is a direct flight. */
  direct: boolean;
}

/** history.state marker for the entry pushed when the modal opens. */
const MODAL_STATE = 'acModal';

/**
 * The app's view state as signals, plus actions. AppComponent is a thin
 * template over this service.
 *
 * - `hub` and `region` come from the URL for this session when present,
 *   otherwise from the saved prefs; choosing one in the UI saves it.
 * - `routes` is a computed over the inputs, so the engine runs only when an
 *   input changes, never on unrelated change detection.
 * - The URL mirrors the state (replaceState), except opening a destination,
 *   which pushes an entry so Back closes the modal.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly prefs = inject(PrefsService);
  private readonly engine = inject(ROUTES_ENGINE);
  private readonly now = inject(NOW);
  private readonly doc = inject(DOCUMENT);
  private readonly win = this.doc.defaultView;

  // ── Inputs ────────────────────────────────────────────────────────────────
  readonly todayKey = signal(todayKey(undefined, this.now()));
  private readonly hubOverride = signal<string | null>(null);
  private readonly regionOverride = signal<string | null>(null);
  readonly weekStartKey = signal(weekStartKey(this.todayKey()));
  readonly selectedDateKey = signal<string | null>(null);
  readonly query = signal('');
  readonly sort = signal<SortKey>('az');
  readonly filters = signal<Filters>(EMPTY_FILTERS);
  /** Destination code whose modal is open. */
  readonly openCode = signal<string | null>(null);
  /** True once the user (or a deep link) picked a week, so rollover leaves it alone. */
  private navigated = false;
  /** True while the open modal owns a history entry we pushed. */
  private pushedModal = false;

  readonly hub = computed(() => this.hubOverride() ?? this.prefs.hub() ?? DEFAULT_HUB);
  readonly region = computed(() => this.regionOverride() ?? this.prefs.region());
  readonly showConnections = this.prefs.showConnections;
  readonly favourites = this.prefs.favourites;
  readonly connect = this.prefs.connectOptions;

  // ── Derived ───────────────────────────────────────────────────────────────
  readonly hubName = computed(() => findHub(this.hub())?.name ?? this.hub());

  readonly routes = computed<RouteEntry[]>(() =>
    this.engine.computeRoutes({
      home: this.hub(),
      weekStartKey: this.weekStartKey(),
      dateKey: this.selectedDateKey(),
      region: this.region(),
      showConnections: this.showConnections(),
      query: this.query(),
      sort: this.sort(),
      filters: this.filters(),
      favourites: this.favourites(),
      connect: this.connect(),
    }),
  );

  readonly stats = computed(() => this.engine.hubStats(this.hub(), this.weekStartKey(), this.connect()));

  readonly coverage = computed<Coverage>(() => this.engine.getCoverage(this.hub()));

  /** Active filter chips plus search; region is shown separately. */
  readonly activeFilterCount = computed(() => activeFilterCount(this.filters()) + (this.query() ? 1 : 0));
  readonly hasActiveFilters = computed(() => this.activeFilterCount() > 0 || this.region() !== 'All');

  readonly openDestination = computed<Destination | null>(() => findDestination(this.openCode()));
  readonly openEntry = computed<RouteEntry | null>(() => {
    const code = this.openCode();
    return code ? this.routes().find(r => r.destination.code === code) ?? null : null;
  });

  readonly starredThisWeek = computed<StarredItem[]>(() => {
    const hub = this.hub();
    const week = this.weekStartKey();
    const withConnections = this.showConnections();
    const connect = this.connect();
    const items: StarredItem[] = [];
    for (const code of this.favourites()) {
      const d = findDestination(code);
      if (!d) continue;
      let dayKeys = this.engine.getFlightsForWeek(hub, code, week).filter(x => x.flies).map(x => x.dateKey);
      const direct = dayKeys.length > 0;
      if (!direct && withConnections) {
        dayKeys = this.engine.summarizeWeek(hub, code, week, connect).days.filter(x => x.connections > 0).map(x => x.dateKey);
      }
      items.push({
        code, city: d.city, country: d.country, dayKeys, direct,
        days: dayKeys.map(k => WEEKDAY_SHORT[weekdayIndex(k)]).join(' '),
      });
    }
    return items.sort((a, b) => a.city.localeCompare(b.city));
  });

  /** The URL for the current state; defaults are left out. */
  readonly urlState = computed<UrlState>(() => {
    const week = this.weekStartKey();
    const day = this.selectedDateKey();
    const region = this.region();
    return {
      from: this.hub(),
      week: !day && week !== weekStartKey(this.todayKey()) ? week : undefined,
      day: day ?? undefined,
      region: region !== 'All' ? region : undefined,
      dest: this.openCode() ?? undefined,
      q: this.query() || undefined,
    };
  });

  constructor() {
    this.applyUrl(parseUrlState(this.win?.location.search ?? ''), true);

    // A deep link that opens a destination: rewrite the landing entry without
    // `dest` and push the modal entry on top, so Back closes the modal and
    // stays in the app instead of leaving the page.
    if (this.openCode() && !this.win?.history.state?.[MODAL_STATE]) {
      const base = untracked(() => ({ ...this.urlState(), dest: undefined }));
      this.writeUrl(serializeUrlState(base), false);
      this.writeUrl(serializeUrlState(untracked(() => this.urlState())), true);
      this.pushedModal = true;
    } else if (this.openCode()) {
      this.pushedModal = true; // reloaded on our own modal entry
    }

    effect(() => {
      const url = serializeUrlState(this.urlState());
      untracked(() => this.writeUrl(url, false));
    });

    if (this.win) {
      const onPop = () => this.onPopState();
      this.win.addEventListener('popstate', onPop);
      inject(DestroyRef).onDestroy(() => this.win?.removeEventListener('popstate', onPop));
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  setHub(code: string): void {
    if (!isHubCode(code)) return;
    this.hubOverride.set(null);
    this.prefs.update({ hub: code });
  }

  /**
   * Drop the URL-supplied hub/region so the saved prefs show again (Settings
   * reset). Without this a `from=`/`region=` in the URL keeps winning.
   */
  resetOverrides(): void {
    this.hubOverride.set(null);
    this.regionOverride.set(null);
  }

  setRegion(region: string): void {
    if (!isRegion(region)) return;
    this.regionOverride.set(null);
    this.prefs.update({ region });
  }

  setShowConnections(on: boolean): void {
    this.prefs.update({ showConnections: on });
  }

  setQuery(q: string): void {
    this.query.set((q ?? '').trim());
  }

  setSort(sort: SortKey): void {
    this.sort.set(sort);
  }

  setFilters(filters: Partial<Filters>): void {
    this.filters.set({ ...EMPTY_FILTERS, ...filters });
  }

  /** Clear search, filter chips and the region. */
  clearFilters(): void {
    this.filters.set(EMPTY_FILTERS);
    this.query.set('');
    this.setRegion('All');
  }

  prevWeek(): void {
    this.goToWeek(addDays(this.weekStartKey(), -7));
  }

  nextWeek(): void {
    this.goToWeek(addDays(this.weekStartKey(), 7));
  }

  /** Show the week containing `key`, with no day selected. */
  goToWeek(key: string): void {
    if (!isDateKey(key)) return;
    this.navigated = true;
    this.weekStartKey.set(weekStartKey(key));
    this.selectedDateKey.set(null);
  }

  /** Select a day of the current week, or null for the whole week. */
  selectDay(key: string | null): void {
    if (key !== null && !isDateKey(key)) return;
    this.navigated = true;
    if (key) this.weekStartKey.set(weekStartKey(key));
    this.selectedDateKey.set(key);
    if (!key && this.sort() === 'departure') this.sort.set('az');
  }

  /** Jump to any date: its week, with that day selected (date picker, Today, modal calendar). */
  jumpTo(key: string): void {
    this.selectDay(key);
  }

  /**
   * Out-of-coverage recovery: go to the week of `key`, or of the last
   * published date when no key is given.
   */
  jumpToCoverage(key?: string | null): void {
    const target = key && isDateKey(key) ? key : this.coverage().to;
    if (target) this.goToWeek(target);
  }

  openDestinationByCode(code: string): void {
    if (!findDestination(code) || this.openCode() === code) return;
    const wasOpen = this.openCode() !== null;
    this.openCode.set(code);
    if (!wasOpen) {
      this.writeUrl(serializeUrlState(this.urlState()), true);
      this.pushedModal = true;
    }
  }

  closeDestination(): void {
    if (this.openCode() === null) return;
    this.openCode.set(null);
    if (this.pushedModal && this.win?.history.state?.[MODAL_STATE]) {
      this.pushedModal = false;
      // Pop our entry so Back does not reopen the modal; popstate re-syncs the URL.
      this.win.history.back();
    }
  }

  /** Recompute today (tab became visible, possibly after midnight) and roll the week forward if untouched. */
  refreshToday(): void {
    const t = todayKey(undefined, this.now());
    if (t === this.todayKey()) return;
    this.todayKey.set(t);
    if (!this.navigated) {
      const current = weekStartKey(t);
      if (this.weekStartKey() < current) {
        this.weekStartKey.set(current);
        this.selectedDateKey.set(null);
      }
    }
  }

  // ── URL plumbing ──────────────────────────────────────────────────────────
  private applyUrl(s: UrlState, boot: boolean): void {
    if (s.from) this.hubOverride.set(s.from);
    if (s.region) this.regionOverride.set(s.region);
    if (s.week) {
      this.navigated = true;
      this.weekStartKey.set(s.week);
    }
    this.selectedDateKey.set(s.day ?? null);
    if (s.q !== undefined) this.query.set(s.q);
    this.openCode.set(s.dest ?? null);
    if (boot) this.pushedModal = false;
  }

  /**
   * Back/Forward: only the modal follows history. Other state (week, hub)
   * stays as the user left it, and the URL is rewritten to match it.
   */
  private onPopState(): void {
    const s = parseUrlState(this.win?.location.search ?? '');
    this.pushedModal = !!(s.dest && this.win?.history.state?.[MODAL_STATE]);
    this.openCode.set(s.dest ?? null);
    this.writeUrl(serializeUrlState(this.urlState()), false);
  }

  private writeUrl(search: string, push: boolean): void {
    const w = this.win;
    if (!w) return;
    try {
      const url = `${w.location.pathname}${search}${w.location.hash}`;
      if (push) {
        w.history.pushState({ [MODAL_STATE]: true }, '', url);
      } else if (url !== `${w.location.pathname}${w.location.search}${w.location.hash}`) {
        w.history.replaceState(w.history.state, '', url);
      }
    } catch {
      // Sandboxed iframes can throw on history writes; the app still works.
    }
  }
}
