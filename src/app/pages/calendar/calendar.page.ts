import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input,
  linkedSignal, signal, untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { getCoverage } from '../../data/schedule-index';
import { t } from '../../i18n/t';
import {
  earliestArrival, homeAfterUtc, homeCounts, landingLabel, minuteOf, nightsBetween, outboundsOn, outCounts, planParams,
  readPlan, stayOptions, waysHome, type CountCtx, type StayOption,
} from '../../planner/round-trip';
import { AppStateService } from '../../state/app-state.service';
import { RecentService } from '../../state/recent.service';
import { BreakSourcesComponent } from '../../ui/break-sources.component';
import { DestRowComponent } from '../../ui/dest-row.component';
import { dayLabel, isOutside } from '../../ui/format';
import { calendarPath, destPath, planPath } from '../../ui/links';
import { SegComponent, type SegOption } from '../../ui/seg.component';
import { StayChipsComponent } from '../../ui/stay-chips.component';
import { breakLegend } from '../../trips/engine/busy-signals';
import { findDestination } from '../../utils/airports';
import { diffDays, monthKeys, monthOf, weekdayLetters } from '../../utils/time';
import { coverageHubFor } from '../../utils/week';
import {
  blockedPeek, chooserRows, clampKey, firstFlightDay, monthRange, moveKey, nextDayWith, nextSelection, peekDep, peekRet,
  pickable, seeLabel, type CalField, type ChooserRow, type HomeBasis, type Peek,
} from './cal-model';
import { CalListMonthComponent, CalMonthComponent } from './cal-month.component';

/** Months rendered eagerly; the rest wait for the viewport (@defer). */
const EAGER_MONTHS = 3;

/** A first flight further than this many days away gets the seasonal line ('First flights: Wed, Jun 2, 2027'). */
const SEASONAL_DAYS = 7;

/** localStorage key of the legend's open state (a per-viewer convenience). */
const LEGEND_KEY = 'ac.cal.legend.v1';

function readLegendOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(LEGEND_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLegendOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(LEGEND_KEY, open ? '1' : '0');
  } catch {
    /* private mode or blocked storage: the legend just starts closed */
  }
}

/**
 * Calendar (/calendar and /calendar/:code).
 *
 * Without a code: the chooser, a searchable list of destinations (favourites
 * first) leading to /calendar/CODE (a ?dep= from Home is kept).
 *
 * With a code: the round-trip picker (dates-spec §3.1). A step line says what
 * the next tap does; a sticky banner says which way the counts run (flights
 * out, then ways home after the earliest arrival). Every count is scheduled
 * flights from planner/round-trip.ts, never seats. ?dep= / ?ret= persist with
 * replaceUrl; ?out= / ?back= pass through untouched. See flights opens
 * /plan/CODE with all four and moves the app's week to the departure.
 */
@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [IconComponent, DestRowComponent, CalMonthComponent, CalListMonthComponent, BreakSourcesComponent, SegComponent, StayChipsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wash" aria-hidden="true"></div>
    @if (dest(); as d) {
      <div class="pk">
        <div class="pk__in">
          <header class="tb">
            <button type="button" class="lnk" (click)="cancel()">{{ t('planner.picker.cancel') }}</button>
            <h1 class="ui-h3 tb__t tn">{{ state.hub() }} → {{ d.code }}<span class="ui-sr-only">{{ t('calendar.datesSr', { city: d.city }) }}</span></h1>
            <button type="button" class="lnk lnk--b" [disabled]="!sel().dep" (click)="clear()">{{ t('planner.picker.clear') }}</button>
          </header>

          <div class="flds">
            <button type="button" class="fld" [class.on]="sel().active === 'dep'" [attr.aria-pressed]="sel().active === 'dep'"
                    (click)="setField('dep')">
              <span class="fld__l">{{ t('planner.picker.leave') }}</span>
              <b class="tn" [class.ph]="!sel().dep">{{ depLabel() }}</b>
            </button>
            <button type="button" class="fld" [class.on]="sel().active === 'ret' && !!sel().dep" [attr.aria-pressed]="sel().active === 'ret' && !!sel().dep"
                    [disabled]="!sel().dep" (click)="setField('ret')">
              <span class="fld__l">{{ t('planner.picker.home') }}</span>
              <b class="tn" [class.ph]="!sel().ret">{{ retLabel() }}</b>
            </button>
          </div>

          <div class="step" aria-live="polite" data-step>
            <p class="step__l">
              @if (stepLine().count) { <span class="step__n">{{ stepLine().count }}</span> · }{{ stepLine().text }}
            </p>
            @if (step() === 2) { <p class="step__s">{{ t('planner.picker.step2Sub') }}</p> }
            @if (seasonal(); as sd) {
              <p class="step__s step__s--season">
                {{ t('planner.picker.seasonal', { date: sd.label }) }}
                <button type="button" class="ui-link" (click)="jump(sd.key)">{{ t('planner.picker.jump') }}</button>
              </p>
            }
          </div>

          <div class="bn" [class.bn--home]="home()" data-banner>
            <span class="bn__i" aria-hidden="true"><app-icon name="plane" [size]="16" /></span>
            <div class="bn__t">
              <b>{{ bannerText() }}</b>
              @if (home() && arrivalLine(); as al) { <span class="bn__s">{{ al }}</span> }
            </div>
            <app-seg class="bn__tg" size="sm" [options]="connOptions()" [value]="state.showConnections() ? 'all' : 'nonstop'"
                     (valueChange)="setConnections($event)" [ariaLabel]="t('planner.conn.aria')" data-conn />
          </div>

          @if (home() && chipDep(); as cd) {
            <div class="chips">
              <app-stay-chips [options]="stays()" [selected]="staySelected()" [dep]="cd" [today]="state.todayKey()"
                              [compute]="stayCompute()" (pick)="pick($event)" />
            </div>
          }

          <div class="vw">
            <app-seg [options]="viewOptions()" [value]="view()" (valueChange)="setView($event)" stretch size="sm"
                     [ariaLabel]="t('planner.picker.viewAria')" />
            <p class="vw__k" data-key-line>
              <span><i class="dm dm--solid" aria-hidden="true"></i>{{ t('planner.legend.nonstop') }}</span>
              <span><i class="dm dm--dotted" aria-hidden="true"></i>{{ t('planner.legend.conn') }}</span>
            </p>
          </div>

          @if (view() === 'cal') {
            <div class="wkh" aria-hidden="true">
              @for (w of weekdays(); track $index) { <span>{{ w }}</span> }
            </div>
            <div class="months" (keydown)="onKey($event)">
              @for (m of months(); track m; let i = $index) {
                @if (eager > i) {
                  <app-cal-month class="mo" [ym]="m" [hub]="state.hub()" [code]="d.code" [ctx]="ctx()" [fmt]="state.timeFormat()"
                                 [home]="home()" [dep]="sel().dep" [ret]="sel().ret" [focusKey]="focusKey()"
                                 (pick)="pick($event)" />
                } @else {
                  @defer (on viewport; when renderUpTo() >= i) {
                    <app-cal-month class="mo" [ym]="m" [hub]="state.hub()" [code]="d.code" [ctx]="ctx()" [fmt]="state.timeFormat()"
                                   [home]="home()" [dep]="sel().dep" [ret]="sel().ret" [focusKey]="focusKey()"
                                   (pick)="pick($event)" />
                  } @placeholder {
                    <div class="mo mo--ph"></div>
                  }
                }
              }
            </div>
          } @else {
            <div class="months months--list">
              @for (m of months(); track m; let i = $index) {
                @if (eager > i) {
                  <app-cal-list-month class="mo" [ym]="m" [hub]="state.hub()" [code]="d.code" [ctx]="ctx()" [fmt]="state.timeFormat()"
                                      [home]="home()" [dep]="sel().dep" [ret]="sel().ret" (pick)="pick($event)" />
                } @else {
                  @defer (on viewport; when renderUpTo() >= i) {
                    <app-cal-list-month class="mo" [ym]="m" [hub]="state.hub()" [code]="d.code" [ctx]="ctx()" [fmt]="state.timeFormat()"
                                        [home]="home()" [dep]="sel().dep" [ret]="sel().ret" (pick)="pick($event)" />
                  } @placeholder {
                    <div class="mo mo--ph mo--phl"></div>
                  }
                }
              }
            </div>
          }

          <footer class="ft">
            <div class="ft__r">
              <p class="pe tn" aria-live="polite" data-peek>
                {{ peek().text }}
                @if (peek().go; as g) {
                  <button type="button" class="ui-link pe__go" (click)="go(g)">{{ t('planner.go') }}</button>
                }
              </p>
              <details class="lg" [open]="legendOpen()" (toggle)="onLegend($event)">
                <summary class="lg__s">{{ t('planner.legend.title') }}</summary>
                <div class="lg__p">
                  <p class="lg__h">{{ legendTitle() }}</p>
                  <ul class="lg__l">
                    <li><i class="dm dm--solid" aria-hidden="true"></i>{{ t('planner.legend.nonstop') }}</li>
                    <li><i class="dm dm--dotted" aria-hidden="true"></i>{{ t('planner.legend.conn') }}</li>
                    <li><span class="lg__dash" aria-hidden="true">–</span>{{ t('planner.legend.none') }}</li>
                    <li><i class="lg__hatch dm--hatch" aria-hidden="true"></i>{{ t('planner.legend.unpublished') }}</li>
                    <li><i class="lg__m lg__m--h" aria-hidden="true"></i>{{ t('planner.legend.holiday') }}</li>
                    <li><i class="lg__m lg__m--b" aria-hidden="true"></i>{{ breakLegend() ?? t('planner.legend.break') }}</li>
                  </ul>
                  <app-break-sources [hub]="state.hub()" />
                </div>
              </details>
            </div>
            <button type="button" class="ui-btn ui-btn--block ft__b" [disabled]="!sel().dep || loading()" (click)="done()">{{ see() }}</button>
          </footer>
        </div>
      </div>
    } @else {
      <div class="ui-page ui-page--bare ch">
        <div class="ch__top">
          <button type="button" class="ui-circ ui-circ--glass back" [attr.aria-label]="t('ui.back')" (click)="state.goBack(['/'])">
            <app-icon name="arrow-left" [size]="20" />
          </button>
        </div>
        <h1 class="ui-h1">{{ roundTrip() ? t('planner.home.chooserTitle') : t('calendar.title') }}</h1>
        <p class="ui-sub ch__s">{{ roundTrip() ? t('planner.home.chooserSub') : t('calendar.sub') }}</p>
        <label class="ui-search ui-glass ch__q">
          <app-icon name="search" [size]="18" />
          <input type="search" data-search-input [placeholder]="t('calendar.search')" [attr.aria-label]="t('calendar.search')"
                 [value]="query()" (input)="query.set($any($event.target).value)" />
        </label>
        @if (chooser().recent.length) {
          <h2 class="ui-sec-h ch__h"><span class="ui-h3">{{ t('calendar.recent') }}</span></h2>
          <div class="ui-card ch__l" data-recent>
            @for (r of chooser().recent; track r.code) {
              <app-dest-row [code]="r.code" [small]="r.code" [meta]="r.meta" [link]="calendarPath(r.code)" [queryParams]="chooserParams()" />
            }
          </div>
        }
        @if (chooser().saved.length) {
          <h2 class="ui-sec-h ch__h"><span class="ui-h3">{{ t('calendar.saved') }}</span></h2>
          <div class="ui-card ch__l">
            @for (r of chooser().saved; track r.code) {
              <app-dest-row [code]="r.code" [small]="r.code" [meta]="r.meta" [link]="calendarPath(r.code)" [queryParams]="chooserParams()" />
            }
          </div>
        }
        @if (chooser().all.length) {
          <h2 class="ui-sec-h ch__h"><span class="ui-h3">{{ t('calendar.all') }}</span></h2>
          @if (showIndex()) {
            <nav class="az" [attr.aria-label]="t('calendar.az')" data-az>
              @for (g of groups(); track g.letter) {
                <button type="button" class="az__b" (click)="jumpTo(g.letter)">{{ g.letter }}</button>
              }
            </nav>
          }
          <div class="ui-card ch__l">
            @for (g of groups(); track g.letter) {
              <h3 class="az__h" [id]="'az-' + g.letter" tabindex="-1">{{ g.letter }}</h3>
              @for (r of g.rows; track r.code) {
                <app-dest-row [code]="r.code" [small]="r.code" [meta]="r.meta" [link]="calendarPath(r.code)" [queryParams]="chooserParams()" />
              }
            }
          </div>
        }
        @if (!chooser().saved.length && !chooser().all.length) {
          <p class="ui-sub ch__none">{{ t('calendar.noMatch', { query: query() }) }}</p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .wash {
      position: absolute; top: 0; left: 0; right: 0; height: 320px; z-index: 0; pointer-events: none;
      background: linear-gradient(180deg, var(--sky) 0, var(--bg) 280px);
    }
    .ui-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

    /* ── Chooser ── */
    .ch__top { display: flex; margin-bottom: 14px; }
    .ch__s { margin-top: 6px; }
    .ch__q { margin-top: 18px; }
    .ch__h { margin: 22px 0 10px; }
    .ch__l { padding: 4px 14px; }
    .ch__none { margin-top: 22px; text-align: center; }
    /* A–Z jump row: sticks under the top while the long list scrolls. */
    .az {
      position: sticky; top: 0; z-index: 3; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none;
      margin: 0 calc(-1 * var(--gutter)) 8px; padding: 4px 36px 4px var(--gutter);
      background: var(--bg); border-bottom: 1px solid var(--hair);
      -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
      mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
    }
    .az::-webkit-scrollbar { display: none; }
    .az__b { flex: none; min-width: 36px; min-height: 44px; font-size: 14px; font-weight: 650; color: var(--blue); border-radius: 10px; }
    .az__h {
      margin: 0; padding: 14px 0 4px; font-size: 12px; font-weight: 700; letter-spacing: .08em; color: var(--ink-3);
      scroll-margin-top: 60px;
    }
    .az__h:first-child { padding-top: 8px; }

    /* ── Picker (mobile: full-bleed --surface) ── */
    .pk, .ch { position: relative; }
    .pk { background: var(--surface); min-height: 100dvh; --bn-h: 64px; --cal-sticky: calc(var(--bn-h) + 34px); }
    .pk__in { display: flex; flex-direction: column; min-height: 100dvh; }
    .tb {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: calc(env(safe-area-inset-top) + 14px) 16px 0;
    }
    .tb__t { white-space: nowrap; }
    .lnk { color: var(--blue); font-size: 15px; padding: 6px 0; min-width: 56px; min-height: 44px; text-align: left; }
    .lnk--b { font-weight: 600; text-align: right; }
    .lnk:disabled { color: var(--ink-3); cursor: default; }
    .flds { display: flex; gap: 10px; padding: 12px 16px 8px; }
    .fld {
      flex: 1; min-width: 0; text-align: left; padding: 10px 12px; border-radius: 22px; background: var(--fill);
      display: flex; flex-direction: column; gap: 1px; color: var(--ink); font-size: 15px;
      box-shadow: inset 0 0 0 2px transparent; transition: box-shadow var(--dur-fast) var(--ease-out);
    }
    .fld.on { box-shadow: inset 0 0 0 2px var(--red); }
    .fld:disabled { cursor: default; }
    .fld__l { font-size: 11px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .02em; }
    .fld b { overflow-wrap: anywhere; }
    .fld b.ph { color: var(--ink-2); font-weight: 600; }

    .step { padding: 4px 16px 10px; }
    .step__l { font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.35; }
    .step__n { color: var(--ink-2); }
    .step__s { font-size: 13px; color: var(--ink-2); margin-top: 2px; line-height: 1.35; }
    .step__s--season { color: var(--ink); }
    .step__s .ui-link { position: relative; margin-left: 4px; font-weight: 600; }

    /* Direction banner: sticks to the top; the weekday header sticks under it. */
    .bn {
      position: sticky; top: 0; z-index: 4; display: flex; align-items: flex-start; gap: 10px;
      min-height: 40px; padding: 8px 16px; background: var(--fill); border-block: 1px solid var(--hair);
    }
    .bn--home { background: color-mix(in srgb, var(--blue) 12%, var(--surface)); }
    .bn__i {
      flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
      background: var(--surface); color: var(--ink);
    }
    /* Taking off (out) and coming in to land (home): the shape changes with the direction, not just the tint. */
    .bn__i app-icon { display: grid; transform: rotate(45deg); }
    .bn--home .bn__i app-icon { transform: rotate(135deg); }
    .bn__t { display: flex; flex-direction: column; min-width: 0; gap: 1px; font-size: 14px; line-height: 1.3; }
    .bn__t b { font-weight: 650; }
    .bn__s { font-size: 12.5px; color: var(--ink-2); }
    .bn { flex-wrap: wrap; row-gap: 6px; }
    .bn__t { flex: 1 1 160px; }
    .bn__tg { flex: none; margin-left: auto; }
    .vw__k { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 12px; color: var(--ink-2); }
    .vw__k span { display: inline-flex; align-items: center; gap: 6px; }
    .vw__k .dm { color: var(--blue); }
    .chips { padding: 10px 16px 0; }
    .vw { padding: 10px 16px 4px; }
    .wkh {
      display: grid; grid-template-columns: repeat(7, 1fr); text-align: center;
      font-size: 11px; font-weight: 600; color: var(--ink-3); padding: 8px 12px;
      border-bottom: 1px solid var(--hair); position: sticky; top: var(--bn-h); z-index: 3; background: var(--surface);
    }
    .months { padding: 12px 12px 0; flex: 1; }
    .months--list { padding-top: 14px; }
    .mo { display: block; margin-bottom: 14px; }
    .mo--ph { height: 380px; }
    .mo--phl { height: 240px; }

    /* Sticky footer: the peek line (with the Key) and the button. */
    .ft {
      position: sticky; bottom: 0; z-index: 5; background: var(--surface); border-top: 1px solid var(--hair);
      padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
    }
    .ft__r { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; position: relative; }
    .pe { flex: 1; min-width: 0; font-size: 13px; color: var(--ink-2); line-height: 1.35; min-height: 18px; }
    .pe__go { position: relative; margin-left: 4px; font-weight: 600; }
    .ft__b { white-space: normal; text-align: center; min-height: 48px; }
    .lg { flex: none; }
    .lg__s {
      position: relative; list-style: none; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--blue);
      padding: 0 2px; line-height: 18px;
    }
    .lg__s::-webkit-details-marker { display: none; }
    .lg__s::after { content: ''; position: absolute; inset: -13px -10px; }
    .lg__p {
      position: absolute; right: 0; bottom: calc(100% + 12px); width: min(320px, calc(100vw - 32px));
      border-radius: 16px; padding: 12px 14px; box-shadow: var(--shadow); background: var(--surface);
      border: 1px solid var(--hair);
    }
    .lg__h { font-size: 13px; font-weight: 650; margin-bottom: 6px; }
    .lg__l { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
    .lg__l li { display: flex; align-items: center; gap: 8px; }
    .lg__l .dm { margin: 0; color: var(--teal); flex: none; }
    .lg__dash { width: 14px; text-align: center; font-weight: 650; }
    .lg__hatch { display: inline-block; width: 14px; height: 12px; border-radius: 3px; border: 1px solid var(--hair); }
    .lg__m { display: inline-block; width: 7px; height: 7px; margin: 0 3.5px; border-radius: 50%; box-sizing: border-box; flex: none; }
    .lg__m--h { background: var(--ink-2); }
    .lg__m--b { border: 1.5px solid var(--ink-2); }

    /* ── Desktop: a centred card on the sky wash ── */
    @media (min-width: 720px) {
      .pk { background: none; min-height: 0; padding: 24px 24px 48px; }
      .pk__in {
        max-width: 880px; margin: 0 auto; min-height: 0;
        background: var(--surface); border: 1px solid var(--hair); border-radius: var(--radius-card);
        box-shadow: var(--shadow);
      }
      .tb { padding: 20px 28px 0; }
      .flds { padding: 16px 28px 12px; }
      .fld { max-width: 260px; }
      .step, .chips, .vw { padding-inline: 28px; }
      .vw app-seg { max-width: 320px; }
      .bn { padding-inline: 28px; }
      .wkh { display: none; }
      .months { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 40px; padding: 8px 28px 0; }
      .ft {
        display: flex; align-items: center; justify-content: space-between; gap: 20px;
        border-radius: 0 0 var(--radius-card) var(--radius-card); padding: 16px 28px;
      }
      .ft__r { flex: 1; margin: 0; }
      .ft .ui-btn { width: auto; min-width: 300px; }
      .ch { padding-top: 32px; max-width: 760px; }
    }
  `],
})
export class CalendarPage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly recent = inject(RecentService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private destroyed = false;

  /** :code (absent on the chooser). */
  readonly code = input<string>();
  /** ?dep= and ?ret= (date keys). */
  readonly dep = input<string>();
  /** ?trip=round: opened from Home's "Plan a round trip" (the chooser says so). */
  readonly trip = input<string>();
  protected readonly roundTrip = computed(() => this.trip() === 'round');
  readonly ret = input<string>();
  /** ?out= / ?back= (flight slugs): passed through to /plan untouched. */
  readonly out = input<string>();
  readonly back = input<string>();

  protected readonly weekdays = computed(() => weekdayLetters());
  protected readonly eager = EAGER_MONTHS;
  protected readonly calendarPath = calendarPath;

  // ── Chooser ──
  readonly query = signal('');
  readonly chooser = computed(() =>
    chooserRows(this.state.hub(), this.state.favourites(), this.state.todayKey(), this.query(), this.recent.codes()),
  );
  /** A ?dep= from Home rides along to the picker. */
  protected readonly chooserParams = computed(() => {
    const dep = this.dep();
    return dep && pickable(dep, this.state.todayKey(), null) ? { ...this.state.globalParams(), dep } : undefined;
  });

  /** The "All" list grouped by first letter (accents folded), for the A–Z jump row. */
  protected readonly groups = computed(() => {
    const out: { letter: string; rows: ChooserRow[] }[] = [];
    for (const r of this.chooser().all) {
      const l = (r.city.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0) || '#').toUpperCase();
      const last = out[out.length - 1];
      if (last?.letter === l) last.rows.push(r);
      else out.push({ letter: l, rows: [r] });
    }
    return out;
  });
  /** The jump row only helps on the long list, not while searching. */
  protected readonly showIndex = computed(() => !this.query().trim() && this.chooser().all.length > 24);

  protected jumpTo(letter: string): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>(`#az-${letter}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }

  // ── Picker ──
  readonly dest = computed(() => findDestination(this.code()));
  private readonly destCode = computed(() => this.dest()?.code ?? '');
  /** The route's published window (the hub end of it). */
  readonly coverage = computed(() => getCoverage(coverageHubFor(this.state.hub(), this.destCode())));
  readonly months = computed(() => monthRange(this.state.todayKey(), this.coverage()));
  readonly loading = computed(() => this.state.dataLoad() === 'loading');
  private readonly nowMinute = computed(() => minuteOf(this.state.nowMs()));

  /** Everything a count depends on (round-trip.ts). */
  readonly ctx = computed<CountCtx>(() => ({
    today: this.state.todayKey(),
    nowMinute: this.nowMinute(),
    coverage: this.coverage(),
    showConnections: this.state.showConnections(),
    connect: this.state.connect(),
    loading: this.loading(),
  }));

  /** ?dep= names a day with no flights out (e.g. from Home): it is dropped and the footer says so. */
  readonly droppedDep = computed(() => {
    const raw = this.dep();
    const ctx = this.ctx();
    if (ctx.loading || !this.destCode() || !pickable(raw, ctx.today, ctx.coverage)) return null;
    return outboundsOn(this.state.hub(), this.destCode(), raw, ctx).length ? null : raw;
  });

  /**
   * Selection: seeded from ?dep / ?ret (readPlan: unpickable days and a
   * return before the departure are dropped, a same-day return needs a way
   * home that day), then driven by taps (and written back). Re-seeded only
   * when the URL, the day, the window or the data load change, not on the
   * minute tick.
   */
  readonly sel = linkedSignal({
    source: () => ({
      dep: this.dep(), ret: this.ret(), today: this.state.todayKey(), cov: this.coverage(), loading: this.loading(),
      dropped: this.droppedDep(),
    }),
    computation: (s): { dep: string | null; ret: string | null; active: CalField } => {
      if (s.dropped) return { dep: null, ret: null, active: 'dep' };
      const plan = untracked(() => readPlan({ dep: s.dep, ret: s.ret }, s.today, s.cov, dep => this.dayTripOk(dep)));
      return { dep: plan.dep, ret: plan.ret, active: plan.dep ? 'ret' : 'dep' };
    },
  });

  /** 1: pick the day you leave; 2: pick the day home; 3: both set. */
  readonly step = computed<1 | 2 | 3>(() => {
    const s = this.sel();
    if (s.active === 'dep' || !s.dep) return 1;
    return s.ret ? 3 : 2;
  });

  /** The earliest a way home may leave: the earliest arrival on the departure day plus the minimum connection. */
  readonly afterUtc = computed(() => {
    const dep = this.sel().dep;
    if (!dep) return null;
    const ctx = this.ctx();
    return homeAfterUtc(null, outboundsOn(this.state.hub(), this.destCode(), dep, ctx), ctx.connect);
  });

  /** Set once a departure is picked and the next tap fills the return: the grid counts ways home. */
  readonly home = computed<HomeBasis | null>(() => {
    const s = this.sel();
    return s.active === 'ret' && s.dep ? { dep: s.dep, afterUtc: this.afterUtc() } : null;
  }, {
    // A return-day tap leaves dep and afterUtc as they were: keep the identity, so no month recounts.
    equal: (a, b) => a === b || (!!a && !!b && a.dep === b.dep && a.afterUtc === b.afterUtc),
  });

  /** Kept as `dir` for callers: which way the counts run. */
  readonly dir = computed(() => {
    const hub = this.state.hub();
    const code = this.destCode();
    return this.home() ? { from: code, to: hub } : { from: hub, to: code };
  });

  protected readonly bannerText = computed(() => {
    const { from, to } = this.dir();
    return t(this.home() ? 'planner.picker.bannerHome' : 'planner.picker.bannerOut', { from, to });
  });

  /** 'Counted after the earliest arrival (Sat, Nov 21 08:15)'. */
  protected readonly arrivalLine = computed(() => {
    const dep = this.sel().dep;
    if (!dep) return null;
    const first = earliestArrival(outboundsOn(this.state.hub(), this.destCode(), dep, this.ctx()));
    return first ? t('planner.picker.countedAfter', { when: landingLabel(first, this.state.todayKey(), this.state.timeFormat()) }) : null;
  });

  protected readonly stepLine = computed<{ count: string; text: string }>(() => {
    const key = this.step() === 1 ? 'planner.picker.step1' : this.step() === 2 ? 'planner.picker.step2' : 'planner.picker.stepDone';
    const full = t(key);
    if (this.step() === 3) return { count: '', text: full };
    const i = full.indexOf(' · ');
    return i < 0 ? { count: '', text: full } : { count: full.slice(0, i), text: full.slice(i + 3) };
  });

  /** The first day with a flight out (opening scroll, seasonal line). */
  readonly firstFlight = computed(() => (this.destCode() ? firstFlightDay(this.state.hub(), this.destCode(), this.ctx()) : null));

  /** 'First flights: Wed, Jun 2, 2027' when nothing is picked and the first flight is more than a week away. */
  protected readonly seasonal = computed(() => {
    const first = this.firstFlight();
    const today = this.state.todayKey();
    if (this.sel().dep || !first || diffDays(today, first) <= SEASONAL_DAYS) return null;
    return { key: first, label: dayLabel(first, today) };
  });

  /** The roving tabindex target in the grid. */
  readonly focusKey = linkedSignal(() => this.sel().dep ?? this.firstFlight() ?? this.firstPickable());
  /**
   * Deferred months up to the one holding the focus (keyboard moves, a deep
   * ?dep=, a seasonal first flight) render without waiting for the viewport,
   * so the roving tab stop always exists.
   */
  protected readonly renderUpTo = computed(() => {
    const k = this.focusKey();
    return k ? this.months().indexOf(k.slice(0, 7)) : -1;
  });

  protected readonly breakLegend = computed(() => breakLegend(this.state.hub()));
  protected readonly legendTitle = computed(() => t(this.home() ? 'planner.legend.home' : 'planner.legend.out'));
  protected readonly legendOpen = signal(readLegendOpen());

  protected onLegend(e: Event): void {
    const open = (e.target as HTMLDetailsElement).open;
    this.legendOpen.set(open);
    writeLegendOpen(open);
  }

  // ── Stay chips (step 2) ──
  protected readonly chipDep = computed(() => (this.home() ? this.sel().dep : null));
  readonly stays = computed<StayOption[]>(() => {
    const dep = this.chipDep();
    if (!dep) return [];
    return stayOptions(dep, this.destCode(), this.state.hub(), this.ctx(), this.afterUtc(), this.state.timeFormat());
  });
  protected readonly staySelected = computed(() => {
    const { dep, ret } = this.sel();
    return dep && ret ? nightsBetween(dep, ret) : null;
  });
  protected readonly stayCompute = computed(() => {
    const dep = this.chipDep();
    if (!dep) return null;
    const code = this.destCode();
    const hub = this.state.hub();
    const ctx = this.ctx();
    const after = this.afterUtc();
    const fmt = this.state.timeFormat();
    return (n: number): StayOption => stayOptions(dep, code, hub, ctx, after, fmt, [n])[0];
  });

  // ── View ──
  readonly view = signal<'cal' | 'list'>('cal');
  protected readonly viewOptions = computed<SegOption[]>(() => [
    { value: 'cal', label: t('planner.picker.viewCalendar') },
    { value: 'list', label: t('planner.picker.viewList') },
  ]);
  protected setView(v: string | undefined): void {
    this.view.set(v === 'list' ? 'list' : 'cal');
  }

  // ── Footer ──
  /** A message from the last tap (why a day can't be picked, Dates cleared…); cleared by the next tap. */
  private readonly tapPeek = signal<Peek | null>(null);

  readonly peek = computed<Peek>(() => {
    const msg = this.tapPeek();
    if (msg) return msg;
    const s = this.sel();
    const ctx = this.ctx();
    const today = ctx.today;
    if (!s.dep) {
      const dropped = this.droppedDep();
      if (dropped) return { text: t('planner.picker.droppedDep', { city: this.dest()?.city ?? '', date: dayLabel(dropped, today) }) };
      return { text: t('planner.picker.peekIdle') };
    }
    const hub = this.state.hub();
    const code = this.destCode();
    if (s.ret) {
      const c = homeCounts(code, hub, [s.ret], s.dep, ctx, this.afterUtc(), this.state.timeFormat())[0];
      return { text: peekRet(c, s.dep, today) };
    }
    return { text: peekDep(outCounts(hub, code, [s.dep], ctx, this.state.timeFormat())[0], today) };
  });

  readonly see = computed(() =>
    (this.loading() ? t('planner.picker.loading') : seeLabel(this.sel().dep, this.sel().ret, this.state.todayKey())));
  readonly depLabel = computed(() => (this.sel().dep ? dayLabel(this.sel().dep!, this.state.todayKey()) : t('planner.picker.pickDay')));
  readonly retLabel = computed(() => {
    const { dep, ret } = this.sel();
    if (!ret) return t('planner.picker.pickDay');
    const day = dayLabel(ret, this.state.todayKey());
    return ret === dep ? `${day} · ${t('planner.dayTrip')}` : day;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // Opening scroll: the departure's month, else the month of the first flight.
    afterNextRender(() => {
      const target = this.sel().dep ?? this.firstFlight();
      if (target && monthOf(target) !== this.months()[0]) this.scrollToMonth(monthOf(target), 3);
    });
    // The weekday header sticks under the banner, whose height grows when text wraps.
    afterNextRender(() => {
      const bn = this.host.nativeElement.querySelector<HTMLElement>('[data-banner]');
      const pk = this.host.nativeElement.querySelector<HTMLElement>('.pk');
      if (!bn || !pk || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => pk.style.setProperty('--bn-h', `${bn.offsetHeight}px`));
      ro.observe(bn);
      this.injector.get(DestroyRef).onDestroy(() => ro.disconnect());
    });
  }

  private firstPickable(): string {
    const today = this.state.todayKey();
    const from = this.coverage().from;
    return from && from > today ? from : today;
  }

  /** A same-day return needs a way home on the departure day after the earliest arrival. */
  private dayTripOk(dep: string): boolean {
    const ctx = this.ctx();
    const hub = this.state.hub();
    const code = this.destCode();
    const after = homeAfterUtc(null, outboundsOn(hub, code, dep, ctx), ctx.connect);
    return waysHome(code, hub, dep, ctx, after).length > 0;
  }

  setField(f: CalField): void {
    if (f === 'ret' && !this.sel().dep) return;
    this.tapPeek.set(null);
    this.sel.update(s => ({ ...s, active: f }));
  }

  /** [All flights | Nonstop only]: one fixed label per option, the pressed one is what the counts include. */
  protected readonly connOptions = computed<SegOption[]>(() => [
    { value: 'all', label: t('planner.conn.all') },
    { value: 'nonstop', label: t('planner.conn.nonstopOnly') },
  ]);
  protected setConnections(v: string | undefined): void {
    this.state.setShowConnections(v === 'all');
  }

  /**
   * A tap on a day (cell, List row, stay chip or Go). A day with flights in
   * the direction counted is picked; any other day keeps the selection and
   * the footer says why, with the next flying day to go to.
   */
  pick(key: string): void {
    this.tapPeek.set(null);
    const ctx = this.ctx();
    const code = this.destCode();
    const hub = this.state.hub();
    if (ctx.loading || !code || key < ctx.today) return;
    const s = this.sel();
    if (isOutside(key, ctx.coverage)) {
      this.focusKey.set(key);
      this.tapPeek.set(blockedPeek(key, s.dep && s.active === 'ret' ? 'home' : 'out', null, ctx.today, ctx.coverage));
      return;
    }
    const last = ctx.coverage?.to ?? null;
    const step2 = s.active === 'ret' && !!s.dep;
    if (!step2 || key < s.dep!) {
      // Picking (or changing) the departure.
      const outs = (k: string) => outboundsOn(hub, code, k, ctx).length;
      if (!outs(key)) {
        this.focusKey.set(key);
        this.tapPeek.set(blockedPeek(key, 'out', nextDayWith(key, outs, last), ctx.today, ctx.coverage));
        return;
      }
      this.commit(nextSelection(s, key));
      this.afterDep(key);
      return;
    }
    const after = this.afterUtc();
    const homes = (k: string) => waysHome(code, hub, k, ctx, after).length;
    if (key === s.dep) {
      if (homes(key)) this.commit(nextSelection(s, key, true));
      else {
        this.focusKey.set(key);
        this.tapPeek.set({ text: t('planner.picker.noSameDay') });
      }
      return;
    }
    if (!homes(key)) {
      this.focusKey.set(key);
      this.tapPeek.set(blockedPeek(key, 'home', nextDayWith(key, homes, last), ctx.today, ctx.coverage));
      return;
    }
    this.commit(nextSelection(s, key));
  }

  /** The footer's Go: pick the suggested day and bring it into view. */
  protected go(key: string): void {
    this.pick(key);
    this.focusKey.set(key);
    this.focusDay(key, 3);
  }

  /** The seasonal Jump: show the first flying day without picking it. */
  protected jump(key: string): void {
    this.focusKey.set(key);
    this.scrollToMonth(monthOf(key), 3);
    this.focusDay(key, 3);
  }

  private commit(next: { dep: string | null; ret: string | null; active: CalField }): void {
    this.sel.set(next);
    if (next.ret) this.focusKey.set(next.ret);
    else if (next.dep) this.focusKey.set(next.dep);
    void this.router.navigate([], {
      queryParams: { dep: next.dep, ret: next.ret },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  /** After a departure tap: focus the first day with a way home, or say there is none. */
  private afterDep(dep: string): void {
    const ctx = this.ctx();
    const code = this.destCode();
    const hub = this.state.hub();
    const after = this.afterUtc();
    const first = nextDayWith(dep, k => waysHome(code, hub, k, ctx, after).length, ctx.coverage?.to ?? null);
    if (!first) {
      this.tapPeek.set({ text: t('planner.picker.noHomeAfter', { date: dayLabel(dep, ctx.today) }) });
      return;
    }
    if (this.sel().ret) return;
    this.focusKey.set(first);
    this.focusDay(first, 3);
  }

  clear(): void {
    if (!this.sel().dep) return;
    this.sel.set({ dep: null, ret: null, active: 'dep' });
    this.focusKey.set(this.firstFlight() ?? this.firstPickable());
    this.tapPeek.set({ text: t('planner.picker.cleared') });
    void this.router.navigate([], {
      queryParams: { dep: null, ret: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  /** See flights: /plan/CODE?dep&ret[&out&back], and the app's week moves to the departure. */
  done(): void {
    const { dep, ret } = this.sel();
    const d = this.dest();
    if (!dep || !d || this.loading()) return;
    this.state.jumpTo(dep);
    const queryParams = {
      ...this.state.globalParams(),
      ...planParams({ dep, ret, out: this.out() ?? null, back: ret ? this.back() ?? null : null }),
    };
    void this.router.navigate(planPath(d.code), { queryParams });
  }

  cancel(): void {
    const d = this.dest();
    this.state.goBack(d ? destPath(d.code) : ['/']);
  }

  /** Grid keyboard: arrows / PageUp / PageDown / Home / End move the focus; Enter and Space click (native). */
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const key = target?.getAttribute?.('data-key');
    if (!key) return;
    const moved = moveKey(key, e.key);
    if (!moved) return;
    e.preventDefault();
    e.stopPropagation();
    const months = this.months();
    const min = `${months[0]}-01`;
    const lastYm = months[months.length - 1];
    const max = `${lastYm}-${String(monthKeys(lastYm).length).padStart(2, '0')}`;
    const next = clampKey(moved, min, max);
    this.focusKey.set(next);
    this.focusDay(next, 3);
  }

  /** Scroll a month's heading under the sticky banner once it is rendered (deferred months take a tick). */
  private scrollToMonth(ym: string, tries: number): void {
    if (this.destroyed) return;
    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>(`#m-${ym}, #l-${ym}`);
      if (!el) {
        if (tries > 0) setTimeout(() => this.scrollToMonth(ym, tries - 1));
        return;
      }
      el.scrollIntoView?.({ block: 'start' });
    }, { injector: this.injector });
  }

  /**
   * Focus a day once it is rendered. A deferred month renders a tick after
   * renderUpTo reaches it, so a missing button is retried a few times.
   */
  private focusDay(key: string, tries: number): void {
    if (this.destroyed) return;
    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${key}"], [data-list-key="${key}"]`);
      if (!el) {
        if (tries > 0) setTimeout(() => this.focusDay(key, tries - 1));
        return;
      }
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest' });
    }, { injector: this.injector });
  }
}
