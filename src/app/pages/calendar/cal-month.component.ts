import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Coverage } from '../../data/schedule-index';
import { NO_OPTS, type ConnectOptions } from '../../utils/connections';
import {
  barWidth, dayAria, monthDays, monthTitle, monthWeeks, type CalDay, type CalField,
} from './cal-model';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

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
    <h3 class="ui-h3 mh" [class.mh--dim]="unpublished()" [id]="'m-' + ym()">{{ title() }}</h3>
    @if (unpublished()) { <p class="ms">Not yet published</p> }
    <div class="wkh wkh--own" aria-hidden="true">
      @for (w of weekdays; track $index) { <span>{{ w }}</span> }
    </div>
    <div class="cal" role="grid" [attr.aria-labelledby]="'m-' + ym()" [class.cal--dim]="unpublished()">
      @for (row of weeks(); track $index) {
        <div class="r" role="row">
          @for (d of row; track $index) {
            @if (d) {
              <button type="button" role="gridcell" class="d"
                      [class.off]="d.past || d.outside" [class.today]="d.key === today()"
                      [class.s]="d.key === dep()" [class.e]="d.key === ret()" [class.solo]="d.key === dep() && !ret()"
                      [class.mid]="inRange(d.key)"
                      [attr.data-key]="d.key" [attr.tabindex]="d.key === focusKey() ? 0 : -1"
                      [attr.aria-selected]="d.key === dep() || d.key === ret()"
                      [attr.aria-disabled]="d.past || d.outside || null"
                      [attr.aria-label]="aria(d)"
                      (click)="tap(d)">
                <span class="n tn">{{ d.day }}</span>
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
    .d.mid { background: color-mix(in srgb, var(--red) 10%, transparent); }
    .d.s, .d.e { color: #FFFFFF; }
    .d.s:hover .n, .d.e:hover .n { color: #FFFFFF; }
    .d.s::before, .d.e::before {
      content: ''; position: absolute; inset: 2px 4px; border-radius: 14px; background: var(--red); z-index: -1;
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
  readonly dep = input<string | null>(null);
  readonly ret = input<string | null>(null);
  readonly field = input<CalField>('dep');
  readonly focusKey = input<string | null>(null);

  readonly pick = output<string>();

  protected readonly weekdays = WEEKDAYS;
  protected readonly bar = barWidth;

  readonly days = computed<CalDay[]>(() =>
    monthDays(this.from(), this.to(), this.ym(), this.today(), this.coverage(), this.withConnections(), this.connect()),
  );
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
    return dayAria(d, this.field());
  }

  protected tap(d: CalDay): void {
    if (d.past || d.outside) return;
    this.pick.emit(d.key);
  }
}
