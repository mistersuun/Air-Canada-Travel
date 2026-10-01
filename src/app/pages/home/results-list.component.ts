import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Coverage } from '../../data/schedule-index';
import type { TimeFormat } from '../../state/prefs.service';
import type { RouteEntry } from '../../utils/routes';
import { addDays, formatKey } from '../../utils/time';
import { IconComponent } from '../../components/shared/icons.component';
import { DestRowComponent } from '../../ui/dest-row.component';
import { entryDots } from '../../ui/dot-row.component';
import { destPath } from '../../ui/links';
import { CoverageStatus, coverageStatus, focusDayIndex, rowMeta } from './home-model';

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

interface Row {
  code: string;
  meta: string;
  small: string;
  dots: ReturnType<typeof entryDots> | null;
  fav: boolean;
}

/**
 * Home's results: every route in scope as rows (nonstop first, then one
 * connection), or the coverage / empty state. Re-homed from the retired
 * route-list: same coverage rules, same empty-state wording.
 */
@Component({
  selector: 'app-results-list',
  standalone: true,
  imports: [DestRowComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (partialNote(); as note) {
      <p class="note tn" role="note"><app-icon name="info" [size]="16" />{{ note }}</p>
    }

    @if (outside()) {
      <section class="empty ui-card" role="status">
        <span class="empty__ic"><app-icon name="calendar" [size]="22" /></span>
        <h2 class="ui-h3">{{ outsideTitle() }}</h2>
        <p class="ui-sub tn">{{ outsideText() }}</p>
        @if (coverage()?.to) {
          <button type="button" class="ui-btn" (click)="jumpBack()">{{ jumpLabel() }}</button>
        }
      </section>
    } @else if (!entries().length) {
      <section class="empty ui-card" role="status">
        <span class="empty__ic"><app-icon name="search" [size]="22" /></span>
        <h2 class="ui-h3">{{ emptyTitle() }}</h2>
        <p class="ui-sub">{{ emptyText() }}</p>
        @if (hasActiveFilters()) {
          <button type="button" class="ui-btn ui-btn--dark" (click)="clearFilters.emit()">Clear filters</button>
        }
      </section>
    } @else {
      <div class="groups">
        @if (direct().length) {
          <section class="grp ui-card" aria-labelledby="rl-direct">
            <div class="ui-sec-h"><h2 class="ui-h3" id="rl-direct">Nonstop</h2><span class="ui-tag ui-tag--teal tn">{{ direct().length }}</span></div>
            <div class="rows">
              @for (r of direct(); track r.code) {
                <app-dest-row [code]="r.code" [small]="r.small" [meta]="r.meta" [link]="path(r.code)" [dots]="r.dots" [selectedDay]="focus()">
                  <button trailing type="button" class="star" [class.on]="r.fav" [attr.aria-pressed]="r.fav"
                          [attr.aria-label]="(r.fav ? 'Unstar ' : 'Star ') + r.code" (click)="star($event, r.code)">
                    <app-icon name="star" [size]="18" [filled]="r.fav" />
                  </button>
                </app-dest-row>
              }
            </div>
          </section>
        }
        @if (connecting().length) {
          <section class="grp ui-card" aria-labelledby="rl-conn">
            <div class="ui-sec-h"><h2 class="ui-h3" id="rl-conn">One connection</h2><span class="ui-tag ui-tag--amber tn">{{ connecting().length }}</span></div>
            <div class="rows">
              @for (r of connecting(); track r.code) {
                <app-dest-row [code]="r.code" [small]="r.small" [meta]="r.meta" [link]="path(r.code)" [dots]="r.dots" [selectedDay]="focus()">
                  <button trailing type="button" class="star" [class.on]="r.fav" [attr.aria-pressed]="r.fav"
                          [attr.aria-label]="(r.fav ? 'Unstar ' : 'Star ') + r.code" (click)="star($event, r.code)">
                    <app-icon name="star" [size]="18" [filled]="r.fav" />
                  </button>
                </app-dest-row>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .groups { display: grid; gap: 24px; }
    .grp { padding: 18px 22px 6px; }
    .grp .ui-sec-h { margin-bottom: 4px; align-items: center; }
    .rows { display: grid; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 1024px) {
      .rows { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 40px; }
      .rows app-dest-row:nth-last-child(2):nth-child(odd) { border-bottom: 0; }
    }
    .star {
      flex: none; width: 36px; height: 36px; margin-left: 6px; border-radius: 50%;
      display: grid; place-items: center; color: var(--ink-3);
    }
    .star:hover { color: var(--ink); background: var(--fill); }
    .star.on { color: var(--amber); }
    .note {
      display: flex; align-items: center; gap: 8px; margin: 0 0 14px; padding: 10px 14px; border-radius: 14px;
      background: color-mix(in srgb, var(--amber) 13%, transparent); color: var(--amber); font-size: 13px; font-weight: 500;
    }
    .empty {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;
      margin: 0 auto; max-width: 480px; padding: 32px 24px;
    }
    .empty__ic {
      display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%;
      background: var(--fill); color: var(--ink-2); margin-bottom: 4px;
    }
    .empty .ui-sub { margin: 0 0 8px; line-height: 1.5; }
    @media (max-width: 719px) {
      .groups { gap: 18px; }
      .grp { padding: 14px 16px 4px; }
    }
  `],
})
export class ResultsListComponent {
  readonly entries = input<readonly RouteEntry[]>([]);
  readonly coverage = input<Coverage | null>(null);
  readonly weekStartKey = input.required<string>();
  readonly selectedDateKey = input<string | null>(null);
  readonly todayKey = input<string>('');
  readonly hubName = input('');
  readonly hasActiveFilters = input(false);
  readonly showConnections = input(true);
  readonly timeFormat = input<TimeFormat>('24h');
  readonly favourites = input<ReadonlySet<string>>(new Set());
  /** Phone layout: rows drop the week dots to keep the meta readable. */
  readonly compact = input(false);

  readonly clearFilters = output<void>();
  /** Date key to jump to, or null for the last published week. */
  readonly jumpToCoverage = output<string | null>();
  readonly toggleFavourite = output<string>();

  protected readonly focus = computed(() => focusDayIndex(this.weekStartKey(), this.selectedDateKey(), this.todayKey()));

  private toRow(e: RouteEntry): Row {
    const it = e.itinerary ?? e.weekSummary?.days.find(d => d.best)?.best;
    return {
      code: e.destination.code,
      small: e.isDirect || !it?.hubs.length ? e.destination.code : `${e.destination.code} · via ${it.hubs.join(' ')}`,
      meta: rowMeta(e, this.timeFormat()),
      dots: this.compact() ? null : entryDots(e),
      fav: this.favourites().has(e.destination.code),
    };
  }

  readonly direct = computed(() => this.entries().filter(e => e.isDirect).map(e => this.toRow(e)));
  readonly connecting = computed(() => this.entries().filter(e => !e.isDirect).map(e => this.toRow(e)));

  protected path(code: string): string[] {
    return destPath(code);
  }

  protected star(e: Event, code: string): void {
    e.preventDefault();
    e.stopPropagation();
    this.toggleFavourite.emit(code);
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  readonly status = computed<CoverageStatus>(() => coverageStatus(this.coverage(), this.weekStartKey(), this.selectedDateKey()));
  readonly outside = computed(() => ['after', 'before', 'none'].includes(this.status()));

  private fmt(key: string | null | undefined): string {
    return key ? formatKey(key, LONG_DATE) : '';
  }

  readonly outsideTitle = computed(() => {
    const what = this.selectedDateKey() ? 'this date' : 'this week';
    switch (this.status()) {
      case 'before': return `Schedules for ${what} are no longer available`;
      case 'none': return 'No published schedules yet';
      default: return `Schedules for ${what} aren't published yet`;
    }
  });

  readonly outsideText = computed(() => {
    const c = this.coverage();
    const hub = this.hubName();
    if (!c?.to) return `Air Canada hasn't published a timetable for ${hub} yet.`;
    if (this.status() === 'before') return `Published from ${this.fmt(c.from)} through ${this.fmt(c.to)}.`;
    return `Timetables from ${hub} are published through ${this.fmt(c.to)}. Later dates are unknown, not empty.`;
  });

  readonly jumpLabel = computed(() => (this.status() === 'before' ? 'Go to first published week' : 'Go to last published week'));

  jumpBack(): void {
    this.jumpToCoverage.emit(this.status() === 'before' ? this.coverage()?.from ?? null : null);
  }

  /** Days of the week outside the window, unless they are all in the past (a window that just started). */
  readonly partialNote = computed(() => {
    if (this.status() !== 'partial') return null;
    const c = this.coverage()!;
    if (c.to && addDays(this.weekStartKey(), 6) > c.to) return `Published through ${this.fmt(c.to)}; later days this week are not yet available.`;
    const today = this.todayKey();
    if (today && c.from && c.from <= today) return null;
    return `Published from ${this.fmt(c.from)}; earlier days this week are not shown.`;
  });

  // ── No results ───────────────────────────────────────────────────────────
  readonly emptyTitle = computed(() => {
    const day = this.selectedDateKey();
    if (this.hasActiveFilters()) return 'No destinations match';
    return day ? `No flights on ${formatKey(day, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'No flights this week';
  });

  readonly emptyText = computed(() => {
    const day = this.selectedDateKey();
    const hub = this.hubName();
    if (this.hasActiveFilters()) {
      return day ? `No flights from ${hub} on this day match the current search and filters.` : `No flights from ${hub} this week match the current search and filters.`;
    }
    const tip = this.showConnections() ? '' : ' Turn on connections to see one-stop options.';
    return (day ? `Nothing leaves ${hub} on this day. Try another day or the whole week.` : `Nothing leaves ${hub} this week. Try another week.`) + tip;
  });
}
