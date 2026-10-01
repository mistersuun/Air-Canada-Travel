import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { DestRowComponent } from '../../ui/dest-row.component';
import { entryDots, type DotDay } from '../../ui/dot-row.component';
import { weekRangeLabel } from '../../ui/format';
import { calendarPath, destPath, flightPath } from '../../ui/links';
import { PhotoCardComponent } from '../../ui/photo-card.component';
import { SegComponent, type SegOption } from '../../ui/seg.component';
import { directItinerary } from '../../utils/connections';
import {
  cardMeta, directDots, footerDays, heroMeta, rowMeta, starredDots, upcoming, watchingMeta, type UpcomingItem,
} from './saved-model';

export type SavedTab = 'upcoming' | 'watching';

const TABS: readonly SegOption[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'watching', label: 'Watching' },
];

/**
 * Saved (/saved): the favourites. Upcoming shows the next nonstop departures
 * as photo cards with countdown badges, then rows; Watching lists every
 * favourite with this week's dots and an unstar toggle (with undo).
 * The tab is ?tab= (replaceUrl), absent for Upcoming.
 */
@Component({
  selector: 'app-saved-page',
  standalone: true,
  imports: [RouterLink, IconComponent, SegComponent, PhotoCardComponent, DestRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page sv">
      <header class="hd">
        <h1 class="ui-h1 ttl">Saved @if (count()) {<span class="ct tn" aria-label="{{ count() }} saved">{{ count() }}</span>}</h1>
        @if (count()) {
          <app-seg class="seg" stretch [options]="tabs" [value]="view()" (valueChange)="setTab($event)" ariaLabel="Saved view" />
        }
      </header>

      @if (!count()) {
        <div class="ui-card empty">
          <span class="empty__ic"><app-icon name="star" [size]="26" /></span>
          <h2 class="ui-h3">Nothing saved yet</h2>
          <p class="ui-sub">Tap ★ on a destination to keep it here.</p>
          <a class="ui-btn" routerLink="/" [queryParams]="state.globalParams()">Explore destinations</a>
        </div>
      } @else if (view() === 'upcoming') {
        @if (cards().length) {
          <div class="cards">
            @for (u of cards(); track u.code; let first = $first) {
              <app-photo-card class="card" [class.card--hero]="first" [code]="u.code" variant="wide"
                              [height]="first ? 250 : 170" bigCode [badge]="u.badge"
                              [meta]="first ? heroMeta(u) : cardMeta(u)" [link]="flightLink(u)">
                @if (first) {
                  <div footer class="ft">
                    <span><app-icon name="plane" [size]="13" [filled]="true" /> Nonstop</span>
                    <span><app-icon name="clock" [size]="13" /> {{ footerDays(u) }}</span>
                    <span><app-icon name="sun" [size]="13" /> {{ u.season }}</span>
                  </div>
                }
              </app-photo-card>
            }
          </div>
        }
        @if (rows().length || up().rest.length) {
          <div class="ui-card list">
            @for (r of rows(); track r.u.code) {
              <app-dest-row [code]="r.u.code" [small]="r.u.code" [meta]="r.meta" [dots]="r.dots" [link]="destPath(r.u.code)" />
            }
            @for (n of up().rest; track n.code) {
              <app-dest-row [code]="n.code" [small]="n.code" [meta]="n.country" [link]="destPath(n.code)">
                @if (n.via) {
                  <span trailing class="ui-tag ui-tag--amber">Via {{ n.via }}</span>
                } @else {
                  <span trailing class="ui-tag ui-tag--neutral">No flights published</span>
                }
              </app-dest-row>
            }
          </div>
        }
      } @else {
        <div class="ui-card list list--watch">
          @for (w of watching(); track w.code) {
            <app-dest-row [code]="w.code" [small]="w.code" [meta]="w.meta" [dots]="w.dots" [link]="destPath(w.code)" [chevron]="false">
              <button trailing type="button" class="unstar" [attr.aria-label]="'Remove ' + w.city + ' from saved'"
                      (click)="unstar($event, w.code, w.city)">
                <app-icon name="star" [size]="20" [filled]="true" />
              </button>
            </app-dest-row>
          }
        </div>
        <p class="ui-sub foot">Showing {{ weekLabel() }} · <a [routerLink]="calendarPath()" [queryParams]="state.globalParams()">Plan dates</a></p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .hd { display: flex; flex-direction: column; gap: 12px; }
    .ttl { font-size: 30px; display: flex; align-items: baseline; gap: 10px; }
    .ct { font-size: 17px; font-weight: 600; color: var(--ink-3); letter-spacing: 0; }
    .seg { width: 100%; }
    .cards { display: grid; gap: 12px; margin-top: 14px; }
    .ft {
      display: flex; gap: 14px; margin-top: 8px; padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, .25); font-size: 11.5px; white-space: nowrap; overflow: hidden;
    }
    .ft span { display: inline-flex; align-items: center; gap: 4px; }
    .list { padding: 4px 14px; margin-top: 12px; }
    .unstar {
      flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
      color: var(--amber); margin-left: 4px;
    }
    .unstar:hover { background: var(--fill); }
    .foot { margin-top: 12px; padding: 0 4px; }
    .foot a { color: var(--blue); font-weight: 600; }
    .empty {
      margin: 24px auto 0; max-width: 420px; padding: 32px 24px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
    }
    .empty__ic {
      width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center;
      background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--amber); margin-bottom: 4px;
    }
    .empty .ui-btn { margin-top: 10px; }
    @media (max-width: 719px) {
      .ttl .ct { display: none; }
    }
    @media (min-width: 720px) {
      .sv { padding-top: 32px; }
      .hd { flex-direction: row; align-items: center; gap: 28px; }
      .ttl { font-size: 34px; }
      .hd .seg { width: 300px; flex: none; }
      .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
      .card { height: 280px !important; }
      .card--hero { grid-column: span 2; }
      .cards:has(.card:only-child) .card--hero { grid-column: 1 / -1; }
      .list { max-width: 720px; margin-top: 24px; }
      .foot { max-width: 720px; }
    }
  `],
})
export class SavedPage {
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  /** ?tab= (bound by the router): 'watching', else Upcoming. */
  readonly tab = input<string>();

  protected readonly tabs = TABS;
  protected readonly destPath = destPath;
  protected readonly calendarPath = calendarPath;
  protected readonly heroMeta = heroMeta;
  protected readonly cardMeta = cardMeta;
  protected readonly footerDays = footerDays;

  readonly view = computed<SavedTab>(() => (this.tab() === 'watching' ? 'watching' : 'upcoming'));
  readonly count = computed(() => this.state.starredThisWeek().length);

  readonly up = computed(() =>
    upcoming(
      this.state.hub(), this.state.favourites(), this.state.todayKey(), this.state.nowMs(),
      this.state.coverage(), this.state.timeFormat(), this.state.connect(),
    ),
  );

  /** The first two departures as photo cards (250px, then 170px). */
  readonly cards = computed(() => this.up().items.slice(0, 2));

  /** The other departures as rows. */
  readonly rows = computed(() => {
    const today = this.state.todayKey();
    const fmt = this.state.timeFormat();
    const byCode = this.state.routeByCode();
    const week = this.state.weekStartKey();
    const cov = this.state.coverage();
    const hub = this.state.hub();
    return this.up().items.slice(2).map(u => {
      const e = byCode.get(u.code);
      const dots: DotDay[] = e ? entryDots(e) : directDots(hub, u.code, week, cov);
      return { u, meta: rowMeta(u, today, fmt), dots };
    });
  });

  readonly watching = computed(() => {
    const week = this.state.weekStartKey();
    const cov = this.state.coverage();
    return this.state.starredThisWeek().map(s => ({
      code: s.code, city: s.city, meta: watchingMeta(s), dots: starredDots(s, week, cov),
    }));
  });

  protected readonly weekLabel = computed(() => weekRangeLabel(this.state.weekStartKey()));

  protected flightLink(u: UpcomingItem): string[] {
    return flightPath(u.code, u.flight.dateKey, directItinerary(u.flight));
  }

  setTab(value: string | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: value === 'watching' ? 'watching' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  /** Unstar with an undo notice ("Removed Lisbon · Undo"). */
  unstar(e: Event, code: string, city: string): void {
    e.preventDefault();
    e.stopPropagation();
    this.state.toggleFavourite(code);
    this.state.flash(`Removed ${city}`, {
      label: 'Undo',
      run: () => {
        if (!this.state.favouriteSet().has(code)) this.state.toggleFavourite(code);
      },
    });
  }
}
