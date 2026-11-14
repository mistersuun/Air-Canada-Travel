import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { Router, RouterLink, type Params } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { t } from '../../i18n/t';
import {
  type CountCtx, type PlanState, carryPick, earliestArrival, homeAfterUtc, homeByFor, homeCounts, landingLabel, minuteOf,
  nearestHomeDays, nightsBetween, outCounts, outboundsOn, planParams, readPlan, shiftRet, staleBack, startRoundTrip,
  stayOptions, stripKeys, waysHome,
} from '../../planner/round-trip';
import { AppStateService } from '../../state/app-state.service';
import { ShareService } from '../../state/share.service';
import type { Trip } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { DayCountStripComponent } from '../../ui/day-count-strip.component';
import { dayLabel, formatStay, isOutside, itinKey, longDay, prettyFlight, shortRange } from '../../ui/format';
import { calendarPath, destPath, flightSlug, matchSlug, tripPath } from '../../ui/links';
import { StayChipsComponent } from '../../ui/stay-chips.component';
import { findDestination } from '../../utils/airports';
import type { Itinerary } from '../../utils/connections';
import { buildIcs, downloadIcs, icsFilename } from '../../utils/ics';
import { addDays, diffDays, formatClock, formatKey, isDateKey } from '../../utils/time';
import { nextFlightDate } from '../../utils/week';
import { nextConnectionDate } from '../destination/dest-model';
import { optionRow, roundTrip, tripTarget, tripsFor } from '../flight/flight-model';
import { OptionRowComponent } from '../flight/option-row.component';
import { PlanBarComponent, type PlanBarSide } from './plan-bar.component';

/** Rows listed before "Show all". */
export const ROWS_SHOWN = 4;
/** Days either side of the departure on the out strip, and after the return on the home strip. */
const STRIP_SPAN = 3;
const AC_URL = 'https://www.aircanada.com/';

interface PlanNotice {
  id: string;
  text: string;
  action: { label: string; run: () => void } | null;
  dismiss: () => void;
}

/** 'AC834', 'AC300 + AC1' from a flight slug ('AC300+AC1'). */
function slugLabel(slug: string): string {
  return slug.split('+').map(prettyFlight).join(' + ');
}

/** 'AC834', 'AC300 + AC1' from an itinerary. */
function flightsOf(it: Itinerary): string {
  return it.legs.map(l => (l.flightNumber ? prettyFlight(l.flightNumber) : t('flight.est'))).join(' + ');
}

/**
 * Round trip, /plan/:code?dep&ret&out&back (dates-spec §3.2).
 *
 * Flights out on the departure day and ways home on the return day, on one
 * page. Ways home leave at least the minimum connection time after the picked
 * outbound lands (else after the earliest arrival that day, the best case),
 * and the page says which. Every pick is in the URL, so a reload or a shared
 * link restores the trip; a pick that no longer fits stays in the URL and
 * shows a notice with a one-tap fix (never a silent clear, never an implicit
 * pick). Counts are scheduled flights, not seats.
 */
@Component({
  selector: 'app-plan-page',
  standalone: true,
  imports: [IconComponent, RouterLink, DayCountStripComponent, StayChipsComponent, OptionRowComponent, PlanBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare pl">
      <div class="top">
        <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('ui.back')" (click)="leave()">
          <app-icon name="arrow-left" [size]="18" />
        </button>
        <h1 class="ui-h3">{{ t('planner.plan.title') }}</h1>
        <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('flight.shareAria')" (click)="share()">
          <app-icon name="share" [size]="18" />
        </button>
      </div>
      <p class="ctx ui-sub tn">{{ hub() }} ⇄ {{ dest() }} · {{ city() }}</p>

      @if (plan().dep; as dep) {
        <div class="ui-card dates" data-dates>
          <div class="dates__t">
            @if (plan().ret; as ret) {
              <b class="tn"><span class="nw">{{ label(dep) }}</span> → <span class="nw">{{ label(ret) }}</span></b>
              <span class="ui-sub tn">{{ t('planner.nights', { n: nightCount() ?? 0 }) }}</span>
            } @else {
              <b class="tn">{{ t('planner.plan.pickHome', { dep: label(dep) }) }}</b>
            }
          </div>
          <a class="ui-btn ui-btn--ghost ui-btn--sm" data-change [routerLink]="calendarLink()" [queryParams]="calendarParams()">
            {{ plan().ret ? t('planner.plan.change') : t('planner.plan.pick') }}
          </a>
        </div>
      }

      <div class="notes" role="status" [attr.aria-label]="t('planner.plan.notices')">
        @for (n of notices(); track n.id) {
          <div class="note" [attr.data-notice]="n.id">
            <p class="note__t tn">{{ n.text }}</p>
            <div class="note__a">
              @if (n.action; as a) {
                <button type="button" class="ui-btn ui-btn--sm" (click)="a.run()">{{ a.label }}</button>
              }
              <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="n.dismiss()">{{ t('planner.toast.dismiss') }}</button>
            </div>
          </div>
        }
      </div>
      <p class="ui-visually-hidden" aria-live="polite">{{ announce() }}</p>

      @if (unpublished()) {
        <div class="ui-card state" data-unpublished>
          <span class="ui-tag ui-tag--amber">{{ t('planner.unpublished') }}</span>
          <p class="ui-sub">{{ t('planner.plan.unpublishedBody', { date: coverageEnd() }) }}</p>
          <a class="ui-btn ui-btn--sm" [routerLink]="calendarLink()" [queryParams]="globalParams()">{{ t('planner.dest.pickDates') }}</a>
        </div>
      }

      @if (plan().dep; as dep) {
        <div class="cols">
          <section class="sec" aria-labelledby="pl-out">
            <div class="ui-sec-h">
              <h2 class="ui-h3" id="pl-out" tabindex="-1">{{ t('planner.plan.outHeading', { date: label(dep) }) }}</h2>
              <span class="ui-tag ui-tag--blue tn">{{ hub() }} → {{ dest() }}</span>
            </div>
            <app-day-count-strip class="strip" data-strip="out" variant="out" [days]="outStrip()" [selected]="dep"
                                 [label]="t('planner.plan.outAria', { date: longDate(dep) })"
                                 (pick)="setDep($event)" (extend)="extendOut($event)" />
            @if (loading()) {
              <div class="ui-card list" aria-busy="true">
                @for (i of skeleton; track i) { <div class="skel"></div> }
              </div>
            } @else if (outRows().length) {
              <div class="ui-card list" role="radiogroup" [attr.aria-label]="t('planner.plan.outAria', { date: longDate(dep) })" data-list="out">
                @for (r of visibleOut(); track r.key) {
                  <app-option-row [row]="r" [selectable]="true" [selected]="r.key === outKey()" (pick)="toggleOut(r.it)" />
                }
              </div>
              @if (outRows().length > visibleOut().length) {
                <button type="button" class="ui-link more" (click)="allOut.set(true)">{{ t('planner.plan.showAll', { n: outRows().length }) }}</button>
              }
            } @else {
              <p class="empty tn" data-empty="out">
                @if (seasonal(); as s) {
                  {{ t('planner.plan.seasonal', { date: label(s) }) }}
                  <button type="button" class="ui-link go" (click)="setDep(s)">{{ t('planner.go') }}</button>
                } @else {
                  {{ t('planner.plan.noOut', { date: label(dep) }) }}
                  @if (nextOut(); as n) {
                    · {{ t('planner.next', { date: label(n) }) }}
                    <button type="button" class="ui-link go" (click)="setDep(n)">{{ t('planner.go') }}</button>
                  }
                }
              </p>
            }
            @if (hiddenOut(); as h) {
              <p class="hid">
                {{ t('planner.conn.hidden', { n: h }) }} ·
                <button type="button" class="ui-link" (click)="state.setShowConnections(true)">{{ t('planner.conn.include') }}</button>
              </p>
            }
          </section>

          <section class="sec" aria-labelledby="pl-home">
            @if (plan().ret; as ret) {
              <div class="ui-sec-h">
                <h2 class="ui-h3" id="pl-home" tabindex="-1">{{ t('planner.plan.homeHeading', { date: label(ret) }) }}</h2>
                <span class="ui-tag ui-tag--blue tn">{{ dest() }} → {{ hub() }}</span>
              </div>
              @if (rule(); as r) { <p class="rule tn" data-rule>{{ r }}</p> }
              <app-day-count-strip class="strip" data-strip="home" variant="home" [days]="homeStrip()" [selected]="ret"
                                   [label]="t('planner.plan.homeAria', { date: longDate(ret) })"
                                   (pick)="setRet($event)" (extend)="extendHome($event)" />
              @if (loading()) {
                <div class="ui-card list" aria-busy="true">
                  @for (i of skeleton; track i) { <div class="skel"></div> }
                </div>
              } @else if (homeRows().length) {
                <div class="ui-card list" role="radiogroup" [attr.aria-label]="t('planner.plan.homeAria', { date: longDate(ret) })" data-list="home">
                  @for (r of visibleHome(); track r.key) {
                    <app-option-row [row]="r" [selectable]="true" [selected]="r.key === backKey()" (pick)="toggleBack(r.it)" />
                    @if (r.key === backKey() && stay(); as s) { <p class="stay tn" data-stay>{{ s }}</p> }
                  }
                </div>
                @if (homeRows().length > visibleHome().length) {
                  <button type="button" class="ui-link more" (click)="allHome.set(true)">{{ t('planner.plan.showAll', { n: homeRows().length }) }}</button>
                }
              } @else {
                <div class="empty tn" data-empty="home">
                  <p>{{ t('planner.plan.noHome', { date: label(ret) }) }}</p>
                  @if (nearest().length) {
                    <p class="near">
                      {{ t('planner.plan.nearest') }}
                      @for (n of nearest(); track n.key) {
                        <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="setRet(n.key)">{{ label(n.key) }} ({{ n.n }})</button>
                      }
                    </p>
                  }
                </div>
              }
              @if (hiddenHome(); as h) {
                <p class="hid">
                  {{ t('planner.conn.hidden', { n: h }) }} ·
                  <button type="button" class="ui-link" (click)="state.setShowConnections(true)">{{ t('planner.conn.include') }}</button>
                </p>
              }
            } @else {
              <div class="ui-sec-h">
                <h2 class="ui-h3" id="pl-home" tabindex="-1">{{ t('planner.chips.question') }}</h2>
                <span class="ui-tag ui-tag--blue tn">{{ dest() }} → {{ hub() }}</span>
              </div>
              @if (rule(); as r) { <p class="rule tn" data-rule>{{ r }}</p> }
              <app-stay-chips [options]="stays()" [dep]="dep" [today]="state.todayKey()" [compute]="stayFor"
                              (pick)="setRet($event)" />
            }
          </section>
        </div>

        <div class="acts">
          <button type="button" class="ui-btn ui-btn--ghost" data-ics [disabled]="!outPicked() || !backPicked()" (click)="exportIcs()">
            <app-icon name="download" [size]="17" /> {{ t('planner.plan.ics') }}
          </button>
          <a class="ui-btn ui-btn--ghost" [href]="acUrl" target="_blank" rel="noopener">{{ t('dest.openAc') }}</a>
        </div>
        <p class="foot ui-sub">{{ t('flight.footer') }}</p>

        <app-plan-bar [out]="barOut()" [home]="barHome()" [label]="startLabel()" [disabled]="!outPicked() || trips.readOnly()"
                      [needOut]="!outPicked()" (goOut)="focusSection('pl-out')" (goHome)="focusSection('pl-home')"
                      (start)="start()" />
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pl { max-width: 480px; padding-bottom: calc(128px + env(safe-area-inset-bottom)); }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 4px; }
    .top h1 { margin: 0; }
    .ctx { text-align: center; margin: 0 0 12px; font-size: 12.5px; }
    .dates { min-height: 64px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .dates__t { display: grid; gap: 2px; min-width: 0; }
    .dates__t b { font-size: 15.5px; font-weight: 650; }
    .nw { white-space: nowrap; }
    .dates .ui-btn { flex: none; }
    .notes { display: grid; gap: 8px; margin-top: 10px; }
    .notes:empty { display: none; }
    .note {
      padding: 10px 12px; border-radius: 14px; display: grid; gap: 8px;
      background: color-mix(in srgb, var(--amber) 12%, var(--surface)); border: 1px solid color-mix(in srgb, var(--amber) 35%, transparent);
    }
    .note__t { margin: 0; font-size: 13.5px; color: var(--ink); }
    .note__a { display: flex; flex-wrap: wrap; gap: 8px; }
    .state { margin-top: 12px; padding: 16px; display: grid; gap: 8px; justify-items: start; }
    .state p { margin: 0; }
    .cols { display: grid; gap: 0; min-width: 0; }
    .sec { margin-top: 22px; min-width: 0; }
    .sec .ui-sec-h { margin-bottom: 8px; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sec h2 { margin: 0; font-size: 19px; }
    .sec h2:focus { outline: none; }
    .sec h2:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 6px; }
    .strip { display: block; margin-bottom: 10px; }
    .rule { margin: 0 0 10px; font-size: 13px; color: var(--ink-2); }
    .list { padding: 4px 14px; }
    .skel { height: 52px; margin: 8px 0; border-radius: 10px; background: var(--fill); }
    .more { margin-top: 10px; font-size: 13px; min-height: 44px; }
    .empty { margin: 0; font-size: 13.5px; color: var(--ink-2); }
    .empty p { margin: 0 0 6px; }
    .near { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .go { position: relative; min-height: 44px; margin-left: 4px; }
    .hid { margin: 8px 0 0; font-size: 13px; color: var(--ink-2); }
    .hid .ui-link { min-height: 44px; }
    .stay { margin: 0 0 10px 58px; font-size: 12.5px; font-weight: 600; color: var(--teal-ink, var(--teal)); }
    .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .acts .ui-btn { flex: 1 1 auto; min-height: 44px; padding: 13px 16px; font-size: 14.5px; }
    .foot { margin: 18px 0 0; font-size: 12px; text-align: center; }

    @media (min-width: 720px) {
      .pl { max-width: 960px; padding-top: 28px; }
      .cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; align-items: start; }
    }
  `],
})
export class PlanPage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  protected readonly trips = inject(TripsService);
  private readonly router = inject(Router);
  private readonly sharer = inject(ShareService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly code = input.required<string>();
  /** Query params (component input binding). */
  readonly dep = input<string>();
  readonly ret = input<string>();
  readonly out = input<string>();
  readonly back = input<string>();
  /** Legacy ?nights=: ret = dep + N. */
  readonly nights = input<string>();

  protected readonly acUrl = AC_URL;
  protected readonly skeleton = [0, 1, 2];
  protected readonly allOut = signal(false);
  protected readonly allHome = signal(false);
  protected readonly announce = signal('');
  /** Set when a departure move pushed the return (D6): 'Home moved to … to keep 8 nights'. */
  private readonly retMoved = signal<{ date: string; nights: number } | null>(null);
  private readonly outExt = signal({ before: 0, after: 0 });
  private readonly homeExt = signal({ before: 0, after: 0 });

  protected readonly dest = computed(() => this.code().toUpperCase());
  protected readonly hub = computed(() => this.state.hub());
  protected readonly city = computed(() => findDestination(this.dest())?.city ?? this.dest());
  protected readonly fmt = computed(() => this.state.timeFormat());
  protected readonly loading = computed(() => this.state.dataLoad() === 'loading');
  protected readonly globalParams = computed(() => this.state.globalParams());

  /** Minute-floored clock: a seconds tick does not recompute the counts. */
  private readonly nowMinute = computed(() => minuteOf(this.state.nowMs()));
  readonly ctx = computed<CountCtx>(() => ({
    today: this.state.todayKey(),
    nowMinute: this.nowMinute(),
    coverage: this.state.coverage(),
    showConnections: this.state.showConnections(),
    connect: this.state.connect(),
    loading: this.loading(),
  }));
  /** The same context with connections counted: picks that name a connection still resolve (D2). */
  private readonly ctxAll = computed<CountCtx>(() => ({ ...this.ctx(), showConnections: true }));

  /** The validated plan from the URL (D4): bad dates dropped, flight slugs kept even when they no longer match. */
  readonly plan = computed<PlanState>(() => {
    const ctx = this.ctx();
    return readPlan(
      { dep: this.dep(), ret: this.ret(), out: this.out(), back: this.back(), nights: this.nights() },
      ctx.today, ctx.coverage,
      d => waysHome(this.dest(), this.hub(), d, ctx, homeAfterUtc(null, outboundsOn(this.hub(), this.dest(), d, ctx), ctx.connect)).length > 0,
    );
  });

  /** A departure or return the schedules do not reach yet (a valid future date past the published window). */
  protected readonly unpublished = computed(() => {
    const ctx = this.ctx();
    const later = (k: string | undefined): boolean => isDateKey(k) && k >= ctx.today && isOutside(k, ctx.coverage);
    return later(this.dep()) || (!!this.plan().dep && later(this.ret()));
  });
  protected readonly coverageEnd = computed(() => {
    const to = this.state.coverage().to;
    return to ? formatKey(to, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  });

  // ── Flights out ────────────────────────────────────────────────────────────

  /** Flights out on dep, by the connection setting. */
  readonly outs = computed<Itinerary[]>(() => {
    const dep = this.plan().dep;
    return dep ? outboundsOn(this.hub(), this.dest(), dep, this.ctx()) : [];
  });
  private readonly outsAll = computed<Itinerary[]>(() => {
    const dep = this.plan().dep;
    return dep ? outboundsOn(this.hub(), this.dest(), dep, this.ctxAll()) : [];
  });
  /** The picked outbound, when ?out= flies that day (a connection resolves with the setting off). */
  readonly outPicked = computed<Itinerary | null>(() => matchSlug(this.plan().out, this.outsAll()));
  protected readonly outKey = computed(() => { const it = this.outPicked(); return it ? itinKey(it) : null; });
  protected readonly outRows = computed(() => {
    const its = [...this.outs()];
    const p = this.outPicked();
    if (p && !its.some(i => itinKey(i) === itinKey(p))) its.push(p);
    its.sort((a, b) => a.departUtc - b.departUtc);
    return its.map(i => optionRow(i, this.fmt()));
  });
  protected readonly visibleOut = computed(() => {
    const rows = this.outRows();
    if (this.allOut() || rows.length <= ROWS_SHOWN) return rows;
    const shown = rows.slice(0, ROWS_SHOWN);
    const sel = rows.find(r => r.key === this.outKey());
    return sel && !shown.includes(sel) ? [...shown, sel] : shown;
  });
  protected readonly hiddenOut = computed(() => (this.ctx().showConnections ? 0 : this.outsAll().length - this.outs().length));

  private readonly outKeys = computed(() => {
    const dep = this.plan().dep;
    if (!dep) return [];
    const e = this.outExt();
    return stripKeys(dep, STRIP_SPAN + 7 * e.before, STRIP_SPAN + 7 * e.after, this.ctx().today);
  });
  protected readonly outStrip = computed(() => outCounts(this.hub(), this.dest(), this.outKeys(), this.ctx(), this.fmt()));

  /** The next day with a flight out after dep (nonstop, or a connection when they are shown). */
  protected readonly nextOut = computed(() => {
    const dep = this.plan().dep;
    if (!dep || this.outs().length) return null;
    const direct = nextFlightDate(this.hub(), this.dest(), dep, false);
    const conn = this.ctx().showConnections ? nextConnectionDate(this.hub(), this.dest(), addDays(dep, 1), this.ctx().connect) : null;
    const next = [direct, conn].filter((k): k is string => !!k).sort()[0] ?? null;
    return next && !isOutside(next, this.ctx().coverage) ? next : null;
  });
  /** Nothing flies on the whole out strip: the season has not started (one sentence with Go). */
  protected readonly seasonal = computed(() => {
    const n = this.nextOut();
    const keys = this.outKeys();
    return n && keys.length && n > keys[keys.length - 1] && this.outStrip().every(c => c.state !== 'ok') ? n : null;
  });

  // ── Ways home ──────────────────────────────────────────────────────────────

  /** The outbound the ways home are counted after: the picked one, else the earliest arrival. */
  private readonly basis = computed(() => this.outPicked() ?? earliestArrival(this.outs()));
  readonly afterUtc = computed(() => homeAfterUtc(this.outPicked(), this.outs(), this.ctx().connect));

  protected readonly rule = computed(() => {
    const b = this.basis();
    if (!b) return null;
    const min = this.ctx().connect.minConnect ?? 60;
    const when = landingLabel(b, this.ctx().today, this.fmt());
    return this.outPicked()
      ? t('planner.plan.ruleAfterPicked', { min, flight: flightsOf(b), when })
      : t('planner.plan.ruleAfterEarliest', { min, when });
  });

  readonly homes = computed<Itinerary[]>(() => {
    const { ret } = this.plan();
    return ret ? waysHome(this.dest(), this.hub(), ret, this.ctx(), this.afterUtc()) : [];
  });
  /** The return day's itineraries of every kind, before the landing filter (for staleBack). */
  private readonly homesAll = computed<Itinerary[]>(() => {
    const { ret } = this.plan();
    return ret ? waysHome(this.dest(), this.hub(), ret, this.ctxAll(), null) : [];
  });
  private readonly homesAfterAll = computed<Itinerary[]>(() => {
    const { ret } = this.plan();
    return ret ? waysHome(this.dest(), this.hub(), ret, this.ctxAll(), this.afterUtc()) : [];
  });
  protected readonly backCheck = computed(() => staleBack(this.plan().back, this.homesAll(), this.afterUtc()));
  /** The picked way home, when it still fits (flies that day, after you land). */
  readonly backPicked = computed<Itinerary | null>(() => (this.backCheck().stale ? null : this.backCheck().it));
  protected readonly backKey = computed(() => { const it = this.backPicked(); return it ? itinKey(it) : null; });
  protected readonly homeRows = computed(() => {
    const its = [...this.homes()];
    const p = this.backPicked();
    if (p && !its.some(i => itinKey(i) === itinKey(p))) its.push(p);
    its.sort((a, b) => a.departUtc - b.departUtc);
    return its.map(i => optionRow(i, this.fmt()));
  });
  protected readonly visibleHome = computed(() => {
    const rows = this.homeRows();
    if (this.allHome() || rows.length <= ROWS_SHOWN) return rows;
    const shown = rows.slice(0, ROWS_SHOWN);
    const sel = rows.find(r => r.key === this.backKey());
    return sel && !shown.includes(sel) ? [...shown, sel] : shown;
  });
  protected readonly hiddenHome = computed(() => (this.ctx().showConnections ? 0 : this.homesAfterAll().length - this.homes().length));

  private readonly homeKeys = computed(() => {
    const { dep, ret } = this.plan();
    if (!dep || !ret) return [];
    const arr = this.basis()?.arrDateKey ?? dep;
    const start = arr > dep ? (arr < ret ? arr : ret) : dep;
    const e = this.homeExt();
    return stripKeys(ret, diffDays(start, ret) + 7 * e.before, STRIP_SPAN + 7 * e.after, dep);
  });
  protected readonly homeStrip = computed(() => {
    const dep = this.plan().dep;
    return dep ? homeCounts(this.dest(), this.hub(), this.homeKeys(), dep, this.ctx(), this.afterUtc(), this.fmt()) : [];
  });

  protected readonly nearest = computed(() => {
    const { dep, ret } = this.plan();
    if (!dep || !ret || this.homes().length) return [];
    return nearestHomeDays(this.dest(), this.hub(), ret, dep, this.ctx(), this.afterUtc());
  });

  protected readonly nightCount = computed(() => {
    const { dep, ret } = this.plan();
    return dep && ret ? nightsBetween(dep, ret) : null;
  });

  /** Stay chips (no return day yet): five stays, counted after you land. */
  protected readonly stays = computed(() => {
    const dep = this.plan().dep;
    return dep ? stayOptions(dep, this.dest(), this.hub(), this.ctx(), this.afterUtc(), this.fmt()) : [];
  });
  protected readonly stayFor = (n: number) =>
    stayOptions(this.plan().dep!, this.dest(), this.hub(), this.ctx(), this.afterUtc(), this.fmt(), [n])[0];

  /** '7d 15h in Lisbon': from the outbound's landing to the way home's departure. */
  protected readonly stay = computed(() => {
    const o = this.outPicked(), b = this.backPicked();
    return o && b ? t('planner.plan.stayIn', { dur: formatStay(b.departUtc - o.arriveUtc), city: this.city() }) : null;
  });

  // ── Notices (D6) ───────────────────────────────────────────────────────────

  protected readonly notices = computed<PlanNotice[]>(() => {
    const out: PlanNotice[] = [];
    const { dep, ret, out: outSlug, back: backSlug } = this.plan();
    if (!dep || this.loading()) return out;
    if (outSlug && !this.outPicked()) {
      const carry = carryPick(outSlug, this.outs(), !outSlug.includes('+'));
      const s = carry.suggestion;
      const base = { flight: slugLabel(outSlug), date: this.label(dep) };
      out.push({
        id: 'carry',
        text: s
          ? t(s.hubs.length ? 'planner.toast.carryConn' : 'planner.toast.carryNonstop', {
            ...base, suggestion: `${flightsOf(s)} ${formatClock(s.legs[0].depLocal, this.fmt())}`,
          })
          : t('planner.toast.carryNone', base),
        action: s ? { label: t('planner.toast.pick'), run: () => this.setOut(flightSlug(s)) } : null,
        dismiss: () => this.setOut(null),
      });
    }
    const check = this.backCheck();
    if (ret && backSlug && check.stale) {
      const flight = slugLabel(backSlug);
      out.push({
        id: check.stale,
        text: check.stale === 'beforeLanding'
          ? t('planner.toast.beforeLanding', { flight })
          : t('planner.toast.backGone', { flight, date: this.label(ret) }),
        action: null,
        dismiss: () => this.setBack(null),
      });
    }
    const moved = this.retMoved();
    if (moved) {
      out.push({
        id: 'moved',
        text: t('planner.toast.retMoved', { date: this.label(moved.date), nights: t('planner.nights', { n: moved.nights }) }),
        action: null,
        dismiss: () => this.retMoved.set(null),
      });
    }
    return out;
  });

  // ── Bar and trips ──────────────────────────────────────────────────────────

  private side(it: Itinerary | null, count: number | null): PlanBarSide {
    return {
      picked: it ? { flight: flightsOf(it), time: formatClock(it.legs[0].depLocal, this.fmt()) } : null,
      count,
    };
  }
  protected readonly barOut = computed(() => this.side(this.outPicked(), this.outRows().length));
  protected readonly barHome = computed(() => this.side(this.backPicked(), this.plan().ret ? this.homeRows().length : null));

  /** Trips on these dates the outbound connects to. */
  protected readonly connectedTrips = computed(() => {
    const it = this.outPicked();
    return it ? tripsFor(this.trips.activeTrips(), it) : [];
  });
  protected readonly startLabel = computed(() => {
    const tr = this.connectedTrips()[0];
    return tr ? t('planner.plan.addTo', { name: tr.goal.name }) : t('planner.plan.start');
  });

  protected readonly calendarLink = computed(() => calendarPath(this.dest()));
  protected readonly calendarParams = computed<Params>(() => ({ ...this.state.globalParams(), ...planParams(this.plan()) }));

  constructor() {
    // Opening the plan (or moving its departure) moves the app to that day, as the picker's Done did.
    effect(() => {
      const dep = this.plan().dep;
      if (dep) untracked(() => this.state.jumpTo(dep));
    });
    // No usable departure: back to the picker (a not-yet-published one shows its card instead).
    effect(() => {
      if (this.loading() || this.plan().dep || this.unpublished()) return;
      untracked(() => void this.router.navigate(calendarPath(this.dest()), {
        queryParams: this.state.globalParams(), replaceUrl: true,
      }));
    });
    effect(() => {
      this.plan().dep;
      untracked(() => this.allOut.set(false));
    });
    // Keep the picked days in view: the strips start days before them, wider than a phone.
    effect(() => {
      this.outStrip();
      this.homeStrip();
      afterNextRender(() => this.centerStrips(), { injector: this.injector });
    });
    effect(() => {
      this.plan().ret;
      untracked(() => this.allHome.set(false));
    });
  }

  /** Scrolls each strip so its selected day sits in the middle (no page scroll). */
  private centerStrips(): void {
    for (const sel of Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('app-day-count-strip [aria-selected="true"]'))) {
      const track = sel.parentElement;
      if (!track) continue;
      const a = sel.getBoundingClientRect(), b = track.getBoundingClientRect();
      track.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
    }
  }

  protected label(key: string): string {
    return dayLabel(key, this.ctx().today);
  }

  protected longDate(key: string): string {
    return longDay(key);
  }

  private write(p: Partial<Record<'dep' | 'ret' | 'out' | 'back', string | null>>): void {
    void this.router.navigate([], { queryParams: p, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }

  /** A new departure day: the picks stay in the URL (D6); a return on or before it moves to keep the nights. */
  setDep(key: string): void {
    const { dep, ret } = this.plan();
    if (!dep || key === dep || !isDateKey(key) || key < this.ctx().today || isOutside(key, this.ctx().coverage)) return;
    const shifted = shiftRet(key, dep, ret);
    const p: Partial<Record<'dep' | 'ret', string | null>> = { dep: key };
    if (shifted.moved && shifted.ret) {
      p.ret = shifted.ret;
      this.retMoved.set({ date: shifted.ret, nights: nightsBetween(key, shifted.ret) });
    } else {
      this.retMoved.set(null);
    }
    this.write(p);
    const n = outboundsOn(this.hub(), this.dest(), key, this.ctx()).length;
    this.announce.set(t('planner.plan.announceOut', { n, date: longDay(key) }));
  }

  setRet(key: string): void {
    const { dep, ret } = this.plan();
    if (!dep || key === ret || !isDateKey(key) || key < dep || isOutside(key, this.ctx().coverage)) return;
    this.retMoved.set(null);
    this.write({ ret: key });
    const n = waysHome(this.dest(), this.hub(), key, this.ctx(), this.afterUtc()).length;
    this.announce.set(t('planner.plan.announceHome', { n, date: longDay(key) }));
  }

  setOut(slug: string | null): void {
    this.write({ out: slug });
  }

  setBack(slug: string | null): void {
    this.write({ back: slug });
  }

  protected toggleOut(it: Itinerary): void {
    this.setOut(itinKey(it) === this.outKey() ? null : flightSlug(it));
  }

  protected toggleBack(it: Itinerary): void {
    this.setBack(itinKey(it) === this.backKey() ? null : flightSlug(it));
  }

  protected extendOut(d: -1 | 1): void {
    this.outExt.update(e => (d < 0 ? { ...e, before: e.before + 1 } : { ...e, after: e.after + 1 }));
  }

  protected extendHome(d: -1 | 1): void {
    this.homeExt.update(e => (d < 0 ? { ...e, before: e.before + 1 } : { ...e, after: e.after + 1 }));
  }

  /** PlanBar: scroll to a section and focus its heading. */
  protected focusSection(id: string): void {
    const h = this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
    if (!h) return;
    h.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    h.focus({ preventScroll: true });
  }

  protected leave(): void {
    this.state.goBack(destPath(this.dest()));
  }

  protected share(): void {
    const { dep, ret } = this.plan();
    const when = dep && ret ? shortRange(dep, ret, this.ctx().today) : dep ? this.label(dep) : '';
    void this.sharer.share(when ? `${this.city()} · ${when}` : this.city());
  }

  exportIcs(): void {
    const o = this.outPicked();
    if (!o) return;
    const list = roundTrip(o, this.backPicked());
    downloadIcs(buildIcs(list, this.city()), icsFilename(list));
  }

  /** Start a trip with both flights, or add them to the trip they connect to; then open it. */
  start(): void {
    const out = this.outPicked();
    if (!out || this.trips.readOnly()) return;
    const existing = this.connectedTrips()[0];
    const trip = existing ? this.addTo(existing, out) : startRoundTrip(this.trips, {
      hub: this.hub(), code: this.dest(), out, back: this.backPicked(), ret: this.plan().ret,
    });
    void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() });
  }

  private addTo(trip: Trip, out: Itinerary): Trip {
    const target = tripTarget(trip, out);
    if (target.kind === 'alternate') this.trips.addAlternate(trip.id, target.legId, out);
    else if (target.kind === 'leg') this.trips.addFlightLeg(trip.id, out, target.role);
    const back = this.backPicked();
    const hasReturn = trip.legs.some(l => l.kind === 'flight' && l.role === 'return' && l.status !== 'abandoned');
    if (back && !hasReturn && tripTarget(trip, back).kind !== 'already') {
      this.trips.addFlightLeg(trip.id, back, 'return');
      this.trips.update(trip.id, tr => ({ ...tr, homeBy: homeByFor(back) }));
    }
    return this.trips.trip(trip.id) ?? trip;
  }
}
