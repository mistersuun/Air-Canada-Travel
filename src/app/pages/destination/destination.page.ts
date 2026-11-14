import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, linkedSignal, signal, untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink, type Params } from '@angular/router';
import { regionLabel } from '../../i18n/labels';
import { t } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import { RecentService } from '../../state/recent.service';
import { ShareService } from '../../state/share.service';
import { airportTz, findDestination, findHub, getOrigins } from '../../utils/airports';
import { formatKm, greatCircleKm } from '../../utils/geo';
import type { Itinerary } from '../../utils/connections';
import { addDays, formatKey, todayKey } from '../../utils/time';
import { nextFlightDate } from '../../utils/week';
import { IconComponent } from '../../components/shared/icons.component';
import { SegComponent, type SegOption } from '../../ui/seg.component';
import { RouteMapComponent, type MapPoint } from '../../ui/route-map.component';
import { DestPhotoComponent } from '../../ui/dest-photo.component';
import { calendarPath, flightPath, flightSlug, planPath } from '../../ui/links';
import { dayLabel, hubDisplayName, itinKey, prettyFlight, shortRange, tzDiffLabel } from '../../ui/format';
import { tap } from '../../ui/haptics';
import { getDestinationCodes } from '../../data/schedule-index';
import { seasonEvent } from '../home/home-model';
import { dailyFact } from './fun-facts';
import { currencyName } from './currency';
import {
  HORIZON_DAYS, bestHub, destState, destSummary, nextConnectionDate, nextDeparture, placeLabel, timelineItems, upcoming,
  zoneAbbr,
} from './dest-model';
import { routeFacts } from './route-facts';
import { DestTimelineComponent, type TimelineLink } from './dest-timeline.component';
import type { TimelineItem } from './dest-model';
import { DayCountStripComponent } from '../../ui/day-count-strip.component';
import { StayChipsComponent } from '../../ui/stay-chips.component';
import {
  type CountCtx, earliestArrival, homeAfterUtc, landingLabel, minuteOf, nightsBetween, outCounts, outboundsOn, planParams,
  readPlan, shiftRet, stayOptions, stripKeys, waysHome,
} from '../../planner/round-trip';
import { DestClimateComponent } from './dest-climate.component';
import { DestForecastComponent } from './dest-forecast.component';
import { DestWeatherLineComponent } from './dest-weather-line.component';
import { EventsCardComponent } from '../../events/events-card.component';
import { DestReferenceComponent } from '../../reference/dest-reference.component';
import { historyFor, recordAria, recordTag, type HistoryCounts } from '../../trips/engine/track-record';
import { TripsService } from '../../trips/trips.service';
import { DestHomeByComponent } from './dest-home-by.component';
import { DestTripActionsComponent } from './dest-trip-actions.component';
import { DestCompareButtonComponent } from './dest-compare-button.component';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { routeOnlyText } from '../../data/route-network';

/** 'Via YYZ' / 'Via YYZ': the shared 'via {hubs}' with a capital, for a seg option. */
function viaLabel(hub: string | null): string {
  const s = t('format.via', { hubs: hub ?? '—' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type DestTab = 'departures' | 'returns' | 'map';
const TABS = [
  { value: 'departures', label: 'dest.tab.departures' },
  { value: 'returns', label: 'planner.dest.waysHomeTab' },
  { value: 'map', label: 'dest.tab.map' },
] as const;

/** Timeline rows shown before "Show more" (mobile shows one fewer). */
export const PAGE_SIZE = 5;
const MOBILE_QUERY = '(max-width: 719px)';
/** Days on the departures strip. */
const STRIP_DAYS = 14;
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
 *    (Nonstop / Via seg) and map + Essentials;
 *  - mobile: a glass sheet with a Departures / Returns / Map seg (?tab=).
 * States: flown but no times in our data (route network only), outside
 * coverage, no nonstop this week, connections only, not served.
 */
@Component({
  selector: 'app-destination-page',
  standalone: true,
  imports: [
    RouterLink, IconComponent, SegComponent, RouteMapComponent, DestPhotoComponent, DestTimelineComponent,
    DayCountStripComponent, StayChipsComponent, DestTripActionsComponent, DestCompareButtonComponent, DestHomeByComponent, ProvenanceTagComponent, DestClimateComponent, DestForecastComponent, DestWeatherLineComponent,
    DestReferenceComponent, EventsCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = dest();
    @let s = summary();
    <header class="hero">
      <app-dest-photo class="hero__img" [code]="code()" size="hero" eager [alt]="photoAlt()" (photoShown)="heroShown.set($event)" />
      <div class="hero__bar">
        <button type="button" class="ui-circ" [attr.aria-label]="t('ui.back')" (click)="back()">
          <app-icon name="arrow-left" [size]="18" />
        </button>
        <div class="hero__acts">
          <button type="button" class="ui-circ" [attr.aria-label]="t('ui.share')" (click)="shareIt()">
            <app-icon name="share" [size]="18" />
          </button>
          <button type="button" class="ui-circ star" [class.pop]="popped()" (animationend)="popped.set(false)" [attr.aria-pressed]="isFav()"
                  [attr.aria-label]="isFav() ? t('dest.unsave', { city: city() }) : t('dest.save', { city: city() })"
                  (click)="toggleFav()">
            <app-icon name="star" [size]="18" [filled]="isFav()" />
          </button>
        </div>
      </div>
      @if (heroShown() && credit(); as c) {
        <p class="credit">
          <a [href]="c.sourceUrl" target="_blank" rel="noopener">{{ t('settings.photo') }}</a> ·
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
          @if (seasonTag(); as st) { <p class="season"><span class="ui-tag ui-tag--amber" data-season>{{ st }}</span></p> }
          <app-dest-weather-line [code]="code()" [dateKey]="climateDay()" />
        </div>
        @if (next(); as n) {
          <a class="next d-only" [routerLink]="flightLink(n.it)" [queryParams]="state.globalParams()">
            <span class="ui-sub">{{ t('dest.nextDeparture') }}</span>
            <span class="next__when tn">{{ n.when }}</span>
            <span class="ui-sub tn">{{ n.detail }}</span>
          </a>
        }
        <div class="head__btns d-only">
          <a class="ui-btn ui-btn--ghost" [routerLink]="calLink()" [queryParams]="calParams()" data-pick-dates>{{ t('planner.dest.pickDates') }}</a>
          <a class="ui-btn wide" [href]="acUrl" target="_blank" rel="noopener">{{ t('dest.openAc') }}</a>
        </div>
        <a class="ui-link days-off d-only" routerLink="/weekend" [queryParams]="daysOffParams()" data-days-off>{{ t('dest.daysOff') }}</a>
        <app-dest-trip-actions class="d-only" [code]="code()" />
        <app-dest-compare-button class="d-only cmp" [code]="code()" />
      </section>

      @let p = plan();
      <section class="dates" [class.is-set]="!!p.dep" [attr.aria-label]="t('planner.dest.when')" data-dates-bar>
        @if (!p.dep) {
          <div class="dates__row">
            <p class="dates__q">{{ t('planner.dest.when') }}</p>
            <a class="ui-btn ui-btn--sm dates__btn" [routerLink]="calLink()" [queryParams]="calParams()" data-dates-pick>{{ t('planner.dest.pickDates') }}</a>
          </div>
        } @else if (!p.ret) {
          <div class="dates__row">
            <p class="dates__q tn" data-dates-text>{{ t('planner.dest.depOnly', { date: depLabel() }) }}</p>
            <button type="button" class="dates__x" [attr.aria-label]="t('planner.dest.clearDates')" (click)="clearDates()" data-dates-clear>
              <app-icon name="close" [size]="16" [strokeWidth]="2.2" />
            </button>
          </div>
          <app-stay-chips class="dates__chips" [options]="stays()" [dep]="p.dep" [today]="state.todayKey()"
                          [compute]="stayCompute()" (pick)="setRet($event)" />
        } @else {
          <div class="dates__row">
            @let r = rangeLabel();
            <p class="dates__q tn" data-dates-text><span class="nw">{{ r.range }}</span> · <span class="nw">{{ r.stay }}</span></p>
            <a class="ui-btn ui-btn--sm dates__btn" [routerLink]="planLink()" [queryParams]="planQuery()" data-dates-see>{{ t('planner.dest.seeFlights') }}</a>
            <button type="button" class="dates__x" [attr.aria-label]="t('planner.dest.clearDates')" (click)="clearDates()" data-dates-clear>
              <app-icon name="close" [size]="16" [strokeWidth]="2.2" />
            </button>
          </div>
        }
      </section>

      <app-seg class="tabs m-only" stretch [options]="tabs()" [value]="tab()" (valueChange)="setTab($event)"
               [ariaLabel]="t('dest.tabs.aria')" />

      @switch (status().kind) {
        @case ('route-only') {
          <div class="notice" role="status">
            <app-provenance-tag value="unknown" />
            <p>{{ routeOnlyText() }}.
              @if (routeOnlyDetail()) { <span class="ui-sub">{{ routeOnlyDetail() }}</span> }
            </p>
            <div class="notice__acts">
              <a class="ui-btn ui-btn--dark ui-btn--sm" [href]="acUrl" target="_blank" rel="noopener">{{ t('dest.openAc') }}</a>
              @if (hasConnections() && !state.showConnections()) {
                <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="state.setShowConnections(true)">{{ t('dest.showConnections') }}</button>
              }
            </div>
          </div>
        }
        @case ('outside') {
          <div class="notice" role="status">
            <span class="ui-tag ui-tag--amber">{{ t('dest.notPublished') }}</span>
            <p>{{ t('dest.outside', { week: weekLabel() }) }}</p>
            <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="state.jumpToCoverage()">{{ t('dest.lastPublished') }}</button>
          </div>
        }
        @case ('no-nonstop') {
          <div class="notice" role="status">
            @if (nextNonstop(); as nn) {
              <span class="ui-tag ui-tag--amber">{{ t('dest.noNonstopWeek') }}</span>
              <p>{{ t('dest.nextNonstop') }} <b class="tn">{{ nn.label }}</b>.</p>
            } @else {
              <span class="ui-tag ui-tag--amber">{{ t('dest.connectionsOnly') }}</span>
              <p>{{ t('dest.noNonstopFrom', { hub: hubName() }) }}
                @if (!state.showConnections()) { {{ t('dest.turnOnConn') }} }
              </p>
            }
            <div class="notice__acts">
              @if (nextNonstop(); as nn) {
                <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="state.goToWeek(nn.key)">{{ t('dest.goToWeek') }}</button>
              }
              @if (hasConnections() && !state.showConnections()) {
                <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="state.setShowConnections(true)">{{ t('dest.showConnections') }}</button>
              }
            </div>
          </div>
        }
        @case ('not-served') {
          <div class="notice" role="status">
            <span class="ui-tag ui-tag--red">{{ t('dest.notServed') }}</span>
            <p>{{ t('dest.notServedFrom', { hub: hubName() }) }}
              @if (otherHubs().length) { {{ t('dest.fliesFrom') }} }
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
        <app-dest-compare-button class="m-only cmp" [code]="code()" />
        <div class="ui-sec-h d-only">
          <h2 id="dep-h" class="ui-h3">{{ t('dest.nextDepartures') }}</h2>
          <span class="ui-tag ui-tag--blue">{{ state.hub() }} → {{ code() }}</span>
        </div>
        @if (outOptions().length) {
          <app-seg class="out-seg" [options]="outOptions()" [value]="outMode()" (valueChange)="setOutMode($event)"
                   [ariaLabel]="t('dest.tab.departures')" />
        }
        @if (!routeOnly()) {
          <app-day-count-strip class="strip" [days]="stripDays()" [selected]="p.dep" [label]="t('planner.dest.stripAria')"
                               (pick)="setDep($event)" (extend)="shiftStrip($event)" />
          <div class="from" id="dep-list">
            @if (p.dep) {
              <button type="button" class="ui-tag ui-tag--blue from__chip tn" [attr.aria-label]="t('planner.dest.from', { date: depLabel() }) + ' · ' + t('planner.dest.clearFrom')"
                      (click)="clearDates()" data-from>
                {{ t('planner.dest.from', { date: depLabel() }) }} <app-icon name="close" [size]="12" [strokeWidth]="2.4" />
              </button>
            }
            <a class="ui-link from__cal" [routerLink]="calLink()" [queryParams]="calParams()" data-full-cal>{{ t('planner.dest.fullCalendar') }}</a>
          </div>
        }
        <app-dest-timeline [items]="outItems()" [code]="code()" [records]="records()" linked [linkFor]="outLinkFor()" [more]="outMore()" (showMore)="outLimit.set(outLimit() + 5)"
                           [label]="t('dest.departuresFrom', { hub: hubName() })">
          <div class="empty">
            @if (routeOnly()) {
              <p>{{ routeOnlyText() }}.</p>
              <a class="ui-link" [href]="acUrl" target="_blank" rel="noopener">{{ t('dest.checkAc') }}</a>
            } @else if (nextAhead(); as na) {
              <p>{{ t('dest.noNonstopWeeks', { n: horizonWeeks }) }}</p>
              <button type="button" class="ui-link" (click)="state.jumpTo(na.key)">{{ t('dest.nextFlight', { date: na.label }) }}</button>
            } @else if (hasConnections() && !state.showConnections()) {
              <p>{{ t('dest.onlyConnections', { hub: hubName() }) }}</p>
              <button type="button" class="ui-link" (click)="state.setShowConnections(true)">{{ t('dest.showConnections') }}</button>
            } @else if (farConnection(); as fc) {
              <p>{{ t('dest.noConnWeeks', { n: horizonWeeks }) }}</p>
              <button type="button" class="ui-link" (click)="state.jumpTo(fc.key)">{{ t('dest.nextConnection', { date: fc.label }) }}</button>
            } @else {
              <p>{{ t('dest.noDepartures', { hub: hubName() }) }}</p>
            }
          </div>
        </app-dest-timeline>
        @if (facts().length) {
          <ul class="facts" [attr.aria-label]="t('dest.facts.title')" data-route-facts>
            @for (f of facts(); track f) { <li>{{ f }}</li> }
          </ul>
        }
      </section>

      <section class="card ret" [class.is-empty]="!retItems().length" [class.m-hide]="tab() !== 'returns'" aria-labelledby="ret-h">
        <div class="ui-sec-h ret__h">
          <h2 id="ret-h" class="ui-h3 tn" data-ret-heading>{{ retHeading() }}</h2>
          @if (retOptions().length > 1) {
            <app-seg [options]="retOptions()" [value]="retMode()" (valueChange)="setRetMode($event)"
                     [ariaLabel]="t('dest.returnFlights')" />
          }
        </div>
        @if (!p.dep) {
          <p class="ret__pick">
            {{ t('planner.dest.pickToMatch') }}
            <a class="ui-link" [routerLink]="calLink()" [queryParams]="calParams()" data-ret-pick>{{ t('planner.dest.pickDates') }}</a>
          </p>
        }
        <app-dest-timeline [items]="retItems()" [more]="retMore()" (showMore)="retLimit.set(retLimit() + 5)"
                           [linkFor]="retLinkFor()" [stayTag]="retStayTag()"
                           [label]="t('dest.returnsTo', { hub: hubName() })">
          <div class="empty">
            @if (nextHomeAhead(); as nh) {
              <p data-seasonal-home>{{ t('planner.dest.seasonalHome', { date: nh.label }) }}
                <button type="button" class="ui-link" (click)="goHome(nh.key)">{{ t('planner.go') }}</button>
              </p>
            } @else {
              <p>{{ t('dest.noReturn', { hub: hubName(), n: horizonWeeks }) }}</p>
            }
          </div>
        </app-dest-timeline>
        <app-dest-home-by [code]="code()" />
      </section>

      <div class="side" [class.m-hide]="tab() !== 'map'">
        <section class="card mapc" [attr.aria-label]="t('dest.mapAria')">
          @defer (on viewport) {
            <app-route-map class="map" [hub]="state.hub()" [points]="points()" [highlight]="code()" [labels]="mapLabels()"
                           [view]="mapView()" [padding]="mapView() === 'fit' ? 56 : 16" />
          } @placeholder {
            <div class="map map--ph"></div>
          }
          <div class="dist"><span class="ui-sub">{{ t('dest.greatCircle') }}</span><b class="tn">{{ distance() }}</b></div>
        </section>
        <section class="card ess" aria-labelledby="ess-h">
          <h2 id="ess-h" class="ui-h3 ess__h">{{ t('dest.essentials') }}</h2>
          <div class="ui-ess">
            <div><span class="ic"><app-icon name="clock" [size]="16" /></span><span>{{ t('dest.timeZone') }}</span><b class="tn">{{ tz() }}</b></div>
            <div><span class="ic"><app-icon name="currency" [size]="16" /></span><span>{{ t('dest.currency') }}</span><b>{{ currency() || '—' }}</b></div>
            <div><span class="ic"><app-icon name="sun" [size]="16" /></span><span>{{ t('dest.season') }}</span><b>{{ s.season }}</b></div>
            <div><span class="ic"><app-icon name="plane" [size]="16" /></span><span>{{ t('dest.aircraft') }}</span><b>{{ s.aircraftShort || '—' }}</b></div>
          </div>
          <app-dest-reference [iso2]="dest()?.iso2" [airportCode]="code()" [todayKey]="climateDay()" />
          <app-dest-climate [code]="code()" [dateKey]="climateDay()" />
          <app-dest-forecast [code]="code()" [dateKey]="climateDay()" />
          <app-events-card [code]="code()" [from]="eventsFrom()" [to]="eventsTo()" />
          @if (fact(); as f) { <p class="ui-sub fact" data-fact><b>{{ t('dest.didYouKnow') }}</b> · {{ f }}</p> }
        </section>
      </div>

      <div class="m-actions m-only">
        <a class="ui-btn ui-btn--ghost ui-btn--block" routerLink="/weekend" [queryParams]="daysOffParams()" data-days-off>{{ t('dest.daysOff') }}</a>
        <a class="ui-btn ui-btn--ghost ui-btn--block" [href]="acUrl" target="_blank" rel="noopener">{{ acHost }}</a>
      </div>
    </div>
    @if (!d) { <p class="ui-visually-hidden">{{ code() }}</p> }
  `,
  styles: [`
    :host { display: block; min-height: 100dvh; background: var(--bg); }
    .cmp { margin-top: 8px; }

    /* ── Hero ─────────────────────────────────────────────────────────── */
    .hero { position: relative; height: min(380px, 40vh); min-height: 240px; overflow: hidden; background: var(--fill); }
    .hero__img { position: absolute; inset: 0; }
    .hero::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(180deg, rgba(0, 0, 0, .22), rgba(0, 0, 0, 0) 28%);
    }
    .hero__bar {
      position: absolute; z-index: 2; top: calc(env(safe-area-inset-top) + 12px); left: 16px; right: 16px;
      display: flex; justify-content: space-between;
    }
    /* A dark scrim behind the circle buttons keeps them visible on bright photos in light and dark. */
    .hero .ui-circ { background: rgba(0, 0, 0, .42); border-color: rgba(255, 255, 255, .45); box-shadow: 0 1px 6px rgba(0, 0, 0, .25); }
    .hero__acts { display: flex; gap: 8px; }
    .star.pop { animation: ui-pop 240ms var(--ease-out); }
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
    .season { margin-top: 8px; }
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
    .facts { list-style: none; margin: 12px 0 0; padding: 12px 0 0; border-top: 1px solid var(--hair); display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
    .empty { padding: 8px 0 4px; font-size: 13.5px; color: var(--ink-2); display: grid; gap: 6px; justify-items: start; }
    .empty .ui-link { font-size: 13.5px; }

    .ret__h { align-items: center; flex-wrap: wrap; gap: 8px 12px; }
    .ret__h h2 { flex: 1 1 200px; min-width: 0; }
    .ret__pick { margin: 0 0 12px; font-size: 13.5px; color: var(--ink-2); }
    .ret__pick .ui-link { display: inline-block; font-size: 13.5px; padding: 6px 0; }
    .out-seg { margin: 0 0 12px; }

    /* ── Dates bar (every tab) ────────────────────────────────────────── */
    .dates {
      margin-top: 14px; min-height: 56px; padding: 8px 8px 8px 16px; border-radius: 16px; background: var(--fill);
      display: grid; gap: 8px; align-content: center;
    }
    .dates.is-set:has(app-stay-chips) { padding-bottom: 10px; }
    .dates__row { display: flex; align-items: center; gap: 8px; min-height: 40px; }
    .dates__q { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.3; }
    .dates__q .nw { white-space: nowrap; }
    .dates__btn { flex: none; white-space: nowrap; }
    .dates__x {
      position: relative; flex: none; display: inline-grid; place-items: center; width: 44px; height: 44px;
      border-radius: 50%; color: var(--ink-2);
    }
    .dates__x:hover { color: var(--ink); background: var(--hair); }
    .dates__chips { margin-right: -8px; }

    /* ── 14-day strip and the From chip ───────────────────────────────── */
    .strip { margin: 0 -4px 6px; }
    .from { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin: 0 0 8px; scroll-margin-top: 16px; }
    .from__chip { position: relative; display: inline-flex; align-items: center; gap: 4px; min-height: 28px; cursor: pointer; }
    .from__chip::after { content: ''; position: absolute; inset: -8px -4px; }
    .from__cal { display: inline-block; font-size: 13.5px; padding: 12px 0; }
    .map { display: block; height: 260px; border-radius: 16px; overflow: hidden; background: var(--sea); }
    .dist { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 4px 0; font-size: 13px; }
    .ess__h { margin-bottom: 12px; }
    .fact { margin: 12px 0 0; }
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
      .dep app-dest-trip-actions { margin-bottom: 14px; }
    .days-off { display: inline-block; margin-top: 10px; font-size: 13.5px; }
      .ret, .side { margin-top: 16px; }
      .side { display: grid; gap: 22px; }
      .mapc { margin-top: 0; }
      .ess, .mapc { margin-top: 0; }
    }

    /* ── Tablet and up: cards on the page ─────────────────────────────── */
    @media (min-width: 720px) {
      .dates { margin-top: 0; }
      .m-only { display: none !important; }
      .handle { display: none; }
      .hero { height: 360px; min-height: 0; }
      .hero__bar { top: 22px; left: 32px; right: 32px; }
      .hero__acts { gap: 10px; }
      .credit { right: 28px; bottom: 104px; max-width: 60%; }
      .body {
        position: relative; z-index: 1; max-width: var(--page-max); margin: -80px auto 0; padding: 0 24px 40px;
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start;
      }
      .head, .notice, .dates { grid-column: 1 / -1; }
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
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly photos = inject(PhotoService);
  private readonly sharer = inject(ShareService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly recent = inject(RecentService);
  private readonly trips = inject(TripsService);

  readonly code = input.required<string>();
  /** ?tab= (mobile seg), bound from the query by withComponentInputBinding. */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  protected readonly tabs = computed<SegOption[]>(() => TABS.map(o => ({ value: o.value, label: t(o.label) })));
  protected readonly acUrl = AC_URL;
  protected readonly acHost = 'aircanada.com';
  protected readonly horizonWeeks = Math.round(HORIZON_DAYS / 7);

  private readonly mobile = this.media(MOBILE_QUERY);

  readonly tab = computed<DestTab>(() => {
    const tabKey = this.tabParam();
    return tabKey === 'returns' || tabKey === 'map' ? tabKey : 'departures';
  });

  // ── Dates (?dep, ?ret: page-local, dates-spec §3.3) ──────────────────────
  /** ?dep= (the day you leave), bound from the query. */
  readonly depParam = input<string | undefined>(undefined, { alias: 'dep' });
  /** ?ret= (the day you fly home). */
  readonly retParam = input<string | undefined>(undefined, { alias: 'ret' });

  /** The counting context of the shared planner model (minute-floored clock, so a 30s tick changes nothing). */
  private readonly ctx = computed<CountCtx>(() => ({
    today: this.state.todayKey(),
    nowMinute: minuteOf(this.state.nowMs()),
    coverage: this.state.coverage(),
    showConnections: this.state.showConnections(),
    connect: this.state.connect(),
    loading: this.state.dataLoad() === 'loading',
  }), {
    equal: (a, b) => a.today === b.today && a.nowMinute === b.nowMinute && a.coverage === b.coverage
      && a.showConnections === b.showConnections && a.connect === b.connect && a.loading === b.loading,
  });

  /** The dates in the URL, validated (unpickable dates dropped; a same-day return only when a way home leaves that day). */
  readonly plan = computed(() =>
    readPlan({ dep: this.depParam(), ret: this.retParam() }, this.state.todayKey(), this.state.coverage(),
      dep => waysHome(this.code(), this.state.hub(), dep, this.ctx(), this.afterFor(dep)).length > 0));

  /** The flights out on the departure day (by the connection setting). */
  private readonly depOuts = computed(() => {
    const dep = this.plan().dep;
    return dep ? outboundsOn(this.state.hub(), this.code(), dep, this.ctx()) : [];
  });
  /** The outbound that lands first on the departure day: the best case for ways home. */
  private readonly earliest = computed(() => earliestArrival(this.depOuts()));
  /** A way home leaves at least minConnect after the earliest arrival (null: no outbound that day). */
  private readonly afterUtc = computed(() => homeAfterUtc(null, this.depOuts(), this.state.connect()));

  private afterFor(dep: string): number | null {
    return homeAfterUtc(null, outboundsOn(this.state.hub(), this.code(), dep, this.ctx()), this.state.connect());
  }

  protected readonly depLabel = computed(() => {
    const dep = this.plan().dep;
    return dep ? dayLabel(dep, this.state.todayKey()) : '';
  });
  /** 'Nov 20 – 28' and '8 nights' (each kept on one line; the bar wraps between them). */
  protected readonly rangeLabel = computed(() => {
    const { dep, ret } = this.plan();
    if (!dep || !ret) return { range: '', stay: '' };
    const n = nightsBetween(dep, ret);
    const range = dep === ret ? dayLabel(dep, this.state.todayKey()) : shortRange(dep, ret, this.state.todayKey());
    return { range, stay: n ? t('planner.nights', { n }) : t('planner.dayTrip') };
  });

  /** Five stays compared with no tap: nights, return day and ways home after you land. */
  protected readonly stays = computed(() => {
    const dep = this.plan().dep;
    return dep ? stayOptions(dep, this.code(), this.state.hub(), this.ctx(), this.afterUtc(), this.state.timeFormat()) : [];
  });
  protected readonly stayCompute = computed(() => {
    const dep = this.plan().dep;
    if (!dep) return null;
    const code = this.code();
    const hub = this.state.hub();
    const ctx = this.ctx();
    const after = this.afterUtc();
    const fmt = this.state.timeFormat();
    return (n: number) => stayOptions(dep, code, hub, ctx, after, fmt, [n])[0];
  });

  /** The picker's query: the global params plus the dates. */
  protected readonly calParams = computed<Params>(() => {
    const { dep, ret } = this.plan();
    return { ...this.state.globalParams(), ...planParams({ dep, ret, out: null, back: null }) };
  });
  protected readonly planLink = computed(() => planPath(this.code()));
  protected readonly planQuery = computed<Params>(() => ({ ...this.state.globalParams(), ...planParams(this.plan()) }));

  // ── 14-day strip (departures) ─────────────────────────────────────────────
  /** The strip's first day: three days before the departure (else the timeline start), never before today. */
  private readonly stripStart = linkedSignal<readonly [string, string, string], string>({
    source: () => [this.code(), this.plan().dep ?? this.state.selectedDateKey() ?? this.state.weekStartKey(), this.state.todayKey()] as const,
    computation: ([, base, today], prev) => {
      const dep = this.plan().dep;
      // Keep the strip where it is when the picked day is already on it.
      if (prev && dep && dep >= prev.value && dep <= addDays(prev.value, STRIP_DAYS - 1)) return prev.value;
      const start = addDays(base, -3);
      return start > today ? start : today;
    },
  });
  protected readonly stripDays = computed(() =>
    outCounts(this.state.hub(), this.code(), stripKeys(this.stripStart(), 0, STRIP_DAYS - 1), this.ctx(), this.state.timeFormat()));

  protected shiftStrip(d: -1 | 1): void {
    const today = this.state.todayKey();
    const next = addDays(this.stripStart(), d * 7);
    this.stripStart.set(next < today ? today : next);
  }

  // ── Destination facts ─────────────────────────────────────────────────────
  protected readonly dest = computed(() => findDestination(this.code()));

  constructor() {
    // Opening a destination puts it first in Home's "Recent" row.
    effect(() => {
      const d = this.dest();
      if (d) untracked(() => this.recent.add(d.code));
    });
  }

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
   * "Today" on each timeline is the ORIGIN airport's calendar day (the hub's
   * for departures, this airport's for returns), never the device's: a phone
   * in Tokyo still labels a Montréal evening flight "Today".
   */
  protected readonly outToday = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));
  private readonly retToday = computed(() => todayKey(airportTz(this.code()), this.state.nowMs()));

  /**
   * Timelines start at ?dep, else the selected day, else the browsed week's
   * start, and never before today (at the hub).
   */
  private readonly startKey = computed(() => {
    const today = this.outToday();
    const base = this.plan().dep ?? this.state.selectedDateKey() ?? this.state.weekStartKey();
    return base > today ? base : today;
  });
  /**
   * The return timeline's start: ?ret, else the day the earliest outbound on
   * ?dep lands, else the same day as departures; never before today where it
   * leaves from.
   */
  private readonly retStartKey = computed(() => {
    const today = this.retToday();
    const { dep, ret } = this.plan();
    const base = ret ?? this.earliest()?.arrDateKey ?? dep ?? this.state.selectedDateKey() ?? this.state.weekStartKey();
    return base > today ? base : today;
  });
  /** Ways home leave no earlier than this (now, or minConnect after you land). */
  private readonly retFloor = computed(() => Math.max(this.state.nowMs(), this.afterUtc() ?? -Infinity));

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
      ? [{ value: 'nonstop', label: t('format.nonstop') }, { value: 'via', label: viaLabel(bestHub(via)) }]
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
  readonly retLimit = linkedSignal({ source: () => [this.code(), this.retStartKey(), this.firstLimit()] as const, computation: ([, , n]) => n });

  protected readonly outItems = computed(() =>
    timelineItems(this.outList().slice(0, this.outLimit()), this.outToday(), this.state.nowMs(), this.state.timeFormat()));
  protected readonly outMore = computed(() => this.outList().length > this.outLimit());

  private readonly retDirect = computed(() =>
    upcoming(this.code(), this.state.hub(), this.retStartKey(), this.retFloor(), 'direct', this.state.connect()));
  private readonly retVia = computed(() =>
    upcoming(this.code(), this.state.hub(), this.retStartKey(), this.retFloor(), 'via', this.state.connect()));
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
    const opts: SegOption[] = [{ value: 'nonstop', label: t('format.nonstop'), disabled: !this.retDirect().length }];
    if (via.length) opts.push({ value: 'via', label: viaLabel(bestHub(via)) });
    return opts;
  });
  private readonly retList = computed(() => (this.retMode() === 'via' ? this.retVia() : this.retDirect()));
  protected readonly retItems = computed(() =>
    timelineItems(this.retList().slice(0, this.retLimit()), this.retToday(), this.state.nowMs(), this.state.timeFormat(), false));
  protected readonly retMore = computed(() => this.retList().length > this.retLimit());

  // ── Header ────────────────────────────────────────────────────────────────
  protected readonly summary = computed(() =>
    destSummary(this.state.hub(), this.code(), this.state.weekStartKey(), this.outDirect().length ? this.outDirect() : this.outVia()));
  /** 'Seasonal · last nonstop Oct 23' when the nonstop is about to end or pause (same rule as Home's "Seasonal & ending soon"). */
  protected readonly seasonTag = computed(() => {
    const ev = seasonEvent(this.state.hub(), this.code(), this.outToday());
    if (!ev || ev.kind === 'starts') return null;
    const d = formatKey(ev.dateKey, { month: 'short', day: 'numeric' });
    return t(ev.kind === 'pauses' ? 'dest.seasonPauses' : 'dest.seasonLast', { date: d });
  });
  /** A few plain counts from the published schedules (frequency, season, last nonstop home). */
  protected readonly facts = computed(() => this.routeOnly() ? [] : routeFacts(this.state.hub(), this.code(), this.outToday(), this.state.nowMs(), this.state.timeFormat()));

  protected readonly next = computed(() => nextDeparture(this.outList()[0], this.outToday(), this.state.timeFormat()));

  // ── States ────────────────────────────────────────────────────────────────
  /** The next connection beyond the horizon, looked up only when both lists are empty. */
  protected readonly farConnection = computed(() => {
    if (this.outDirect().length || this.outVia().length) return null;
    const key = nextConnectionDate(this.state.hub(), this.code(), addDays(this.startKey(), HORIZON_DAYS), this.state.connect());
    return key ? { key, label: formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }) } : null;
  });
  protected readonly hasConnections = computed(() => this.outVia().length > 0 || !!this.farConnection());
  protected readonly status = computed(() =>
    destState(this.state.hub(), this.code(), this.state.weekStartKey(), this.outToday(), this.state.coverage(), this.hasConnections()));
  protected readonly routeOnlyText = routeOnlyText;
  protected readonly routeOnly = computed(() => this.status().kind === 'route-only');
  protected readonly routeOnlyDetail = computed(() => {
    const s = this.status();
    return s.kind === 'route-only' ? s.detail : '';
  });
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
  /** One "Did you know" line, stable for the day. */
  protected readonly fact = computed(() => {
    const d = this.dest();
    if (!d) return null;
    const hub = this.state.hubInfo();
    const nonstops = getDestinationCodes(hub.code).map(c => findHub(c) ?? findDestination(c)).filter((x): x is NonNullable<typeof x> => !!x);
    return dailyFact(d, hub, nonstops, this.state.nowMs());
  });
  /** "What's on": the shown day and 3 days either side (the card clamps to what the server accepts). */
  protected readonly eventsFrom = computed(() => addDays(this.climateDay(), -3));
  protected readonly eventsTo = computed(() => addDays(this.climateDay(), 3));
  /** The day the weather is for: ?dep, else the picked day, else today at the destination. */
  protected readonly climateDay = computed(() => {
    const tz = this.dest()?.tz;
    return this.plan().dep ?? this.state.selectedDateKey() ?? (tz ? todayKey(tz, this.state.nowMs()) : this.outToday());
  });
  /**
   * 'you: 3/4' tags for the departures, keyed by row: only the first row of each
   * flight number (and route) carries it, and only where you have tried it.
   * Rows with several legs prefix each tag with its flight number. Counts only.
   */
  protected readonly records = computed(() => {
    const out: Record<string, { text: string; aria: string }[]> = {};
    const outcomes = this.trips.outcomes();
    if (!outcomes.length) return out;
    const seen = new Set<string>();
    const cache = new Map<string, HistoryCounts>();
    for (const row of this.outItems()) {
      const tags: { text: string; aria: string }[] = [];
      for (const l of row.it.legs) {
        const n = prettyFlight(l.flightNumber);
        if (!n || l.estimated) continue;
        const k = `${n}|${l.origin}|${l.dest}`;
        if (seen.has(k)) continue;
        seen.add(k);
        let c = cache.get(k);
        if (!c) cache.set(k, c = historyFor({ outcomes }, { flightNumber: n, route: { origin: l.origin, dest: l.dest } }).overall);
        const tag = recordTag(c);
        if (tag) tags.push({ text: row.it.legs.length > 1 ? `${n} ${tag}` : tag, aria: `${n}. ${recordAria(c)}` });
      }
      if (tags.length) out[itinKey(row.it)] = tags;
    }
    return out;
  });
  protected readonly popped = signal(false);
  protected readonly currency = computed(() => currencyName(this.dest()?.iso2));

  // ── Actions ───────────────────────────────────────────────────────────────
  protected flightLink(it: Itinerary): string[] {
    return flightPath(this.code(), it.dateKey, it);
  }

  /** The days-off finder for this destination only. */
  protected daysOffParams(): Record<string, string> {
    return { ...this.state.globalParams(), to: this.code() };
  }

  protected calLink(): string[] {
    return calendarPath(this.code());
  }

  back(): void {
    this.state.goBack(['/']);
  }

  shareIt(): void {
    void this.sharer.share(t('dest.share.text', { city: this.city() }));
  }

  toggleFav(): void {
    const code = this.code();
    const city = this.city();
    const was = this.isFav();
    this.state.toggleFavourite(code);
    tap();
    if (!was) this.popped.set(true);
    if (was) {
      this.state.flash(t('dest.removed', { city }), {
        label: t('ui.undo'),
        run: () => {
          if (!this.state.favouriteSet().has(code)) this.state.toggleFavourite(code);
        },
      });
    } else {
      this.state.flash(t('dest.saved', { city }));
    }
  }

  setTab(tabKey: string | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: tabKey && tabKey !== 'departures' ? tabKey : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  /**
   * A day tapped on the strip: ?dep moves there (a return on or before it
   * moves too, keeping the nights), the timeline starts on it and the page
   * scrolls to the list.
   */
  setDep(key: string): void {
    const { dep, ret } = this.plan();
    const next = dep ? shiftRet(key, dep, ret).ret : ret && ret >= key ? ret : null;
    this.writeDates({ dep: key, ret: next });
    this.doc.defaultView?.requestAnimationFrame?.(() =>
      this.doc.getElementById('dep-list')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
  }

  /** A stay chip: ?ret. */
  setRet(key: string): void {
    this.writeDates({ dep: this.plan().dep, ret: key });
  }

  clearDates(): void {
    this.writeDates({ dep: null, ret: null });
  }

  /** The seasonal "Go": that day becomes the return (with dates), else the app moves there. */
  goHome(key: string): void {
    const dep = this.plan().dep;
    if (dep && key >= dep) this.setRet(key);
    else this.state.jumpTo(key);
  }

  private writeDates(d: { dep: string | null; ret: string | null }): void {
    void this.router.navigate([], {
      queryParams: { dep: d.dep, ret: d.dep ? d.ret : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  // ── Row links (dates set) ─────────────────────────────────────────────────
  /** With both dates, a departure opens the round trip from its own day, keeping the nights; else its flight page. */
  protected readonly outLinkFor = computed(() => {
    const { dep, ret } = this.plan();
    if (!dep || !ret) return null;
    const code = this.code();
    const nights = nightsBetween(dep, ret);
    return (row: TimelineItem): TimelineLink => ({
      path: planPath(code),
      params: { dep: row.it.dateKey, ret: addDays(row.it.dateKey, nights), out: flightSlug(row.it) },
    });
  });

  /** With a departure day, a way home opens the round trip on its own day. */
  protected readonly retLinkFor = computed(() => {
    const dep = this.plan().dep;
    if (!dep) return null;
    const code = this.code();
    return (row: TimelineItem): TimelineLink => ({
      path: planPath(code),
      params: { dep, ret: row.it.dateKey, back: flightSlug(row.it) },
    });
  });

  /** '8 nights' on each way home, counted from ?dep. */
  protected readonly retStayTag = computed(() => {
    const dep = this.plan().dep;
    if (!dep) return null;
    return (row: TimelineItem): string | null => {
      const n = nightsBetween(dep, row.it.dateKey);
      return n >= 0 ? (n ? t('planner.nights', { n }) : t('planner.dayTrip')) : null;
    };
  });

  /** 'Leaving LIS after you land (Sat, Nov 21 08:15)', else 'Next flights home from Lisbon'. */
  protected readonly retHeading = computed(() => {
    const e = this.earliest();
    if (this.plan().dep && e) {
      return t('planner.dest.homeHeading', { code: this.code(), when: landingLabel(e, this.state.todayKey(), this.state.timeFormat()) });
    }
    return t('planner.dest.nextHome', { city: this.city() });
  });

  /** The next nonstop home beyond an empty timeline (seasonal routes), with its year when not this one. */
  protected readonly nextHomeAhead = computed(() => {
    if (this.retDirect().length || this.retVia().length) return null;
    const key = nextFlightDate(this.code(), this.state.hub(), this.retStartKey(), false);
    return key ? { key, label: dayLabel(key, this.state.todayKey()) } : null;
  });

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
