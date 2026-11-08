import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { t } from '../../i18n/t';
import type { Coverage } from '../../data/schedule-index';
import { NO_OPTS, type ConnectOptions } from '../../utils/connections';
import { daySignals, signalText } from '../../trips/engine/busy-signals';
import { weekdayLetters } from '../../utils/time';
import {
  barWidth, dayAria, monthDays, monthTitle, monthWeeks, weekdayCounts, weekdayLine, withWays, type CalDay, type CalField,
} from './cal-model';

/**
 * One month of the range picker (`.cal` in the mockup): a 7-column grid of
 * 48px day cells, each with an availability bar (teal, filled at three
 * departures; a short amber bar for connection-only days). The departure and
 * return are red rounded squares joined by a tinted range.
 *
 * Availability is computed here, so months rendered lazily (@defer) cost
 * nothing until they scroll into view. The page owns keyboard handling and
 * the roving tabindex (`focusKey`).
 */
@Component({
  selector: 'app-cal-month',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="ui-h3 mh" [class.mh--dim]="unpublished()" [id]="'m-' + ym()">{{ title() }}</h2>
    @if (unpublished()) { <p class="ms">{{ t('dest.avail.notYet') }}</p> }
    @else if (weekdayText(); as wl) { <p class="ms tn">{{ wl }}</p> }
    <div class="wkh wkh--own" aria-hidden="true">
      @for (w of weekdays(); track $index) { <span>{{ w }}</span> }
    </div>
    <div class="cal" role="grid" [attr.aria-labelledby]="'m-' + ym()" [class.cal--dim]="unpublished()">
      @for (row of weeks(); track $index) {
        <div class="r" role="row">
          @for (d of row; track $index) {
            @if (d) {
              <button type="button" role="gridcell" class="d"
                      [class.off]="d.past || d.outside" [class.today]="d.key === today()"
                      [class.s]="d.key === dep()" [class.e]="d.key === ret()" [class.solo]="d.key === dep() && !ret()"
                      [class.mid]="inRange(d.key)" [class.zero]="d.ways?.total === 0"
                      [attr.title]="signals(d.key).text || null"
                      [attr.data-key]="d.key" [attr.tabindex]="d.key === focusKey() ? 0 : -1"
                      [attr.aria-selected]="d.key === dep() || d.key === ret()"
                      [attr.aria-disabled]="d.past || d.outside || null"
                      [attr.aria-label]="aria(d)"
                      (click)="tap(d)">
                <span class="n tn">{{ d.day }}</span>
                @if (signals(d.key); as sg) {
                  @if (sg.holiday) { <i class="mk mk--h" aria-hidden="true"></i> }
                  @if (sg.brk) { <i class="mk mk--b" aria-hidden="true"></i> }
                }
                @if (d.ways && !d.past && !d.outside) { <span class="w tn" aria-hidden="true">{{ d.ways.total }}</span> }
                @if (!d.past && !d.outside) {
                  <span class="bar">
                    @if (d.direct) { <i [style.width.%]="bar(d.direct)"></i> }
                    @else if (d.connect) { <i class="cn"></i> }
                  </span>
                }
              </button>
            } @else {
              <span class="pad" role="gridcell"></span>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mh { padding: 0 6px 6px; font-size: 17px; }
    .mh--dim { color: var(--ink-3); }
    .ms { font-size: 12.5px; color: var(--ink-3); padding: 0 6px 6px; margin-top: -4px; }
    .wkh--own {
      display: none; grid-template-columns: repeat(7, 1fr); text-align: center;
      font-size: 11px; font-weight: 600; color: var(--ink-3); padding: 6px 0 8px;
    }
    .cal { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: 4px; text-align: center; }
    .cal--dim { opacity: .5; }
    .r { display: contents; }
    .d {
      height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
      font-size: 15px; font-weight: 550; position: relative; isolation: isolate; color: var(--ink); width: 100%;
    }
    .d:focus-visible { outline-offset: -2px; border-radius: 14px; }
    .d:not(.off):hover .n { color: var(--red); }
    .d.off { color: var(--ink-3); cursor: default; }
    .d.today { color: var(--blue); }
    .bar { width: 18px; height: 3px; border-radius: 2px; background: var(--hair); overflow: hidden; position: relative; }
    .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--teal); border-radius: 2px; }
    .bar i.cn { width: 6px; background: var(--amber); }
    .d.zero .n, .d.zero .w { opacity: .45; }
    .w { font-size: 10.5px; font-weight: 600; color: var(--ink-2); line-height: 1; margin-bottom: -2px; }
    .d.zero .w { color: var(--ink-3); }
    .d.s .w, .d.e .w { color: #FFFFFF; }
    .d:has(.w) { gap: 2px; }
    /* Neutral date markers: a filled dot for a holiday, a ring for a school break. */
    .mk { position: absolute; top: 6px; width: 5px; height: 5px; border-radius: 50%; box-sizing: border-box; }
    .mk--h { right: 10px; background: var(--ink-2); }
    .mk--b { right: 18px; border: 1.5px solid var(--ink-2); }
    .d.s .mk--h, .d.e .mk--h { background: #FFFFFF; }
    .d.s .mk--b, .d.e .mk--b { border-color: #FFFFFF; }
    .d.mid { background: color-mix(in srgb, var(--red) 10%, transparent); }
    .d.s, .d.e { color: #FFFFFF; }
    .d.s:hover .n, .d.e:hover .n { color: #FFFFFF; }
    .d.s::before, .d.e::before {
      content: ''; position: absolute; inset: 2px 4px; border-radius: 14px; background: var(--red-fill); z-index: -1;
    }
    .d.s { background: linear-gradient(90deg, transparent 50%, color-mix(in srgb, var(--red) 10%, transparent) 50%); }
    .d.e { background: linear-gradient(90deg, color-mix(in srgb, var(--red) 10%, transparent) 50%, transparent 50%); }
    .d.s.solo { background: none; }
    .d.s .bar, .d.e .bar { background: rgba(255, 255, 255, .35); }
    .d.s .bar i, .d.e .bar i { background: #FFFFFF; }
    @media (min-width: 720px) {
      .wkh--own { display: grid; }
    }
  `],
})
export class CalMonthComponent {
  readonly ym = input.required<string>();
  readonly from = input.required<string>();
  readonly to = input.required<string>();
  readonly today = input.required<string>();
  readonly coverage = input<Coverage | null>(null);
  readonly withConnections = input(false);
  readonly connect = input<ConnectOptions>(NO_OPTS);
  /** The hub, for holidays and school breaks (its province). */
  readonly hub = input<string>('');
  readonly dep = input<string | null>(null);
  readonly ret = input<string | null>(null);
  readonly field = input<CalField>('dep');
  readonly focusKey = input<string | null>(null);

  readonly pick = output<string>();

  protected readonly t = t;
  protected readonly weekdays = computed(() => weekdayLetters());
  protected readonly bar = barWidth;

  readonly days = computed<CalDay[]>(() => {
    const days = monthDays(this.from(), this.to(), this.ym(), this.today(), this.coverage(), this.withConnections(), this.connect());
    const dep = this.dep();
    // The return field runs dest → hub: from is the destination, to the hub.
    return this.field() === 'ret' && dep
      ? withWays(days, dep, this.from(), this.to(), this.today(), this.coverage(), this.withConnections(), this.connect())
      : days;
  });
  protected readonly weekdayText = computed(() =>
    weekdayLine(weekdayCounts(this.from(), this.to(), this.ym(), this.today(), this.coverage()), this.ym()));
  private readonly signalCache = computed(() => {
    this.hub();
    return new Map<string, { holiday: boolean; brk: boolean; text: string }>();
  });
  protected readonly weeks = computed(() => monthWeeks(this.ym(), this.days()));
  protected readonly title = computed(() => monthTitle(this.ym()));
  /** Every remaining day is beyond the published window. */
  readonly unpublished = computed(() => {
    const live = this.days().filter(d => !d.past);
    return live.length > 0 && live.every(d => d.outside);
  });

  protected inRange(key: string): boolean {
    const dep = this.dep();
    const ret = this.ret();
    return !!dep && !!ret && key > dep && key < ret;
  }

  protected aria(d: CalDay): string {
    const sg = this.signals(d.key);
    return sg.text ? `${dayAria(d, this.field())}, ${sg.text}` : dayAria(d, this.field());
  }

  /** Holiday / school-break markers and their text for one day (empty when none). */
  protected signals(key: string): { holiday: boolean; brk: boolean; text: string } {
    const cache = this.signalCache();
    let hit = cache.get(key);
    if (!hit) {
      const hub = this.hub();
      const s = hub ? daySignals(hub, key) : { holidays: [], schoolBreak: null };
      hit = { holiday: s.holidays.length > 0, brk: !!s.schoolBreak, text: hub ? signalText(hub, s).join('; ') : '' };
      cache.set(key, hit);
    }
    return hit;
  }

  protected tap(d: CalDay): void {
    if (d.past || d.outside) return;
    this.pick.emit(d.key);
  }
}
