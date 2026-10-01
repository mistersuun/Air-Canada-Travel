import {
  ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import { airportTz } from '../../utils/airports';
import { activeFilterCount } from '../../utils/routes';
import { formatKey, todayKey } from '../../utils/time';
import { IconComponent } from '../../components/shared/icons.component';
import { DestRowComponent } from '../../ui/dest-row.component';
import { DotDay, entryDots } from '../../ui/dot-row.component';
import { greeting, weekRangeLabel } from '../../ui/format';
import { HubPickerComponent } from '../../ui/hub-picker.component';
import { destPath } from '../../ui/links';
import { PhotoCardComponent } from '../../ui/photo-card.component';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { WeekStripComponent } from '../../ui/week-strip.component';
import { FilterChipsComponent } from './filters/filter-chips.component';
import { FilterSheetComponent, REGION_CHIPS } from './filters/filter-sheet.component';
import {
  PLACES_MIN_QUERY, coverageStatus, editorsPicks, flightNumberQuery, focusDayIndex, nonstopByFrequency, placeRows, reachDep, rowMeta,
  seasonEvents, seasonMeta, withFlightMatches,
} from './home-model';
import { CityIndexService } from '../../places/city-index.service';
import { ResultsListComponent } from './results-list.component';
import { WeekCardComponent } from './week-card.component';
import { TodayBannerComponent } from '../today/today-banner.component';

/** Phone layout (spec 1.4: mobile < 720px). */
export const NARROW_QUERY = '(max-width: 719px)';

const CONNECT_OPTIONS: SegOption[] = [
  { value: 'direct', label: 'Nonstop' },
  { value: 'connect', label: '+ Connections' },
];

interface ListRow {
  code: string;
  meta: string;
  small: string;
  dots: DotDay[] | null;
  tag?: { text: string; tone: 'teal' | 'amber' };
}

/**
 * Explore (`/`): greeting, hub picker, search, Nonstop/+Connections, the
 * week strip and "This week" card; then either the curated sections
 * (Editor's pick, Nonstop this week, Seasonal & ending soon, Connections
 * only) or, with a search, filters, a region, a sort or ?view=all, the full
 * results list. Out-of-coverage weeks show the coverage state instead.
 */
@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    RouterLink, IconComponent, HubPickerComponent, SegComponent, WeekStripComponent, PhotoCardComponent, DestRowComponent,
    WeekCardComponent, ResultsListComponent, FilterSheetComponent, FilterChipsComponent, TodayBannerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page home">
      <app-today-banner />
      <div class="hero">
        <div class="hero__main">
          @if (narrow()) {
            <div class="mtitle">
              <div><p class="greet ui-sub">{{ greet() }}</p><h1 class="ui-h2 where">Where to?</h1></div>
              <app-hub-picker [hub]="state.hub()" size="sm" (hubChange)="state.setHub($event)" />
            </div>
          } @else {
            <p class="greet ui-sub">{{ greet() }}</p>
            <div class="title"><h1 class="ui-display">Flying from</h1>
              <app-hub-picker [hub]="state.hub()" size="lg" (hubChange)="state.setHub($event)" /></div>
          }
          <div class="srow">
            <label class="ui-search ui-glass search">
              <app-icon name="search" [size]="18" [strokeWidth]="2" />
              <span class="ui-visually-hidden">Search destinations</span>
              <input type="search" data-search-input autocomplete="off" enterkeyhint="search" [placeholder]="placeholder()"
                     [value]="draft()" (input)="onSearch($event)" (keydown.escape)="clearSearch($event)">
              @if (draft()) {
                <button type="button" class="x" (click)="clearSearch()" aria-label="Clear search"><app-icon name="close" [size]="16" [strokeWidth]="2.2" /></button>
              }
              <button type="button" class="f" (click)="filtersOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-label]="'Filter and sort' + (badge() ? ', ' + badge() + ' active' : '')">
                <app-icon name="filter" [size]="18" [strokeWidth]="2" />
                @if (badge()) { <span class="badge tn" aria-hidden="true">{{ badge() }}</span> }
              </button>
            </label>
            <app-seg class="conn" glass ariaLabel="Flights shown" [options]="connectOptions"
                     [value]="state.showConnections() ? 'connect' : 'direct'" (valueChange)="state.setShowConnections($event === 'connect')" />
          </div>
          <app-week-strip class="strip" glass shortcuts [weekStartKey]="state.weekStartKey()" [selectedDateKey]="state.selectedDateKey()"
                          [todayKey]="state.todayKey()" [coverage]="state.coverage()" [dots]="stripDots()"
                          (selectDay)="state.selectDay($event)" (prev)="state.prevWeek()" (next)="state.nextWeek()" (jumpTo)="state.jumpTo($event)" />
        </div>
        @if (wide()) {
          <app-week-card [hub]="state.hub()" [range]="range()" [stats]="state.stats()" [entries]="state.allRoutes()"
                         [highlight]="picks()[0]?.code ?? null" />
        }
      </div>

      @if (outside() || resultsMode()) {
        <section class="sec results" aria-label="Destinations">
          @if (!outside()) {
            <div class="ui-sec-h rhead">
              <h2 class="ui-h2">{{ resultsTitle() }} <span class="count tn">{{ results().length + places().length }}</span></h2>
              @if (viewAll()) { <a class="ui-link" [routerLink]="[]" [queryParams]="{ view: null }" queryParamsHandling="merge" [replaceUrl]="true">Back to Explore</a> }
            </div>
            <div class="regions ui-snap-row" role="group" aria-label="Region">
              @for (r of regions; track r) {
                <button type="button" class="rchip" [attr.aria-pressed]="state.region() === r" (click)="setRegion(r)">
                  {{ r === 'All' ? 'All regions' : r === 'Starred' ? '★ Starred' : r }}</button>
              }
            </div>
            <app-filter-chips class="chips" [showRegion]="false" (cleared)="leaveAll()" />
          }
          <app-results-list [entries]="results()" [coverage]="state.coverage()" [weekStartKey]="state.weekStartKey()"
                            [selectedDateKey]="state.selectedDateKey()" [todayKey]="state.todayKey()" [hubName]="hubName()"
                            [hasActiveFilters]="state.hasActiveFilters() || !!state.query()" [showConnections]="state.showConnections()"
                            [timeFormat]="state.timeFormat()" [favourites]="state.favouriteSet()" [compact]="narrow()"
                            [places]="places()" [placeParams]="placeParams()"
                            (clearFilters)="clearAll()" (jumpToCoverage)="state.jumpToCoverage($event)"
                            (toggleFavourite)="state.toggleFavourite($event)" />
        </section>
      } @else {
        @if (picks().length) {
          <section class="sec" aria-labelledby="h-picks">
            <div class="ui-sec-h"><h2 class="ui-h2 st" id="h-picks">Editor's pick</h2>
              <a [routerLink]="[]" [queryParams]="{ view: 'all' }" queryParamsHandling="merge" [replaceUrl]="true">See all</a></div>
            <div class="picks ui-snap-row">
              @for (p of picks(); track p.code) {
                <app-photo-card class="pick" [code]="p.code" [title]="p.city" [meta]="narrow() ? p.metaShort : p.meta"
                                [badge]="narrow() ? p.badgeShort : p.badge" [link]="dest(p.code)" />
              }
            </div>
          </section>
        }

        <div class="lists">
          <section class="lc ui-card" aria-labelledby="h-nonstop">
            <div class="ui-sec-h lh"><h2 class="ui-h2 st" id="h-nonstop">{{ nonstopTitle() }}</h2>
              @if (!narrow()) {
                <span class="dow" aria-hidden="true">@for (l of dayLetters; track $index) {<i>{{ l }}</i>}</span>
              }
            </div>
            @for (r of nonstop(); track r.code) {
              <app-dest-row [code]="r.code" [small]="r.small" [meta]="r.meta" [link]="dest(r.code)" [dots]="r.dots" [selectedDay]="focus()" />
            } @empty {
              <p class="none ui-sub">No nonstop flights {{ state.selectedDateKey() ? 'on this day' : 'this week' }}.</p>
            }
            @if (nonstopCount() > listLimit()) {
              <button type="button" class="ui-link showall" (click)="nonstopOpen.set(!nonstopOpen())" [attr.aria-expanded]="nonstopOpen()">
                {{ nonstopOpen() ? 'Show less' : 'Show all ' + nonstopCount() + ' nonstop' }}</button>
            }
          </section>

          @if (connections().length) {
            <section class="lc ui-card" aria-labelledby="h-conn">
              <div class="ui-sec-h lh"><h2 class="ui-h2 st" id="h-conn">Connections only</h2>
                @if (!narrow()) {
                  <span class="dow" aria-hidden="true">@for (l of dayLetters; track $index) {<i>{{ l }}</i>}</span>
                }
              </div>
              @for (r of connections(); track r.code) {
                <app-dest-row [code]="r.code" [small]="r.small" [meta]="r.meta" [link]="dest(r.code)" [dots]="r.dots" [selectedDay]="focus()" />
              }
              @if (connectionCount() > listLimit()) {
                <button type="button" class="ui-link showall" (click)="connOpen.set(!connOpen())" [attr.aria-expanded]="connOpen()">
                  {{ connOpen() ? 'Show less' : 'Show all ' + connectionCount() + ' connecting' }}</button>
              }
            </section>
          }

          @if (seasonal().length) {
            <section class="lc ui-card" [class.lc--wide]="connections().length > 0" aria-labelledby="h-season">
              <div class="ui-sec-h lh"><h2 class="ui-h2 st" id="h-season">Seasonal &amp; ending soon</h2></div>
              <div [class.cols]="connections().length > 0">
              @for (r of seasonRows(); track r.code) {
                <app-dest-row [code]="r.code" [small]="r.small" [meta]="r.meta" [link]="dest(r.code)">
                  <span trailing class="ui-tag tn" [class]="'ui-tag--' + r.tag!.tone">{{ r.tag!.text }}</span>
                </app-dest-row>
              }
              </div>
              @if (seasonal().length > seasonLimit()) {
                <button type="button" class="ui-link showall" (click)="seasonOpen.set(!seasonOpen())" [attr.aria-expanded]="seasonOpen()">
                  {{ seasonOpen() ? 'Show less' : 'Show all ' + seasonal().length + ' seasonal' }}</button>
              }
            </section>
          }

        </div>
      }
    </div>
    <app-filter-sheet [(open)]="filtersOpen" />
  `,
  styles: [`
    :host { display: block; }
    .hero { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 32px; margin-top: 40px; align-items: start; }
    .hero__main { min-width: 0; }
    .greet { font-size: 15px; }
    .title { display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
    .srow { display: flex; gap: 12px; margin-top: 22px; }
    .search { flex: 1; }
    .search input[type='search'] { font-family: inherit; }
    .x { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--ink-3); }
    .x:hover { color: var(--ink); background: var(--fill); }
    .badge {
      position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
      display: grid; place-items: center; background: var(--red-fill); color: #FFFFFF; font-size: 11px; font-weight: 700;
      box-shadow: 0 0 0 2px var(--bg);
    }
    .conn { align-self: center; }
    .strip { margin-top: 14px; }

    .sec { margin-top: 40px; }
    .st { margin: 0; }
    .picks { gap: 16px; }
    .pick { width: calc((100% - 80px) / 6); min-width: 150px; }

    .lists { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 40px; align-items: start; }
    .lc { padding: 18px 22px 6px; min-width: 0; }
    .lh { margin-bottom: 4px; align-items: center; }
    /* Text links in section heads: a 44px-tall hit area without moving the layout. */
    .ui-sec-h > a, .ui-sec-h > .more { position: relative; padding: 13px 8px; margin: -13px -8px; }
    .dow { display: flex; gap: 4px; margin-right: 29px; }
    .dow i { width: 7px; display: flex; justify-content: center; font-style: normal; font-size: 10px; font-weight: 600; color: var(--ink-3); }
    .lc--wide { grid-column: 1 / -1; }
    .cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 40px; }
    .cols app-dest-row:nth-last-child(2):nth-child(odd) { border-bottom: 0; }
    .more { font-size: 13px; }
    .showall { display: block; width: 100%; padding: 14px 0 12px; font-size: 13.5px; font-weight: 600; text-align: center; }
    .none { padding: 14px 0 18px; }

    .rhead { align-items: center; }
    .rhead .ui-h2 { margin: 0; }
    .count { color: var(--ink-3); font-weight: 600; margin-left: 4px; }
    .regions { gap: 8px; margin-bottom: 10px; padding: 2px 0; }
    .rchip {
      flex: none; padding: 7px 13px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap;
      background: var(--glass); color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--hair);
    }
    .rchip:hover { color: var(--ink); }
    .rchip[aria-pressed='true'] { background: var(--ink); color: var(--bg); box-shadow: none; }
    .chips { margin-bottom: 14px; }

    @media (max-width: 1023px) {
      .hero { grid-template-columns: minmax(0, 1fr); margin-top: 28px; }
      .lists { grid-template-columns: minmax(0, 1fr); }
      .cols { grid-template-columns: minmax(0, 1fr); }
      .cols app-dest-row:nth-last-child(2):nth-child(odd) { border-bottom: 1px solid var(--hair); }
    }
    @media (max-width: 719px) {
      .hero { margin-top: 0; gap: 0; }
      .mtitle { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
      .greet { font-size: 13.5px; }
      .where { font-size: 26px; margin: 0; }
      .srow { margin-top: 16px; }
      .conn { display: none; }
      .strip { margin-top: 12px; }
      .sec { margin-top: 22px; }
      .st { font-size: 19px; letter-spacing: -.01em; }
      .picks { gap: 12px; margin: 0 calc(-1 * var(--gutter)); padding: 0 var(--gutter); scroll-padding: 0 var(--gutter); }
      .pick { width: 160px; min-width: 0; }
      .lists { gap: 22px; margin-top: 22px; }
      .lc { padding: 0; background: none; border: 0; box-shadow: none; border-radius: 0; }
      .lh { margin-bottom: 0; }
      .rhead .ui-h2 { font-size: 19px; }
    }
  `],
})
export class HomePage {
  protected readonly state = inject(AppStateService);
  private readonly photos = inject(PhotoService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly doc = inject(DOCUMENT);
  private readonly cities = inject(CityIndexService);

  protected readonly connectOptions = CONNECT_OPTIONS;
  protected readonly dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  protected readonly regions = REGION_CHIPS;
  protected readonly filtersOpen = signal(false);
  protected readonly seasonOpen = signal(false);
  protected readonly nonstopOpen = signal(false);
  protected readonly connOpen = signal(false);

  // ── Viewport ──────────────────────────────────────────────────────────────
  private readonly mqNarrow = this.doc.defaultView?.matchMedia?.(NARROW_QUERY) ?? null;
  private readonly mqWide = this.doc.defaultView?.matchMedia?.('(min-width: 1024px)') ?? null;
  /** < 720px: the phone layout. */
  readonly narrow = signal(this.mqNarrow?.matches ?? false);
  /** ≥ 1024px: the "This week" card. */
  readonly wide = signal(this.mqWide?.matches ?? true);

  // ── Search draft (setQuery trims, so the field keeps its own text) ────────
  protected readonly draft = signal(this.state.query());

  constructor() {
    const onNarrow = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    const onWide = (e: MediaQueryListEvent) => this.wide.set(e.matches);
    this.mqNarrow?.addEventListener?.('change', onNarrow);
    this.mqWide?.addEventListener?.('change', onWide);
    const sub = this.route.queryParamMap.subscribe(p => this.viewAll.set(p.get('view') === 'all'));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      this.mqNarrow?.removeEventListener?.('change', onNarrow);
      this.mqWide?.removeEventListener?.('change', onWide);
    });

    // A search of 3+ characters loads the city index (once) for "Places".
    effect(() => {
      if (this.state.query().trim().length >= PLACES_MIN_QUERY) untracked(() => void this.cities.ensureLoaded());
    });

    // An outside change (Esc in the shell, a chip, Clear, Back) rewrites the field.
    effect(() => {
      const q = this.state.query();
      untracked(() => {
        if (this.draft().trim() !== q) this.draft.set(q);
      });
    });
  }

  // ── URL ───────────────────────────────────────────────────────────────────
  /** ?view=all ("See all"). */
  readonly viewAll = signal(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  readonly hubToday = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));
  protected readonly greet = computed(() => greeting(this.state.nowMs(), airportTz(this.state.hub())));
  protected readonly hubName = computed(() => this.state.hubInfo().name);
  protected readonly range = computed(() => weekRangeLabel(this.state.weekStartKey()));
  protected readonly placeholder = computed(() =>
    this.narrow() ? 'Search destinations' : `Search ${this.state.allRoutes().length} destinations, countries or flight numbers`,
  );
  protected readonly stripDots = computed(() => this.state.stats().departuresByWeekday.map(n => n > 0));
  protected readonly focus = computed(() =>
    focusDayIndex(this.state.weekStartKey(), this.state.selectedDateKey(), this.state.todayKey()),
  );

  /** Filter sheet badge: filters, region and a non-default sort (search shows in the field). */
  readonly badge = computed(() =>
    activeFilterCount(this.state.filters()) + (this.state.region() !== 'All' ? 1 : 0) + (this.state.sort() !== 'az' ? 1 : 0),
  );

  readonly outside = computed(() =>
    ['after', 'before', 'none'].includes(coverageStatus(this.state.coverage(), this.state.weekStartKey(), this.state.selectedDateKey())),
  );

  /** Search, filters, a region, a sort or ?view=all switch to the full list. */
  readonly resultsMode = computed(() =>
    !!this.state.query() || this.state.hasActiveFilters() || this.state.sort() !== 'az' || this.viewAll(),
  );

  readonly results = computed(() => {
    const q = this.state.query();
    return withFlightMatches(this.state.routes(), flightNumberQuery(q) ? this.state.unsearchedRoutes() : [], q);
  });

  /** Cities AC does not fly to, for the "Places" group (Trips v2 §5.3). */
  readonly places = computed(() => {
    const q = this.state.query();
    if (q.trim().length < PLACES_MIN_QUERY || this.cities.status() !== 'ready' || flightNumberQuery(q)) return [];
    return placeRows(this.cities.search(q, 6), q);
  });

  protected readonly placeParams = computed(() => ({
    ...this.state.globalParams(), dep: reachDep(this.state.selectedDateKey(), this.hubToday()),
  }));

  protected readonly resultsTitle = computed(() => {
    if (this.state.query()) return 'Results';
    const day = this.state.selectedDateKey();
    return day ? `From ${this.state.hub()} · ${formatKey(day, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'All destinations';
  });

  readonly picks = computed(() =>
    editorsPicks(this.state.allRoutes(), {
      hasPhoto: c => this.photos.has(c),
      todayKey: this.hubToday(),
      nowMs: this.state.nowMs(),
      timeFormat: this.state.timeFormat(),
    }),
  );

  private readonly nonstopAll = computed(() => nonstopByFrequency(this.state.allRoutes()));
  protected readonly nonstopCount = computed(() => this.nonstopAll().length);

  readonly nonstop = computed<ListRow[]>(() => {
    const short = this.narrow();
    const fmt = this.state.timeFormat();
    return this.nonstopAll()
      .slice(0, this.nonstopOpen() ? undefined : this.listLimit())
      .map(e => ({ code: e.destination.code, small: e.destination.code, meta: rowMeta(e, fmt, short), dots: entryDots(e) }));
  });

  /** Rows shown in Nonstop / Connections before "All N" (fewer on phones). */
  readonly listLimit = computed(() => (this.narrow() ? 4 : 6));

  protected readonly nonstopTitle = computed(() => {
    const day = this.state.selectedDateKey();
    if (!day) return 'Nonstop this week';
    if (this.narrow() && day === this.state.todayKey()) return 'Nonstop today';
    return `Nonstop · ${formatKey(day, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  });

  readonly seasonal = computed(() => seasonEvents(this.state.hub(), this.hubToday()));

  /** Seasonal rows shown before "All N" (fewer on phones). */
  readonly seasonLimit = computed(() => (this.narrow() ? 4 : 6));

  readonly seasonRows = computed<ListRow[]>(() => {
    const short = this.narrow();
    const fmt = this.state.timeFormat();
    const all = this.seasonal();
    return (this.seasonOpen() ? all : all.slice(0, this.seasonLimit())).map(ev => ({
      code: ev.code, small: ev.code, meta: seasonMeta(ev, fmt, short), dots: null,
      tag: { text: ev.label, tone: ev.kind === 'starts' ? 'teal' : 'amber' },
    }));
  });

  private readonly connectAll = computed(() =>
    this.state.showConnections() ? this.state.allRoutes().filter(e => !e.isDirect) : [],
  );
  protected readonly connectionCount = computed(() => this.connectAll().length);

  readonly connections = computed<ListRow[]>(() => {
    const short = this.narrow();
    const fmt = this.state.timeFormat();
    return [...this.connectAll()]
      .sort((a, b) => b.daysFlying - a.daysFlying || a.destination.city.localeCompare(b.destination.city))
      .slice(0, this.connOpen() ? undefined : this.listLimit())
      .map(e => ({ code: e.destination.code, small: e.destination.code, meta: rowMeta(e, fmt, short), dots: entryDots(e) }));
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  protected dest(code: string): string[] {
    return destPath(code);
  }

  onSearch(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.draft.set(v);
    this.state.setQuery(v);
  }

  clearSearch(e?: Event): void {
    if (!this.draft()) return;
    e?.stopPropagation();
    this.draft.set('');
    this.state.setQuery('');
  }

  setRegion(r: string): void {
    this.state.setRegion(this.state.region() === r && r !== 'All' ? 'All' : r);
  }

  /** Empty-state "Clear filters": everything, including the sort. */
  clearAll(): void {
    this.state.clearFilters();
    if (this.state.sort() !== 'az') this.state.setSort('az');
  }

  /** After the chip row's Clear, leave the "See all" view too. */
  leaveAll(): void {
    if (this.viewAll()) void this.router.navigate([], { queryParams: { view: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }
}
