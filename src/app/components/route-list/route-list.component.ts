import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { RouteEntry, HubStats } from '../../utils/routes';
import type { Coverage } from '../../data/schedule-index';
import type { TimeFormat } from '../../state/prefs.service';
import { NOW } from '../../state/app-state.service';
import { airportTz } from '../../utils/airports';
import { WEEKDAY_SHORT, addDays, formatKey, keyToDate, todayKey } from '../../utils/time';
import { RouteCardComponent } from '../route-card/route-card.component';
import { IconComponent } from '../shared/icons.component';

/** Countdown refresh period; one timer for the whole list. */
export const COUNTDOWN_TICK_MS = 30_000;

type CoverageStatus = 'covered' | 'partial' | 'after' | 'before' | 'none';

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

@Component({
  selector: 'app-route-list',
  standalone: true,
  imports: [RouteCardComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rl">
      @if (stats_() && !outside()) {
        <section class="pass" aria-label="This week at a glance">
          <div class="pass__head">
            <span class="ui-label">This week from {{ hubName_() || hubCode_() }}</span>
            <span class="pass__code">{{ hubCode_() }}</span>
          </div>
          <div class="pass__grid">
            <div class="tile"><span class="tile__v">{{ stats_()!.directDestinations }}</span><span class="ui-label">Nonstop</span></div>
            <div class="tile"><span class="tile__v">{{ stats_()!.connectingDestinations }}</span><span class="ui-label">One stop</span></div>
            <div class="tile"><span class="tile__v">{{ stats_()!.countries }}</span><span class="ui-label">Countries</span></div>
            <div class="tile tile--chart">
              <div><span class="tile__v">{{ stats_()!.flightsThisWeek }}</span><span class="ui-label">Departures</span></div>
              <div class="bars" role="img" [attr.aria-label]="barsLabel()">
                @for (b of bars(); track $index) {
                  <span class="bar" [class.is-today]="b.today"><i [style.height.%]="b.pct"></i><em>{{ b.letter }}</em></span>
                }
              </div>
            </div>
          </div>
        </section>
      }

      @if (partialNote(); as note) {
        <p class="note ui-num"><app-icon name="info" [size]="16" />{{ note }}</p>
      }

      @if (outside()) {
        <section class="empty" role="status">
          <span class="empty__icon"><app-icon name="calendar" [size]="22" /></span>
          <h2 class="empty__title">{{ outsideTitle() }}</h2>
          <p class="empty__text ui-num">{{ outsideText() }}</p>
          @if (coverage_()?.to) {
            <button type="button" class="ui-btn ui-btn--primary" (click)="jumpBack()">{{ jumpLabel() }}</button>
          }
        </section>
      } @else if (!entries_().length) {
        <section class="empty" role="status">
          <span class="empty__icon"><app-icon name="search" [size]="22" /></span>
          <h2 class="empty__title">{{ emptyTitle() }}</h2>
          <p class="empty__text">{{ emptyText() }}</p>
          @if (hasActiveFilters_()) {
            <button type="button" class="ui-btn" (click)="clearFilters.emit()">Clear filters</button>
          }
        </section>
      } @else {
        @if (direct().length) {
          <h2 class="sec"><span class="sec__t">Direct</span>&ngsp;<span class="sec__n">{{ direct().length }}</span></h2>
          <div class="grid">
            @for (r of direct(); track r.destination.code; let i = $index) {
              <app-route-card class="ui-enter" [style.--i]="i"
                [entry]="r" [hubName]="hubName_()" [selectedDateKey]="selectedDateKey_()"
                [isFavourite]="favSet().has(r.destination.code)" [timeFormat]="timeFormat_()" [now]="cardNow()"
                (open)="open.emit(r.destination.code)" (toggleFavourite)="toggleFavourite.emit(r.destination.code)" />
            }
          </div>
        }
        @if (connecting().length) {
          <h2 class="sec sec--connect"><span class="sec__t">One connection</span>&ngsp;<span class="sec__n">{{ connecting().length }}</span></h2>
          <div class="grid">
            @for (r of connecting(); track r.destination.code; let i = $index) {
              <app-route-card class="ui-enter" [style.--i]="i + direct().length"
                [entry]="r" [hubName]="hubName_()" [selectedDateKey]="selectedDateKey_()"
                [isFavourite]="favSet().has(r.destination.code)" [timeFormat]="timeFormat_()" [now]="cardNow()"
                (open)="open.emit(r.destination.code)" (toggleFavourite)="toggleFavourite.emit(r.destination.code)" />
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .rl { max-width: 1320px; margin: 0 auto; padding: var(--space-4) var(--gutter) calc(var(--space-6) * 2); }

    .pass { margin-bottom: var(--space-5); }
    .pass__head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--space-2); }
    .pass__code { font-family: var(--font-code); font-size: 12px; font-weight: 600; color: var(--ink-3); letter-spacing: .06em; }
    .pass__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }
    .tile {
      display: flex; flex-direction: column-reverse; justify-content: flex-end; gap: 6px; min-width: 0;
      padding: var(--space-3) var(--space-4); border-radius: 14px; background: var(--surface); border: 1px solid var(--line);
    }
    .tile__v { display: block; font-family: var(--font-code); font-size: 26px; font-weight: 600; line-height: 1.05;
      font-variant-numeric: tabular-nums; color: var(--ink); }
    .tile .ui-label { display: block; }
    .tile--chart { flex-direction: row; justify-content: space-between; align-items: flex-end; gap: var(--space-3); }
    .tile--chart > div:first-child { display: flex; flex-direction: column-reverse; gap: 6px; }
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 44px; flex: 0 1 112px; min-width: 70px; }
    .bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
    .bar i { display: block; width: 100%; min-height: 2px; border-radius: 2px; background: var(--line-strong); }
    .bar.is-today i { background: var(--accent); }
    .bar em { font: normal 500 9px/1 var(--font-code); color: var(--ink-3); }
    @media (max-width: 699px) {
      .tile--chart { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: var(--space-2); }
      .bars { flex: none; min-width: 0; height: 30px; }
    }

    .note {
      display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-4); padding: 10px var(--space-3);
      border-radius: 12px; background: var(--warn-soft); color: var(--warn); font-size: 13px; font-weight: 500;
    }

    .sec { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-3); font-size: 13px; font-weight: 600; }
    .grid + .sec { margin-top: var(--space-5); }
    .sec__t { color: var(--ink); letter-spacing: -.005em; }
    .sec__n {
      font-family: var(--font-code); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
      padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok);
    }
    .sec--connect .sec__n { background: var(--connect-soft); color: var(--connect); }
    .sec::after { content: ''; flex: 1; height: 1px; background: var(--line); margin-left: var(--space-2); }

    .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
    @media (min-width: 700px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pass__grid { grid-template-columns: repeat(3, 1fr) 1.6fr; }
    }
    @media (min-width: 1200px) {
      .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    .empty {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-2);
      margin: var(--space-4) auto; max-width: 440px; padding: var(--space-6) var(--space-5);
      border: 1px dashed var(--line-strong); border-radius: var(--radius-card);
    }
    .empty__icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%;
      background: var(--surface-2); color: var(--ink-2); margin-bottom: var(--space-1); }
    .empty__title { margin: 0; font-size: 17px; font-weight: 600; color: var(--ink); }
    .empty__text { margin: 0 0 var(--space-3); font-size: 14px; line-height: 1.5; color: var(--ink-2); }
  `],
})
export class RouteListComponent {
  // ── Inputs (WS3 binding contract; all dates are 'YYYY-MM-DD' keys) ─────────
  // Classic @Input setters backed by signals: the template and computeds read
  // signals, while the shell's spec can still read plain property values.
  protected readonly entries_ = signal<RouteEntry[]>([]);
  protected readonly coverage_ = signal<Coverage | null>(null);
  protected readonly stats_ = signal<HubStats | null>(null);
  protected readonly favourites_ = signal<readonly string[]>([]);
  protected readonly timeFormat_ = signal<TimeFormat>('24h');
  protected readonly weekStartKey_ = signal<string>('');
  protected readonly selectedDateKey_ = signal<string | null>(null);
  protected readonly todayKey_ = signal<string | null>(null);
  protected readonly hubCode_ = signal<string>('YUL');
  protected readonly hubName_ = signal<string>('');
  protected readonly showConnections_ = signal<boolean>(true);
  protected readonly hasActiveFilters_ = signal<boolean>(false);

  @Input() set entries(v: RouteEntry[] | null) { this.entries_.set(v ?? []); }
  get entries(): RouteEntry[] { return this.entries_(); }
  @Input() set coverage(v: Coverage | null) { this.coverage_.set(v); }
  get coverage(): Coverage | null { return this.coverage_(); }
  @Input() set stats(v: HubStats | null) { this.stats_.set(v); }
  get stats(): HubStats | null { return this.stats_(); }
  @Input() set favourites(v: readonly string[] | null) { this.favourites_.set(v ?? []); }
  get favourites(): readonly string[] { return this.favourites_(); }
  @Input() set timeFormat(v: TimeFormat) { this.timeFormat_.set(v ?? '24h'); }
  get timeFormat(): TimeFormat { return this.timeFormat_(); }
  @Input() set weekStartKey(v: string) { this.weekStartKey_.set(v); }
  get weekStartKey(): string { return this.weekStartKey_(); }
  @Input() set selectedDateKey(v: string | null) { this.selectedDateKey_.set(v || null); }
  get selectedDateKey(): string | null { return this.selectedDateKey_(); }
  @Input() set todayKey(v: string | null) { this.todayKey_.set(v); }
  get todayKey(): string | null { return this.todayKey_(); }
  @Input() set hubCode(v: string) { this.hubCode_.set(v); }
  get hubCode(): string { return this.hubCode_(); }
  @Input() set hubName(v: string) { this.hubName_.set(v ?? ''); }
  get hubName(): string { return this.hubName_(); }
  @Input() set showConnections(v: boolean) { this.showConnections_.set(!!v); }
  get showConnections(): boolean { return this.showConnections_(); }
  @Input() set hasActiveFilters(v: boolean) { this.hasActiveFilters_.set(!!v); }
  get hasActiveFilters(): boolean { return this.hasActiveFilters_(); }

  /** @deprecated Pre-WS5 names, read by the shell's spec. Use `entries`, `hubName`, `selectedDateKey`. */
  get routes(): RouteEntry[] { return this.entries_(); }
  /** @deprecated */
  get hubCityName(): string { return this.hubName_(); }
  /** @deprecated */
  get selectedDate(): Date | null { const k = this.selectedDateKey_(); return k ? keyToDate(k) : null; }

  @Output() open = new EventEmitter<string>();
  @Output() toggleFavourite = new EventEmitter<string>();
  @Output() clearFilters = new EventEmitter<void>();
  /** dateKey to jump to, or null for the latest covered week (coverage.to). */
  @Output() jumpToCoverage = new EventEmitter<string | null>();

  // ── Clock: one timer for every card's countdown (critique 37) ─────────────
  private readonly clock = inject(NOW);
  readonly now = signal(this.clock());

  constructor() {
    const id = setInterval(() => this.now.set(this.clock()), COUNTDOWN_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  /** Today's date at the origin airport, not on the device. */
  readonly originTodayKey = computed(() => todayKey(airportTz(this.hubCode_()), this.now()));
  /** Passed to cards only when the selected day is today at the origin; otherwise null (no per-minute re-render). */
  readonly cardNow = computed(() => {
    const day = this.selectedDateKey_();
    return day && day === this.originTodayKey() ? this.now() : null;
  });

  readonly favSet = computed(() => new Set(this.favourites_()));
  readonly direct = computed(() => this.entries_().filter(r => r.isDirect));
  readonly connecting = computed(() => this.entries_().filter(r => !r.isDirect));

  // ── Coverage ──────────────────────────────────────────────────────────────
  /** The range on screen: the selected day, or the Mon..Sun week. */
  private readonly range = computed(() => {
    const day = this.selectedDateKey_();
    if (day) return { from: day, to: day };
    const ws = this.weekStartKey_();
    return ws ? { from: ws, to: addDays(ws, 6) } : null;
  });

  readonly coverageStatus = computed<CoverageStatus>(() => {
    const c = this.coverage_();
    const r = this.range();
    if (!c || !r) return 'covered';
    if (!c.from || !c.to) return 'none';
    if (r.from > c.to) return 'after';
    if (r.to < c.from) return 'before';
    if (r.to > c.to || r.from < c.from) return 'partial';
    return 'covered';
  });

  readonly outside = computed(() => {
    const s = this.coverageStatus();
    return s === 'after' || s === 'before' || s === 'none';
  });

  private fmt(key: string | null | undefined): string {
    return key ? formatKey(key, LONG_DATE) : '';
  }

  readonly outsideTitle = computed(() => {
    const what = this.selectedDateKey_() ? 'this date' : 'this week';
    switch (this.coverageStatus()) {
      case 'before': return `Schedules for ${what} are no longer available`;
      case 'none': return 'No published schedules yet';
      default: return `Schedules not yet published for ${what}`;
    }
  });

  readonly outsideText = computed(() => {
    const c = this.coverage_();
    const hub = this.hubName_() || this.hubCode_();
    if (!c?.to) return `Air Canada hasn't published a timetable for ${hub} yet.`;
    if (this.coverageStatus() === 'before') return `Published from ${this.fmt(c.from)} through ${this.fmt(c.to)}.`;
    return `Timetables from ${hub} are published through ${this.fmt(c.to)}. Later dates are unknown, not empty.`;
  });

  readonly jumpLabel = computed(() => (this.coverageStatus() === 'before' ? 'Jump to first covered week' : 'Jump to latest covered week'));

  jumpBack(): void {
    this.jumpToCoverage.emit(this.coverageStatus() === 'before' ? this.coverage_()?.from ?? null : null);
  }

  readonly partialNote = computed(() => {
    if (this.coverageStatus() !== 'partial') return null;
    const c = this.coverage_()!;
    const r = this.range()!;
    if (r.to > c.to!) return `Published through ${this.fmt(c.to)}; later days this week are not yet available.`;
    return `Published from ${this.fmt(c.from)}; earlier days this week are not shown.`;
  });

  // ── No results ───────────────────────────────────────────────────────────
  readonly emptyTitle = computed(() => {
    const day = this.selectedDateKey_();
    if (this.hasActiveFilters_()) return 'Nothing matches your filters';
    return day ? `No flights on ${formatKey(day, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'No flights this week';
  });

  readonly emptyText = computed(() => {
    const day = this.selectedDateKey_();
    const hub = this.hubName_() || this.hubCode_();
    if (this.hasActiveFilters_()) {
      return day ? `No flights from ${hub} on this day match the current search and filters.` : `No flights from ${hub} this week match the current search and filters.`;
    }
    const tip = this.showConnections_() ? '' : ' Turn on connections to see one-stop options.';
    return (day ? `Nothing leaves ${hub} on this day. Try another day or the whole week.` : `Nothing leaves ${hub} this week. Try another week.`) + tip;
  });

  // ── Passport chart ───────────────────────────────────────────────────────
  readonly bars = computed(() => {
    const byDay = this.stats_()?.departuresByWeekday ?? [];
    const max = Math.max(1, ...byDay);
    const ws = this.weekStartKey_();
    const today = this.todayKey_();
    return byDay.map((n, i) => ({
      pct: Math.round((n / max) * 100),
      letter: WEEKDAY_SHORT[i]?.[0] ?? '',
      today: !!ws && addDays(ws, i) === today,
    }));
  });

  readonly barsLabel = computed(() =>
    'Departures per day: ' + (this.stats_()?.departuresByWeekday ?? []).map((n, i) => `${WEEKDAY_SHORT[i]} ${n}`).join(', '),
  );
}
