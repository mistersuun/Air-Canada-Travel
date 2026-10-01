import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import type { Coverage } from '../../data/schedule-index';
import { NO_OPTS, type ConnectOptions } from '../../utils/connections';
import { addMonths } from '../../utils/time';
import { IconComponent } from '../../components/shared/icons.component';
import { availMonth, monthRange, type AvailMonth } from './dest-model';

const WEEK_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * Month availability for hub → destination (the old modal's Calendar tab,
 * restyled like the calendar page): teal bars sized by nonstop departures,
 * amber for connection-only days, past and unpublished days dimmed. Tapping
 * a day emits (pick) so the app moves to that week and day. Prev/next are
 * bounded by today's month and the coverage end.
 */
@Component({
  selector: 'app-month-availability',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-sec-h head">
      <h2 class="ui-h3">Availability</h2>
      <div class="nav">
        <button type="button" class="ui-circ ui-circ--glass sm" aria-label="Previous month" [disabled]="!canPrev()"
                (click)="start.set(prev())"><app-icon name="chevron-left" [size]="16" /></button>
        <button type="button" class="ui-circ ui-circ--glass sm" aria-label="Next month" [disabled]="!canNext()"
                (click)="start.set(next())"><app-icon name="chevron-right" [size]="16" /></button>
      </div>
    </div>
    <div class="months" [style.--n]="shown().length">
      @for (m of shown(); track m.ym) {
        <div class="month" role="group" [attr.aria-label]="m.title">
          <div class="mh">
            <span class="mt" [class.dim]="m.unpublished">{{ m.title }}</span>
            @if (m.unpublished) { <span class="ui-sub small">Not yet published</span> }
          </div>
          <div class="grid" aria-hidden="true">
            @for (w of weekdays; track $index) { <span class="wd">{{ w }}</span> }
          </div>
          <div class="grid">
            @for (b of blanks(m); track $index) { <span></span> }
            @for (c of m.cells; track c.dateKey) {
              <button type="button" class="d tn" [class.off]="c.off" [class.today]="c.dateKey === todayKey()"
                      [class.sel]="c.dateKey === selectedDateKey()" [disabled]="c.off"
                      [attr.aria-label]="c.label" [attr.aria-pressed]="c.dateKey === selectedDateKey()"
                      [attr.data-date]="c.dateKey" (click)="pick.emit(c.dateKey)">
                {{ c.day }}
                <span class="bar" [class.bar--c]="c.connect">
                  @if (c.fill) { <i [style.width.%]="c.fill"></i> }
                </span>
              </button>
            }
          </div>
        </div>
      }
    </div>
    <ul class="legend">
      <li><span class="sw"><i style="width: 100%"></i></span>More nonstop departures</li>
      <li><span class="sw"><i style="width: 34%"></i></span>One</li>
      @if (showConnections()) { <li><span class="sw sw--c"></span>Connection only</li> }
    </ul>
  `,
  styles: [`
    :host { display: block; }
    .head { align-items: center; }
    .nav { display: flex; gap: 6px; }
    .sm { width: 32px; height: 32px; }
    .months { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 28px; }
    .mh { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .mt { font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
    .mt.dim { color: var(--ink-3); }
    .small { font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); row-gap: 2px; text-align: center; }
    .wd { font-size: 11px; font-weight: 600; color: var(--ink-3); padding: 4px 0; }
    .d {
      position: relative; isolation: isolate; height: 40px; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 4px; font-size: 13.5px; font-weight: 550; color: var(--ink); border-radius: 12px;
    }
    .d:hover:not(:disabled) { background: var(--fill); }
    .d.off { color: var(--ink-3); cursor: default; }
    .d.today { color: var(--blue); font-weight: 650; }
    .d.sel { color: #FFFFFF; }
    .d.sel::before { content: ''; position: absolute; inset: 2px 4px; border-radius: 12px; background: var(--red-fill); z-index: -1; }
    .bar { width: 16px; height: 3px; border-radius: 2px; background: var(--hair); overflow: hidden; position: relative; }
    .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--teal); border-radius: 2px; }
    .bar--c { width: 6px; background: var(--amber); }
    .d.off .bar { visibility: hidden; }
    .d.sel .bar { background: rgba(255, 255, 255, .35); }
    .d.sel .bar i { background: #FFFFFF; }
    .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font-size: 12px; color: var(--ink-2); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 18px; height: 3px; border-radius: 2px; background: var(--hair); position: relative; overflow: hidden; }
    .sw i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--teal); }
    .sw--c { width: 6px; background: var(--amber); }
  `],
})
export class MonthAvailabilityComponent {
  readonly hub = input.required<string>();
  readonly dest = input.required<string>();
  readonly todayKey = input.required<string>();
  readonly coverage = input<Coverage | null>(null);
  readonly selectedDateKey = input<string | null>(null);
  readonly showConnections = input(false);
  readonly connect = input<ConnectOptions>(NO_OPTS);
  /** Months side by side (3 on desktop, 1 on mobile). */
  readonly months = input(1);

  readonly pick = output<string>();

  protected readonly weekdays = WEEK_INITIALS;
  private readonly range = computed(() => monthRange(this.todayKey(), this.coverage()));

  /** First month shown: the selected day's month when in range, else today's. */
  readonly start = linkedSignal(() => {
    const { first, last } = this.range();
    const sel = this.selectedDateKey()?.slice(0, 7);
    const want = sel && sel >= first && sel <= last ? sel : first;
    // Keep the whole run inside the range when possible.
    const maxStart = addMonths(last, 1 - this.months());
    return want > maxStart && maxStart >= first ? maxStart : want;
  });

  protected readonly shown = computed<AvailMonth[]>(() => {
    const hub = this.hub();
    const dest = this.dest();
    const today = this.todayKey();
    const conn = this.showConnections();
    const opts = this.connect();
    const { last } = this.range();
    const out: AvailMonth[] = [];
    for (let i = 0, ym = this.start(); i < this.months() && ym <= last; i++, ym = addMonths(ym, 1)) {
      out.push(availMonth(hub, dest, ym, today, conn, opts));
    }
    return out;
  });

  protected readonly prev = computed(() => addMonths(this.start(), -1));
  protected readonly next = computed(() => addMonths(this.start(), 1));
  protected readonly canPrev = computed(() => this.prev() >= this.range().first);
  protected readonly canNext = computed(() => addMonths(this.start(), this.months()) <= this.range().last);

  protected blanks(m: AvailMonth): number[] {
    return Array.from({ length: m.lead }, (_, i) => i);
  }
}
