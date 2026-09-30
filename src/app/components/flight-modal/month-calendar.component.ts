import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import type { Coverage } from '../../data/schedule-index';
import { monthAvailability, type DayAvailability } from '../../utils/routes';
import { NO_OPTS, type ConnectOptions } from '../../utils/connections';
import { WEEKDAY_SHORT, addMonths, monthOf, weekdayIndex } from '../../utils/time';
import { IconComponent } from '../shared/icons.component';
import { longDay } from './modal-model';

type CellKind = 'direct' | 'connect' | 'none' | 'outside';

interface Cell {
  dateKey: string;
  day: number;
  kind: CellKind;
  direct: number;
  label: string;
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
}

/**
 * Month operating calendar (ref 27010431): solid red = direct, orange stripes
 * = connection only, plain = no flights, grey hatch = outside the published
 * window, today ringed. Tapping a day emits selectDate so the whole app moves
 * to that week and day. Prev/next are bounded by the hub's coverage.
 */
@Component({
  selector: 'app-month-calendar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <button type="button" class="ui-icon-btn" aria-label="Previous month" [disabled]="!canPrev()" (click)="month.set(prevMonth())">
        <app-icon name="chevron-left" [size]="18" />
      </button>
      <div class="title">
        <h3 id="cal-title" aria-live="polite">{{ title() }}</h3>
        <p class="ui-muted">{{ summary() }}</p>
      </div>
      <button type="button" class="ui-icon-btn" aria-label="Next month" [disabled]="!canNext()" (click)="month.set(nextMonth())">
        <app-icon name="chevron-right" [size]="18" />
      </button>
    </div>

    <div class="grid" role="group" aria-labelledby="cal-title">
      <div class="row" aria-hidden="true">
        @for (w of weekdays; track w) { <span class="wd">{{ w.slice(0, 1) }}</span> }
      </div>
      @for (week of weeks(); track $index) {
        <div class="row">
          @for (c of week; track $index) {
            @if (c) {
              <button type="button" [class]="'ui-heat ui-heat--' + c.kind"
                      [class.is-today]="c.isToday" [class.is-sel]="c.isSelected" [class.is-past]="c.isPast"
                      [disabled]="c.kind === 'outside'" [attr.aria-label]="c.label" [attr.aria-pressed]="c.isSelected"
                      [attr.data-date]="c.dateKey" (click)="selectDate.emit(c.dateKey)">
                {{ c.day }}@if (c.direct > 1) {<span class="multi" aria-hidden="true">×{{ c.direct }}</span>}
              </button>
            } @else {
              <span aria-hidden="true"></span>
            }
          }
        </div>
      }
    </div>

    <ul class="legend" aria-label="Legend">
      <li><span class="sw ui-heat--direct"></span>Direct</li>
      @if (showConnections()) { <li><span class="sw ui-heat--connect"></span>Connection only</li> }
      <li><span class="sw sw--none"></span>No flights</li>
      <li><span class="sw ui-heat--outside"></span>Not yet published</li>
    </ul>
  `,
  styles: [`
    :host { display: block; padding: 4px 12px 8px; }
    .head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; margin-bottom: 12px; }
    .head .ui-icon-btn:disabled { opacity: .3; cursor: default; background: none; }
    .title { text-align: center; }
    .title h3 { margin: 0; font-size: 17px; font-weight: 600; }
    .title p { margin: 2px 0 0; font-size: 12.5px; }
    .grid { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
    .row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
    .wd { text-align: center; font-size: 11px; font-weight: 600; color: var(--ink-3); letter-spacing: .06em; }
    .ui-heat { position: relative; min-width: 0; width: 100%; max-height: 48px; aspect-ratio: auto; height: 40px;
      transition: transform var(--dur-fast) var(--ease-out); }
    .ui-heat:not(:disabled):hover { transform: scale(1.06); }
    .ui-heat:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .ui-heat--none { background: var(--surface-2); }
    .ui-heat.is-past { opacity: .45; }
    .ui-heat.is-sel { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
    .multi { position: absolute; top: 2px; right: 4px; font-size: 8.5px; opacity: .85; }
    .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 0; padding: 0; font-size: 12px; color: var(--ink-2); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }
    .sw--none { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
    .sw.ui-heat--outside { box-shadow: inset 0 0 0 1px var(--line-strong); }
  `],
})
export class MonthCalendarComponent {
  readonly home = input.required<string>();
  readonly dest = input.required<string>();
  /** A date key in the month to show first (selected day, else the week start). */
  readonly anchorKey = input.required<string>();
  readonly selectedDateKey = input<string | null>(null);
  readonly todayKey = input<string | null>(null);
  readonly coverage = input<Coverage | null>(null);
  readonly connect = input<ConnectOptions>(NO_OPTS);
  readonly showConnections = input(true);

  readonly selectDate = output<string>();

  protected readonly weekdays = WEEKDAY_SHORT;
  /** 'YYYY-MM' currently shown. */
  readonly month = linkedSignal(() => monthOf(this.anchorKey()));

  protected readonly prevMonth = computed(() => addMonths(this.month(), -1));
  protected readonly nextMonth = computed(() => addMonths(this.month(), 1));
  protected readonly canPrev = computed(() => {
    const from = this.coverage()?.from;
    return !from || this.prevMonth() >= monthOf(from);
  });
  protected readonly canNext = computed(() => {
    const to = this.coverage()?.to;
    return !to || this.nextMonth() <= monthOf(to);
  });

  protected readonly title = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  });

  private readonly data = computed<DayAvailability[]>(() =>
    monthAvailability(this.home(), this.dest(), this.month(), this.connect()));

  private readonly cells = computed<Cell[]>(() => {
    const today = this.todayKey();
    const sel = this.selectedDateKey();
    const conn = this.showConnections();
    const cov = this.coverage();
    return this.data().map(a => {
      // The hub-level window from the shell wins when it is narrower.
      const outside = !a.covered || (!!cov?.to && a.dateKey > cov.to) || (!!cov?.from && a.dateKey < cov.from);
      const kind: CellKind = outside ? 'outside' : a.direct ? 'direct' : conn && a.connect ? 'connect' : 'none';
      const what = kind === 'outside' ? 'schedules not yet published'
        : kind === 'direct' ? `${a.direct} direct flight${a.direct > 1 ? 's' : ''}`
        : kind === 'connect' ? 'connections only' : 'no flights';
      return {
        dateKey: a.dateKey,
        day: Number(a.dateKey.slice(8)),
        kind,
        direct: a.direct,
        label: `${longDay(a.dateKey)}: ${what}`,
        isToday: a.dateKey === today,
        isSelected: a.dateKey === sel,
        isPast: !!today && a.dateKey < today,
      };
    });
  });

  /** Rows of 7 (Mon-first), padded with nulls. */
  protected readonly weeks = computed<(Cell | null)[][]>(() => {
    const cells = this.cells();
    if (!cells.length) return [];
    const padded: (Cell | null)[] = [...Array(weekdayIndex(cells[0].dateKey)).fill(null), ...cells];
    while (padded.length % 7) padded.push(null);
    const rows: (Cell | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) rows.push(padded.slice(i, i + 7));
    return rows;
  });

  protected readonly summary = computed(() => {
    const cells = this.cells();
    const direct = cells.filter(c => c.kind === 'direct').length;
    const connect = cells.filter(c => c.kind === 'connect').length;
    const outside = cells.filter(c => c.kind === 'outside').length;
    if (outside === cells.length) return 'Not yet published';
    const parts = [`${direct} direct day${direct === 1 ? '' : 's'}`];
    if (this.showConnections()) parts.push(`${connect} connection-only`);
    return parts.join(' · ');
  });
}
