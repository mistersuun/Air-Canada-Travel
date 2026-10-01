import {
  DOCUMENT, DestroyRef, Injectable, InjectionToken, Signal, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { NavigationEnd, NavigationStart, Params, Router } from '@angular/router';
import { HUBS, Hub } from '../data/destinations';
import { Coverage, getCoverage } from '../data/schedule-index';
import { findDestination, findHub } from '../utils/airports';
import { summarizeWeek } from '../utils/connections';
import { EMPTY_FILTERS, Filters, RouteEntry, SortKey, activeFilterCount, computeRoutes, hubStats } from '../utils/routes';
import { WEEKDAY_SHORT, addDays, dateKey, formatKey, isDateKey, todayKey, weekStartKey, weekdayIndex } from '../utils/time';
import { getFlightsForWeek } from '../utils/week';
import { STALE_AFTER_DAYS, freshnessAge } from '../ui/format';
import { destPath } from '../ui/links';
import { DEFAULT_HUB, PrefsService, isHubCode, isRegion } from './prefs.service';
import { UrlState, parseUrlState } from './url-state';

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

/** How often `nowMs` ticks while the page is visible (countdowns). */
export const COUNTDOWN_TICK_MS = 30_000;

/** How long a notice stays up, without and with an action. */
export const NOTICE_MS = 2500;
export const NOTICE_ACTION_MS = 5000;

/** The query keys AppStateService owns; every other key belongs to a page. */
export const GLOBAL_QUERY_KEYS = ['from', 'week', 'day', 'region', 'q'] as const;
export type GlobalQueryKey = (typeof GLOBAL_QUERY_KEYS)[number];

/** One favourite with this week's operating days (Saved › Watching). */
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

export interface Notice {
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export interface DataInfo {
  /** ISO timestamp of the last scrape, when known. */
  generatedAt: string | null;
  /** Last published date for the hub. */
  to: string | null;
  /** 'Updated Sep 30 · data to Sep 26, 2027'. */
  updatedLabel: string;
  /** Age in days when the data is stale (≥ STALE_AFTER_DAYS), else null. */
  staleDays: number | null;
}

/**
 * The app's view state as signals, plus actions. Pages are thin templates
 * over this service.
 *
 * URL contract (spec §2.3): the global keys from, week, day, region and q
 * mirror the state with replaceUrl navigations (`merge`, so page keys such as
 * ?tab= survive). The Router owns the path. Back/Forward moves between pages
 * while the global state stays as the user left it.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly prefs = inject(PrefsService);
  private readonly engine = inject(ROUTES_ENGINE);
  private readonly now = inject(NOW);
  private readonly doc = inject(DOCUMENT);
  private readonly platformLocation = inject(PlatformLocation);
  private readonly router = inject(Router);
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
  /** True once the user (or a deep link) picked a week, so rollover leaves it alone. */
  private navigated = false;

  readonly hub = computed(() => this.hubOverride() ?? this.prefs.hub() ?? DEFAULT_HUB);
  readonly region = computed(() => this.regionOverride() ?? this.prefs.region());
  readonly showConnections = this.prefs.showConnections;
  readonly favourites = this.prefs.favourites;
  readonly connect = this.prefs.connectOptions;
  readonly timeFormat = this.prefs.timeFormat;

  /** Epoch ms, refreshed every COUNTDOWN_TICK_MS while the document is visible. */
  readonly nowMs = signal(this.now());

  // ── Shell UI state ────────────────────────────────────────────────────────
  readonly settingsOpen = signal(false);
  readonly shortcutsOpen = signal(false);
  readonly notice = signal<Notice | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** The current path without query or fragment ('/', '/to/LIS', '/flight/LIS/2026-10-01/AC812'). */
  readonly path = signal<string>('/');
  /** Push navigations made inside the app (Back stays in the app when > 0). */
  private pushes = 0;
  /** True when boot staged an in-app entry under a deep link (see shell/deep-link.ts). */
  private stagedBack = false;
  /** Set on an imperative push NavigationStart, consumed on NavigationEnd. */
  private pendingPush = false;

  // ── Derived ───────────────────────────────────────────────────────────────
  readonly hubName = computed(() => findHub(this.hub())?.name ?? this.hub());
  readonly hubInfo = computed<Hub>(() => findHub(this.hub()) ?? HUBS.find(h => h.code === DEFAULT_HUB)!);

  /** Filtered, searched and sorted routes (Home results mode). */
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

  /**
   * routes() without the text query (region, filters, favourites and sort
   * kept): the base list for flight-number search. Lazy: only read then.
   */
  readonly unsearchedRoutes = computed<RouteEntry[]>(() =>
    this.engine.computeRoutes({
      home: this.hub(),
      weekStartKey: this.weekStartKey(),
      dateKey: this.selectedDateKey(),
      region: this.region(),
      showConnections: this.showConnections(),
      query: '',
      sort: this.sort(),
      filters: this.filters(),
      favourites: this.favourites(),
      connect: this.connect(),
    }),
  );

  /** Every route from the hub in scope (week or selected day), ignoring search, filters and region. */
  readonly allRoutes = computed<RouteEntry[]>(() =>
    this.engine.computeRoutes({
      home: this.hub(),
      weekStartKey: this.weekStartKey(),
      dateKey: this.selectedDateKey(),
      region: 'All',
      showConnections: this.showConnections(),
      favourites: this.favourites(),
      connect: this.connect(),
    }),
  );

  readonly routeByCode = computed<ReadonlyMap<string, RouteEntry>>(
    () => new Map(this.allRoutes().map(r => [r.destination.code, r])),
  );

  readonly stats = computed(() => this.engine.hubStats(this.hub(), this.weekStartKey(), this.connect()));

  readonly coverage = computed<Coverage>(() => this.engine.getCoverage(this.hub()));

  /** Active filter chips plus search; region is shown separately. */
  readonly activeFilterCount = computed(() => activeFilterCount(this.filters()) + (this.query() ? 1 : 0));
  readonly hasActiveFilters = computed(() => this.activeFilterCount() > 0 || this.region() !== 'All');

  readonly favouriteSet = computed<ReadonlySet<string>>(() => new Set(this.favourites()));

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

  readonly dataInfo = computed<DataInfo>(() => {
    const cov = this.coverage();
    const generatedAt = cov.generatedAt;
    const age = generatedAt ? freshnessAge(generatedAt, this.todayKey()) : null;
    const parts: string[] = [];
    if (generatedAt && age) {
      const key = dateKey(new Date(Date.parse(generatedAt)));
      parts.push(`Updated ${formatKey(key, { month: 'short', day: 'numeric' })}`);
    }
    if (cov.to) parts.push(`data to ${formatKey(cov.to, { month: 'short', day: 'numeric', year: 'numeric' })}`);
    else parts.push('No published schedules');
    return {
      generatedAt,
      to: cov.to,
      updatedLabel: parts.join(' · '),
      staleDays: age && age.days >= STALE_AFTER_DAYS ? age.days : null,
    };
  });

  /** The global state as URL fields; defaults are left out. */
  readonly urlState = computed<UrlState>(() => {
    const week = this.weekStartKey();
    const day = this.selectedDateKey();
    const region = this.region();
    return {
      from: this.hub(),
      week: !day && week !== weekStartKey(this.todayKey()) ? week : undefined,
      day: day ?? undefined,
      region: region !== 'All' ? region : undefined,
      q: this.query() || undefined,
    };
  });

  /**
   * The global keys as router queryParams, for links:
   *   <a [routerLink]="destPath(code)" [queryParams]="state.globalParams()">
   */
  readonly globalParams: Signal<Params> = computed(() => {
    const s = this.urlState();
    const out: Params = {};
    for (const k of GLOBAL_QUERY_KEYS) if (s[k]) out[k] = s[k];
    return out;
  });

  constructor() {
    this.applyUrl(parseUrlState(this.platformLocation.search ?? ''));
    this.path.set(this.platformLocation.pathname || '/');

    effect(() => {
      const params = this.globalParams();
      untracked(() => this.writeUrl(params));
    });

    const destroyRef = inject(DestroyRef);
    const sub = this.router.events.subscribe(e => {
      if (e instanceof NavigationStart) {
        const nav = this.router.currentNavigation();
        if (e.navigationTrigger === 'imperative' && !nav?.extras.replaceUrl && !nav?.extras.skipLocationChange) {
          this.pendingPush = true;
        }
      } else if (e instanceof NavigationEnd) {
        const url = this.router.parseUrl(e.urlAfterRedirects);
        const path = '/' + (url.root.children['primary']?.segments.map(s => s.path).join('/') ?? '');
        if (this.pendingPush && path !== this.path()) this.pushes++;
        this.pendingPush = false;
        this.path.set(path);
        // A page link (or Back) can land on a URL without the global keys, or
        // with stale ones: the state wins, rewritten with replaceUrl once this
        // navigation has finished.
        queueMicrotask(() => this.writeUrl(untracked(() => this.globalParams())));
      }
    });
    destroyRef.onDestroy(() => sub.unsubscribe());

    if (this.win) {
      const tick = setInterval(() => {
        if (this.doc.visibilityState !== 'hidden') this.nowMs.set(this.now());
      }, COUNTDOWN_TICK_MS);
      destroyRef.onDestroy(() => {
        clearInterval(tick);
        clearTimeout(this.noticeTimer);
      });
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

  /** Jump to any date: its week, with that day selected (Today, calendar Done). */
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

  toggleFavourite(code: string): void {
    this.prefs.toggleFavourite(code);
  }

  openSettings(): void {
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
  }

  openShortcuts(): void {
    this.shortcutsOpen.set(true);
  }

  closeShortcuts(): void {
    this.shortcutsOpen.set(false);
  }

  /** Show a toast for 2.5 s (5 s with an action). The PWA update toast takes priority. */
  flash(message: string, action?: { label: string; run: () => void }): void {
    clearTimeout(this.noticeTimer);
    this.notice.set(
      action
        ? { message, actionLabel: action.label, action: () => { this.notice.set(null); action.run(); } }
        : { message },
    );
    this.noticeTimer = setTimeout(() => this.notice.set(null), action ? NOTICE_ACTION_MS : NOTICE_MS);
  }

  dismissNotice(): void {
    clearTimeout(this.noticeTimer);
    this.notice.set(null);
  }

  /** Open /to/CODE (a new history entry), keeping the global params. */
  goToDestination(code: string): void {
    void this.router.navigate(destPath(code), { queryParams: this.globalParams() });
  }

  /** True when Back would stay inside the app. */
  canGoBack(): boolean {
    return this.stagedBack || this.pushes > 0;
  }

  /**
   * Back button / Esc on detail pages: history back when the previous entry
   * is ours, else navigate to `fallback` (a deep link opened in a new tab).
   */
  goBack(fallback: readonly unknown[] = ['/']): void {
    if (this.canGoBack() && this.win) {
      if (this.pushes > 0) this.pushes--;
      else this.stagedBack = false;
      this.win.history.back();
      return;
    }
    void this.router.navigate(fallback as unknown[], { queryParams: this.globalParams() });
  }

  /** Called once at boot when shell/deep-link.ts staged an in-app entry under the landing URL. */
  markStagedBack(): void {
    this.stagedBack = true;
  }

  /** Recompute today (tab became visible, possibly after midnight) and roll the week forward if untouched. */
  refreshToday(): void {
    this.nowMs.set(this.now());
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
  private applyUrl(s: UrlState): void {
    if (s.from) this.hubOverride.set(s.from);
    if (s.region) this.regionOverride.set(s.region);
    if (s.week) {
      this.navigated = true;
      this.weekStartKey.set(s.week);
    }
    this.selectedDateKey.set(s.day ?? null);
    if (s.q !== undefined) this.query.set(s.q);
  }

  /** replaceUrl-merge the global keys, unless the URL already has them or a navigation is running. */
  private writeUrl(params: Params): void {
    // Before the first navigation, and while one runs, NavigationEnd re-syncs.
    if (!this.router.navigated || this.router.currentNavigation()) return;
    const current = this.router.parseUrl(this.router.url).queryParams;
    const patch: Params = {};
    let changed = false;
    for (const k of GLOBAL_QUERY_KEYS) {
      const want = params[k] ?? null;
      const have = current[k] ?? null;
      if (want !== have) changed = true;
      patch[k] = want;
    }
    if (!changed) return;
    void this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }
}
