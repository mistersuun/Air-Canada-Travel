import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, linkedSignal, signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import { ShareService } from '../../state/share.service';
import { findDestination, getOrigins } from '../../utils/airports';
import { formatKm, greatCircleKm } from '../../utils/geo';
import type { Itinerary } from '../../utils/connections';
import { addDays, formatKey } from '../../utils/time';
import { nextFlightDate } from '../../utils/week';
import { IconComponent } from '../../components/shared/icons.component';
import { SegComponent, type SegOption } from '../../ui/seg.component';
import { RouteMapComponent, type MapPoint } from '../../ui/route-map.component';
import { DestPhotoComponent } from '../../ui/dest-photo.component';
import { calendarPath, flightPath } from '../../ui/links';
import { hubDisplayName, tzDiffLabel } from '../../ui/format';
import { currencyName } from './currency';
import {
  HORIZON_DAYS, bestHub, destState, destSummary, nextConnectionDate, nextDeparture, placeLabel, timelineItems, upcoming,
  zoneAbbr,
} from './dest-model';
import { DestTimelineComponent } from './dest-timeline.component';
import { MonthAvailabilityComponent } from './month-availability.component';
import { DestHomeByComponent } from './dest-home-by.component';
import { DestTripActionsComponent } from './dest-trip-actions.component';

export type DestTab = 'departures' | 'returns' | 'map';
const TABS: readonly SegOption[] = [
  { value: 'departures', label: 'Departures' },
  { value: 'returns', label: 'Returns' },
  { value: 'map', label: 'Map' },
];

/** Timeline rows shown before "Show more" (mobile shows one fewer). */
export const PAGE_SIZE = 5;
const MOBILE_QUERY = '(max-width: 719px)';
const DESKTOP_QUERY = '(min-width: 1024px)';
/** Beyond this distance the map card shows the whole world. */
export const LONG_HAUL_KM = 7000;
/** East of this longitude a world-view label would run off the map. */
const WORLD_LABEL_MAX_LNG = 110;
const AC_URL = 'https://www.aircanada.com/';

/**
 * Destination page, /to/:code (spec §4.2). A full-bleed photo with glass
 * circle buttons, then:
 *  - desktop: a glass header card overlapping the photo (title, tags, next
 *    departure, actions) and three columns: next departures, return flights
 *    (Nonstop / Via seg) and map + Essentials, then the month availability;
 *  - mobile: a glass sheet with a Departures / Returns / Map seg (?tab=).
 * States: outside coverage, no nonstop this week, connections only, not served.
 */
@Component({
  selector: 'app-destination-page',
  standalone: true,
  imports: [
    RouterLink, IconComponent, SegComponent, RouteMapComponent, DestPhotoComponent, DestTimelineComponent,
    MonthAvailabilityComponent, DestTripActionsComponent, DestHomeByComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = dest();
    @let s = summary();
    <header class="hero">
      <app-dest-photo class="hero__img" [code]="code()" size="hero" eager [alt]="photoAlt()" (photoShown)="heroShown.set($event)" />
      <div class="hero__bar">
        <button type="button" class="ui-circ" aria-label="Back" (click)="back()">
          <app-icon name="arrow-left" [size]="18" />
        </button>
        <div class="hero__acts">
          <button type="button" class="ui-circ" aria-label="Share" (click)="shareIt()">
            <app-icon name="share" [size]="18" />
          </button>
          <button type="button" class="ui-circ star" [attr.aria-pressed]="isFav()"
                  [attr.aria-label]="isFav() ? 'Remove ' + city() + ' from Saved' : 'Save ' + city()"
                  (click)="toggleFav()">
            <app-icon name="star" [size]="18" [filled]="isFav()" />
          </button>
        </div>
      </div>
      @if (heroShown() && credit(); as c) {
        <p class="credit">
          <a [href]="c.sourceUrl" target="_blank" rel="noopener">Photo</a> ·
          @if (c.authorUrl) { <a [href]="c.authorUrl" target="_blank" rel="noopener">{{ c.author }}</a> } @else { {{ c.author }} } ·
          @if (c.licenseUrl) { <a [href]="c.licenseUrl" target="_blank" rel="noopener license">{{ c.license }}</a> } @else { {{ c.license }} }
        </p>
      }
    </header>

    <div class="body">
      <div class="handle" aria-hidden="true"></div>

      <section class="head" aria-labelledby="dest-title">
        <div class="head__main">
          <p class="ui-sub">{{ place() }}</p>
          <h1 id="dest-title" class="title">
            <span class="city">{{ city() }}</span>{{ ' ' }}<span class="code ui-cond">{{ code() }}</span>
          </h1>
          <div class="tags d-only">
            @if (s.stops) {
              <span class="ui-tag" [class.ui-tag--teal]="s.direct" [class.ui-tag--amber]="!s.direct">{{ s.stops }}</span>
            }
            @if (s.operates) { <span class="ui-tag ui-tag--blue">{{ s.operates }}</span> }
            @if (s.aircraft) { <span class="ui-tag ui-tag--neutral">{{ s.aircraft }}</span> }
            <span class="ui-tag ui-tag--neutral">{{ s.season }}</span>
          </div>
          @if (s.meta) { <p class="ui-sub tn meta m-only">{{ s.meta }}</p> }
        </div>
        @if (next(); as n) {
          <a class="next d-only" [routerLink]="flightLink(n.it)" [queryParams]="state.globalParams()">
            <span class="ui-sub">Next departure</span>
            <span class="next__when tn">{{ n.when }}</span>
            <span class="ui-sub tn">{{ n.detail }}</span>
          </a>
        }
        <div class="head__btns d-only">
          <a class="ui-btn ui-btn--ghost" [routerLink]="calLink()" [queryParams]="state.globalParams()">Plan dates</a>
          <a class="ui-btn wide" [href]="acUrl" target="_blank" rel="noopener">Open in aircanada.com</a>
        </div>
        <app-dest-trip-actions class="d-only" [code]="code()" />
      </section>

      <app-seg class="tabs m-only" stretch [options]="tabs" [value]="tab()" (valueChange)="setTab($event)"
               ariaLabel="Destination sections" />

      @switch (status().kind) {
        @case ('outside') {
          <div class="notice" role="status">
            <span class="ui-tag ui-tag--amber">Not published</span>
            <p>Schedules for {{ weekLabel() }} aren't published yet.</p>
            <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="state.jumpToCoverage()">Go to last published week</button>
          </div>
        }
        @case ('no-nonstop') {
          <div class="notice" role="status">
            @if (nextNonstop(); as nn) {
              <span class="ui-tag ui-tag--amber">No nonstop this week</span>
              <p>Next nonstop: <b class="tn">{{ nn.label }}</b>.</p>
            } @else {
              <span class="ui-tag ui-tag--amber">Connections only</span>
              <p>No nonstop from {{ hubName() }} is published.
                @if (!state.showConnections()) { Turn on connections to see the ways there. }
              </p>
            }
            <div class="notice__acts">
              @if (nextNonstop(); as nn) {
                <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="state.goToWeek(nn.key)">Go to that week</button>
              }
              @if (hasConnections() && !state.showConnections()) {
                <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="state.setShowConnections(true)">Show connections</button>
              }
            </div>
          </div>
        }
        @case ('not-served') {
          <div class="notice" role="status">
            <span class="ui-tag ui-tag--red">Not served</span>
            <p>Not currently served from {{ hubName() }}.
              @if (otherHubs().length) { Flies from: }
            </p>
            @if (otherHubs().length) {
              <div class="notice__acts">
                @for (o of otherHubs(); track o.code) {
                  <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="state.setHub(o.code)">
                    {{ o.name }} <span class="ui-sub">{{ o.code }}</span>
                  </button>
                }
              </div>
            }
          </div>
        }
      }

      <section class="card dep" [class.is-empty]="!outItems().length" [class.m-hide]="tab() !== 'departures'" aria-labelledby="dep-h">
        <app-dest-trip-actions class="m-only" [code]="code()" />
        <div class="ui-sec-h d-only">
          <h2 id="dep-h" class="ui-h3">Next departures</h2>
          <span class="ui-tag ui-tag--blue">{{ state.hub() }} → {{ code() }}</span>
        </div>
        @if (outOptions().length) {
          <app-seg class="out-seg" [options]="outOptions()" [value]="outMode()" (valueChange)="setOutMode($event)"
                   ariaLabel="Departures" />
        }
        <app-dest-timeline [items]="outItems()" [code]="code()" linked [more]="outMore()" (showMore)="outLimit.set(outLimit() + 5)"
                           [label]="'Departures from ' + hubName()">
          <div class="empty">
            @if (nextAhead(); as na) {
              <p>No nonstop in the next {{ horizonWeeks }} weeks.</p>
              <button type="button" class="ui-link" (click)="state.jumpTo(na.key)">Next flight: {{ na.label }}</button>
            } @else if (hasConnections() && !state.showConnections()) {
              <p>Only connections fly here from {{ hubName() }}.</p>
              <button type="button" class="ui-link" (click)="state.setShowConnections(true)">Show connections</button>
            } @else if (farConnection(); as fc) {
              <p>No connections in the next {{ horizonWeeks }} weeks.</p>
              <button type="button" class="ui-link" (click)="state.jumpTo(fc.key)">Next connection: {{ fc.label }}</button>
            } @else {
              <p>No departures published from {{ hubName() }}.</p>
            }
          </div>
        </app-dest-timeline>
      </section>

      <section class="card ret" [class.is-empty]="!retItems().length" [class.m-hide]="tab() !== 'returns'" aria-labelledby="ret-h">
        <div class="ui-sec-h ret__h">
          <h2 id="ret-h" class="ui-h3">Return flights</h2>
          @if (retOptions().length > 1) {
            <app-seg [options]="retOptions()" [value]="retMode()" (valueChange)="setRetMode($event)"
                     ariaLabel="Return flights" />
          }
        </div>
        <app-dest-timeline [items]="retItems()" [more]="retMore()" (showMore)="retLimit.set(retLimit() + 5)"
                           [label]="'Returns to ' + hubName()">
          <div class="empty"><p>No return flights to {{ hubName() }} in the next {{ horizonWeeks }} weeks.</p></div>
        </app-dest-timeline>
        <app-dest-home-by [code]="code()" />
      </section>

      <div class="side" [class.m-hide]="tab() !== 'map'">
        <section class="card mapc" aria-label="Route map">
          @defer (on viewport) {
            <app-route-map class="map" [hub]="state.hub()" [points]="points()" [highlight]="code()" [labels]="mapLabels()"
                           [view]="mapView()" [padding]="mapView() === 'fit' ? 56 : 16" />
          } @placeholder {
            <div class="map map--ph"></div>
          }
          <div class="dist"><span class="ui-sub">Great-circle</span><b class="tn">{{ distance() }}</b></div>
        </section>
        <section class="card ess" aria-labelledby="ess-h">
          <h2 id="ess-h" class="ui-h3 ess__h">Essentials</h2>
          <div class="ui-ess">
            <div><span class="ic"><app-icon name="clock" [size]="16" /></span><span>Time zone</span><b class="tn">{{ tz() }}</b></div>
            <div><span class="ic"><app-icon name="currency" [size]="16" /></span><span>Currency</span><b>{{ currency() || '—' }}</b></div>
            <div><span class="ic"><app-icon name="sun" [size]="16" /></span><span>Season</span><b>{{ s.season }}</b></div>
            <div><span class="ic"><app-icon name="plane" [size]="16" /></span><span>Aircraft</span><b>{{ s.aircraftShort || '—' }}</b></div>
          </div>
        </section>
      </div>

      <section class="card avail" [class.m-hide]="tab() !== 'departures'">
        <app-month-availability [hub]="state.hub()" [dest]="code()" [todayKey]="state.todayKey()"
                                [coverage]="state.coverage()" [selectedDateKey]="state.selectedDateKey()"
                                [showConnections]="state.showConnections()" [connect]="state.connect()"
                                [months]="monthCount()" (pick)="pickDay($event)" />
      </section>

      <div class="m-actions m-only">
        <a class="ui-btn ui-btn--block" [routerLink]="calLink()" [queryParams]="state.globalParams()">Plan dates</a>
        <a class="ui-btn ui-btn--ghost ui-btn--block" [href]="acUrl" target="_blank" rel="noopener">aircanada.com</a>
      </div>
    </div>
    @if (!d) { <p class="ui-visually-hidden">{{ code() }}</p> }
  `,
  styles: [`
    :host { display: block; min-height: 100dvh; background: var(--bg); }

    /* ── Hero ─────────────────────────────────────────────────────────── */
    .hero { position: relative; height: 380px; overflow: hidden; background: var(--fill); }
    .hero__img { position: absolute; inset: 0; }
    .hero::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(180deg, rgba(0, 0, 0, .22), rgba(0, 0, 0, 0) 28%);
    }
    .hero__bar {
      position: absolute; z-index: 2; top: calc(env(safe-area-inset-top) + 12px); left: 16px; right: 16px;
      display: flex; justify-content: space-between;
    }
    .hero__acts { display: flex; gap: 8px; }
    .star[aria-pressed='true'] { color: #FFFFFF; background: var(--red); border-color: color-mix(in srgb, var(--red) 60%, #FFFFFF); }
    .credit {
      position: absolute; z-index: 2; right: 16px; bottom: 72px; max-width: calc(100% - 32px);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 11px; color: #FFFFFF; background: rgba(0, 0, 0, .35); padding: 4px 9px; border-radius: 999px;
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    }
    .credit a { color: inherit; }
    .credit a:hover { text-decoration: underline; }

    /* ── Head ─────────────────────────────────────────────────────────── */
    .head__main { min-width: 0; }
    .title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 2px; }
    .city { font-size: 34px; font-weight: 650; letter-spacing: -.025em; line-height: 1.12; min-width: 0; overflow-wrap: anywhere; }
    .code { font-size: 24px; color: var(--ink-3); flex: none; }
    .meta { margin-top: 2px; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .next { display: flex; flex-direction: column; align-items: flex-end; text-align: right; border-radius: 14px; }
    .next__when { font-size: 30px; font-weight: 650; letter-spacing: -.02em; line-height: 1.2; }
    .next:hover .next__when { color: var(--blue); }
    .head__btns { display: flex; gap: 10px; flex: none; }
    .wide { padding-inline: 22px; }

    .tabs { margin-top: 14px; }
    .notice {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 14px;
      padding: 14px 16px; border-radius: 16px; background: var(--fill); font-size: 13.5px; color: var(--ink-2);
    }
    .notice p { flex: 1 1 220px; min-width: 0; }
    .notice b { color: var(--ink); }
    .notice__acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .empty { padding: 8px 0 4px; font-size: 13.5px; color: var(--ink-2); display: grid; gap: 6px; justify-items: start; }
    .empty .ui-link { font-size: 13.5px; }

    .ret__h { align-items: center; }
    .out-seg { margin: -4px 0 12px; }
    .map { display: block; height: 260px; border-radius: 16px; overflow: hidden; background: var(--sea); }
    .dist { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 4px 0; font-size: 13px; }
    .ess__h { margin-bottom: 12px; }
    .ui-ess .ic { color: var(--blue); }
    .m-actions { display: grid; gap: 10px; margin-top: 24px; }

    /* ── Mobile: the glass sheet ──────────────────────────────────────── */
    @media (max-width: 719px) {
      .d-only { display: none !important; }
      .m-hide { display: none !important; }
      .body {
        position: relative; z-index: 1; margin-top: -60px; min-height: 60vh;
        padding: 10px 20px calc(32px + env(safe-area-inset-bottom));
        border-radius: 30px 30px 0 0;
        background: var(--glass);
        -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
        border: 1px solid var(--glass-b); border-bottom: 0;
      }
      .handle { width: 36px; height: 5px; border-radius: 3px; background: var(--hair); margin: 0 auto 12px; }
      .card { margin-top: 10px; }
      .ret, .side, .avail { margin-top: 16px; }
      .side { display: grid; gap: 22px; }
      .mapc { margin-top: 0; }
      .ess, .mapc { margin-top: 0; }
      .avail { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--hair); }
    }

    /* ── Tablet and up: cards on the page ─────────────────────────────── */
    @media (min-width: 720px) {
      .m-only { display: none !important; }
      .handle { display: none; }
      .hero { height: 360px; }
      .hero__bar { top: 22px; left: 32px; right: 32px; }
      .hero__acts { gap: 10px; }
      .credit { right: 28px; bottom: 104px; max-width: 60%; }
      .body {
        position: relative; z-index: 1; max-width: var(--page-max); margin: -80px auto 0; padding: 0 24px 40px;
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start;
      }
      .head, .notice, .avail { grid-column: 1 / -1; }
      .notice { margin-top: 0; }
      .head {
        display: flex; flex-wrap: wrap; align-items: center; gap: 18px 28px; padding: 24px 28px;
        background: var(--glass); border-radius: var(--radius-card); box-shadow: var(--shadow);
        -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
        border: 1px solid var(--glass-b);
      }
      .head__main { flex: 1 1 320px; }
      .title { justify-content: flex-start; }
      .city { font-size: 48px; line-height: 1.1; }
      .code { font-size: 28px; }
      .card {
        background: var(--surface); border-radius: var(--radius-card); box-shadow: var(--shadow);
        border: 1px solid var(--hair); padding: 20px 22px;
      }
      .dep, .ret { align-self: stretch; }
      .dep.is-empty, .ret.is-empty { align-self: start; }
      .side { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
      .mapc { padding: 14px; }
      .map { height: 170px; border-radius: 14px; }
      .ess { padding: 16px; }
      .notice {
        background: var(--surface); border: 1px solid var(--hair); box-shadow: var(--shadow);
        border-radius: var(--radius-card); padding: 16px 22px;
      }
    }

    @media (min-width: 1024px) {
      .hero { height: 420px; }
      .credit { bottom: 120px; }
      .body { margin-top: -96px; padding: 0 32px 40px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 360px; }
      .side { grid-column: auto; display: flex; flex-direction: column; align-items: stretch; gap: 20px; }
      .head { flex-wrap: nowrap; }
    }
  `],
})
export class DestinationPage {
  protected readonly state = inject(AppStateService);
  private readonly photos = inject(PhotoService);
  private readonly sharer = inject(ShareService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  readonly code = input.required<string>();
  /** ?tab= (mobile seg), bound from the query by withComponentInputBinding. */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  protected readonly tabs = TABS;
  protected readonly acUrl = AC_URL;
  protected readonly horizonWeeks = Math.round(HORIZON_DAYS / 7);

  private readonly mobile = this.media(MOBILE_QUERY);
  private readonly desktop = this.media(DESKTOP_QUERY);
  protected readonly monthCount = computed(() => (this.mobile() ? 1 : this.desktop() ? 3 : 2));

  readonly tab = computed<DestTab>(() => {
    const t = this.tabParam();
    return t === 'returns' || t === 'map' ? t : 'departures';
  });

  // ── Destination facts ─────────────────────────────────────────────────────
  protected readonly dest = computed(() => findDestination(this.code()));
  protected readonly city = computed(() => this.dest()?.city ?? this.code());
  protected readonly place = computed(() => {
    const d = this.dest();
    return d ? placeLabel(d.country, d.region) : '';
  });
  protected readonly hubName = computed(() => hubDisplayName(this.state.hub()));
  protected readonly isFav = computed(() => this.state.favouriteSet().has(this.code()));
  protected readonly credit = computed(() => this.photos.credit(this.code()));
  /** False when the hero fell back to its monogram: the credit hides then. */
  protected readonly heroShown = signal(true);
  protected readonly photoAlt = computed(() => this.credit()?.subject ?? '');

  // ── Timelines ─────────────────────────────────────────────────────────────
  /**
   * Timelines start at the selected day, else at the browsed week's start,
   * and never before today.
   */
  private readonly startKey = computed(() => {
    const today = this.state.todayKey();
    const base = this.state.selectedDateKey() ?? this.state.weekStartKey();
    return base > today ? base : today;
  });

  private readonly outDirect = computed(() =>
    upcoming(this.state.hub(), this.code(), this.startKey(), this.state.nowMs(), 'direct', this.state.connect()));
  /** Connections, looked up only when there is no nonstop ahead. */
  protected readonly outVia = computed(() =>
    this.outDirect().length ? [] : upcoming(this.state.hub(), this.code(), this.startKey(), this.state.nowMs(), 'via', this.state.connect()));
  /** Connections alongside nonstops, looked up only when connections are shown. */
  private readonly outViaAlso = computed(() =>
    this.state.showConnections() && this.outDirect().length
      ? upcoming(this.state.hub(), this.code(), this.startKey(), this.state.nowMs(), 'via', this.state.connect())
      : []);
  /** The user's Nonstop / Via choice for departures; reset when the route changes. */
  private readonly outChoice = linkedSignal<readonly [string, string], 'nonstop' | 'via' | null>({
    source: () => [this.code(), this.state.hub()] as const,
    computation: () => null,
  });
  readonly outMode = computed<'nonstop' | 'via'>(() =>
    this.outChoice() === 'via' && this.outViaAlso().length ? 'via' : 'nonstop');
  protected readonly outOptions = computed<SegOption[]>(() => {
    const via = this.outViaAlso();
    return via.length
      ? [{ value: 'nonstop', label: 'Nonstop' }, { value: 'via', label: `Via ${bestHub(via) ?? 'hub'}` }]
      : [];
  });
  /** What the outbound timeline lists: nonstops (or connections when picked), else connections when shown. */
  private readonly outList = computed(() => {
    if (this.outDirect().length) return this.outMode() === 'via' ? this.outViaAlso() : this.outDirect();
    return this.state.showConnections() ? this.outVia() : [];
  });

  setOutMode(v: string | undefined): void {
    this.outChoice.set(v === 'via' ? 'via' : 'nonstop');
  }

  setRetMode(v: string | undefined): void {
    this.retChoice.set(v === 'via' ? 'via' : 'nonstop');
  }

  private readonly firstLimit = computed(() => (this.mobile() ? PAGE_SIZE - 1 : PAGE_SIZE));
  readonly outLimit = linkedSignal({ source: () => [this.code(), this.startKey(), this.firstLimit()] as const, computation: ([, , n]) => n });
  readonly retLimit = linkedSignal({ source: () => [this.code(), this.startKey(), this.firstLimit()] as const, computation: ([, , n]) => n });

  protected readonly outItems = computed(() =>
    timelineItems(this.outList().slice(0, this.outLimit()), this.state.todayKey(), this.state.nowMs(), this.state.timeFormat()));
  protected readonly outMore = computed(() => this.outList().length > this.outLimit());

  private readonly retDirect = computed(() =>
    upcoming(this.code(), this.state.hub(), this.startKey(), this.state.nowMs(), 'direct', this.state.connect()));
  private readonly retVia = computed(() =>
    upcoming(this.code(), this.state.hub(), this.startKey(), this.state.nowMs(), 'via', this.state.connect()));
  /**
   * The user's Nonstop / Via choice for returns. Keyed on the route only, so
   * the 30s clock tick (which rebuilds the lists) never resets it.
   */
  private readonly retChoice = linkedSignal<readonly [string, string], 'nonstop' | 'via' | null>({
    source: () => [this.code(), this.state.hub()] as const,
    computation: () => null,
  });
  readonly retMode = computed<'nonstop' | 'via'>(() => {
    const c = this.retChoice();
    const direct = this.retDirect().length > 0;
    const via = this.retVia().length > 0;
    if (c === 'via' && via) return 'via';
    if (c === 'nonstop' && direct) return 'nonstop';
    return direct || !via ? 'nonstop' : 'via';
  });
  protected readonly retOptions = computed<SegOption[]>(() => {
    const via = this.retVia();
    const opts: SegOption[] = [{ value: 'nonstop', label: 'Nonstop', disabled: !this.retDirect().length }];
    if (via.length) opts.push({ value: 'via', label: `Via ${bestHub(via) ?? 'hub'}` });
    return opts;
  });
  private readonly retList = computed(() => (this.retMode() === 'via' ? this.retVia() : this.retDirect()));
  protected readonly retItems = computed(() =>
    timelineItems(this.retList().slice(0, this.retLimit()), this.state.todayKey(), this.state.nowMs(), this.state.timeFormat(), false));
  protected readonly retMore = computed(() => this.retList().length > this.retLimit());

  // ── Header ────────────────────────────────────────────────────────────────
  protected readonly summary = computed(() =>
    destSummary(this.state.hub(), this.code(), this.state.weekStartKey(), this.outDirect().length ? this.outDirect() : this.outVia()));
  protected readonly next = computed(() => nextDeparture(this.outList()[0], this.state.todayKey(), this.state.timeFormat()));

  // ── States ────────────────────────────────────────────────────────────────
  /** The next connection beyond the horizon, looked up only when both lists are empty. */
  protected readonly farConnection = computed(() => {
    if (this.outDirect().length || this.outVia().length) return null;
    const key = nextConnectionDate(this.state.hub(), this.code(), addDays(this.startKey(), HORIZON_DAYS), this.state.connect());
    return key ? { key, label: formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }) } : null;
  });
  protected readonly hasConnections = computed(() => this.outVia().length > 0 || !!this.farConnection());
  protected readonly status = computed(() =>
    destState(this.state.hub(), this.code(), this.state.weekStartKey(), this.state.todayKey(), this.state.coverage(), this.hasConnections()));
  protected readonly weekLabel = computed(() => {
    const s = this.status();
    return s.kind === 'outside' ? s.week : '';
  });
  protected readonly nextNonstop = computed(() => {
    const s = this.status();
    return s.kind === 'no-nonstop' && s.next && s.nextLabel ? { key: s.next, label: s.nextLabel } : null;
  });
  /** The next nonstop beyond the timeline's horizon (empty-timeline link). */
  protected readonly nextAhead = computed(() => {
    const key = nextFlightDate(this.state.hub(), this.code(), this.startKey(), false);
    return key ? { key, label: formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }) } : null;
  });
  protected readonly otherHubs = computed(() =>
    getOrigins(this.code()).filter(o => o.isHub && o.code !== this.state.hub()).map(o => ({ code: o.code, name: hubDisplayName(o.code) })));

  // ── Map and Essentials ────────────────────────────────────────────────────
  protected readonly points = computed<MapPoint[]>(() => {
    const d = this.dest();
    return d ? [{ code: d.code, lat: d.lat, lng: d.lng, kind: this.summary().direct || !this.hasConnections() ? 'direct' : 'connect' }] : [];
  });
  private readonly km = computed(() => {
    const d = this.dest();
    return d ? greatCircleKm(this.state.hubInfo(), d) : null;
  });
  protected readonly distance = computed(() => {
    const km = this.km();
    return km === null ? '—' : formatKm(km);
  });
  /** Long-haul routes read better on the whole world; short ones fitted to the arc. */
  /**
   * The destination's label. On the world view, places near its right edge
   * (east Asia, Oceania) would have their label cut off, so they go without.
   */
  protected readonly mapLabels = computed(() => {
    const d = this.dest();
    return !d || (this.mapView() === 'world' && d.lng > WORLD_LABEL_MAX_LNG) ? [] : [d.code];
  });
  protected readonly mapView = computed<'world' | 'fit'>(() => ((this.km() ?? 0) > LONG_HAUL_KM ? 'world' : 'fit'));
  protected readonly tz = computed(() => {
    const d = this.dest();
    if (!d) return '—';
    const now = this.state.nowMs();
    const abbr = zoneAbbr(d.tz, d.iso2, now);
    return [tzDiffLabel(d.tz, this.state.hubInfo().tz, now), abbr].filter(Boolean).join(' · ');
  });
  protected readonly currency = computed(() => currencyName(this.dest()?.iso2));

  // ── Actions ───────────────────────────────────────────────────────────────
  protected flightLink(it: Itinerary): string[] {
    return flightPath(this.code(), it.dateKey, it);
  }

  protected calLink(): string[] {
    return calendarPath(this.code());
  }

  back(): void {
    this.state.goBack(['/']);
  }

  shareIt(): void {
    void this.sharer.share(`Flights to ${this.city()}`);
  }

  toggleFav(): void {
    const code = this.code();
    const city = this.city();
    const was = this.isFav();
    this.state.toggleFavourite(code);
    if (was) {
      this.state.flash(`Removed ${city}`, {
        label: 'Undo',
        run: () => {
          if (!this.state.favouriteSet().has(code)) this.state.toggleFavourite(code);
        },
      });
    } else {
      this.state.flash(`Saved ${city}`);
    }
  }

  setTab(t: string | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: t && t !== 'departures' ? t : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  /** A day tapped in the month availability: the app moves there and the timeline starts on it. */
  pickDay(key: string): void {
    this.state.jumpTo(key);
  }

  /** A media query as a signal (false where matchMedia is missing). */
  private media(query: string) {
    const win = this.doc.defaultView;
    const mql = win?.matchMedia?.(query);
    const sig = signal(!!mql?.matches);
    if (mql?.addEventListener) {
      const on = (e: MediaQueryListEvent) => sig.set(e.matches);
      mql.addEventListener('change', on);
      inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', on));
    }
    return sig.asReadonly();
  }
}
