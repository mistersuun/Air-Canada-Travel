import { ChangeDetectionStrategy, Component, computed, effect, input, linkedSignal, output, signal } from '@angular/core';
import { NO_OPTS, type ConnectOptions, type Itinerary } from '../../utils/connections';
import { ItineraryOptionComponent } from './itinerary-option.component';
import { itinKey, longDay, type OutboundDay } from './modal-model';
import { WEEKDAY_SHORT, formatKey, weekdayIndex } from '../../utils/time';

/** Connections shown per day before "Show N more". */
export const CONNECTIONS_SHOWN = 3;

/**
 * Outbound tab: the selected week, day by day. Each day lists every direct
 * flight and (when connections are on) the ranked one-stop options, top 3
 * first. Days beyond the published window say so instead of "no flights".
 * One option is expanded at a time; the expanded one is the trip the Return
 * tab plans from (emitted as `chosen`).
 */
@Component({
  selector: 'app-outbound-panel',
  standalone: true,
  imports: [ItineraryOptionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (d of days(); track d.dateKey) {
      @let total = d.direct.length + d.connections.length;
      <section class="day" [class.day--sel]="d.isSelected" [class.day--past]="d.isPast"
               [class.day--empty]="!total" [attr.aria-label]="dayLabel(d)" [attr.data-day]="d.dateKey">
        <header class="day__head">
          <button type="button" class="day__date" (click)="selectDate.emit(d.dateKey)"
                  [attr.aria-pressed]="d.isSelected" [attr.aria-label]="'Show ' + dayLabel(d) + ' in the list'">
            <span class="day__dow">{{ dow(d.dateKey) }}</span>
            <span class="day__num">{{ dnum(d.dateKey) }}</span>
          </button>
          <div class="day__sum">
            @if (d.outside) {
              <span class="ui-muted">Schedules not yet published</span>
            } @else if (!total) {
              <span class="ui-muted">{{ showConnections() ? 'No flights' : 'No direct flights' }}</span>
            } @else {
              @if (d.direct.length) {
                <span class="ui-chip ui-chip--ok">{{ d.direct.length }} direct</span>
              }
              @if (d.connections.length) {
                <span class="ui-chip ui-chip--connect">{{ d.connections.length }} via connection</span>
              }
            }
            @if (d.isToday) { <span class="ui-chip ui-chip--new ui-chip--nodot">Today</span> }
          </div>
        </header>

        @if (total) {
          <div class="day__list">
            @for (it of d.direct; track key(it)) {
              <app-itinerary-option [itinerary]="it" [expanded]="expandedKey() === key(it)"
                [timeFormat]="timeFormat()" [connect]="connect()" [destName]="destName()"
                (toggle)="toggle(it)" />
            }
            @for (it of visibleConnections(d); track key(it)) {
              <app-itinerary-option [itinerary]="it" [expanded]="expandedKey() === key(it)"
                [timeFormat]="timeFormat()" [connect]="connect()" [destName]="destName()"
                (toggle)="toggle(it)" />
            }
            @if (hiddenCount(d); as n) {
              <button type="button" class="more" (click)="expandDay(d.dateKey)">
                {{ d.direct.length && !showingConnections(d) ? 'Show ' + n + ' connection' + (n > 1 ? 's' : '') : 'Show ' + n + ' more' }}
              </button>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: grid; gap: 6px; }
    .day { display: grid; gap: 10px; padding: 12px; border-radius: var(--radius-card); animation: enter-up var(--dur) var(--ease-out) both; }
    .day--sel { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
    .day--empty { padding-block: 6px; }
    .day--past { opacity: .6; }
    .day__head { display: flex; align-items: center; gap: 12px; }
    .day__date {
      all: unset; box-sizing: border-box; cursor: pointer; display: grid; justify-items: center;
      width: 44px; min-height: 44px; padding: 4px 0; border-radius: 12px; border: 1px solid var(--line);
      background: var(--surface); transition: border-color var(--dur-fast) var(--ease-out);
    }
    .day__date:hover { border-color: var(--line-strong); }
    .day__date:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .day__date[aria-pressed='true'] { background: var(--ink); border-color: var(--ink); color: var(--bg); }
    .day__date[aria-pressed='true'] .day__dow { color: inherit; opacity: .75; }
    .day__dow { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
    .day__num { font-family: var(--font-code); font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .day__sum { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
    .day__list { display: grid; gap: 8px; }
    .more {
      all: unset; cursor: pointer; justify-self: start; padding: 6px 10px; border-radius: 8px;
      color: var(--accent-strong); font-size: 13px; font-weight: 600;
    }
    .more:hover { background: var(--accent-soft); }
    .more:focus-visible { outline: 2px solid var(--accent); }
  `],
})
export class OutboundPanelComponent {
  readonly days = input.required<OutboundDay[]>();
  readonly showConnections = input(true);
  readonly timeFormat = input<'12h' | '24h'>('24h');
  readonly connect = input<ConnectOptions>(NO_OPTS);
  readonly destName = input('');

  readonly selectDate = output<string>();
  /** The expanded option (the outbound the Return tab plans from), or null. */
  readonly chosen = output<Itinerary | null>();

  protected readonly key = itinKey;
  private readonly openDays = signal<ReadonlySet<string>>(new Set());

  /** Default expansion: the first option on the selected day (else none). */
  protected readonly expandedKey = linkedSignal<string | null>(() => {
    const sel = this.days().find(d => d.isSelected);
    const first = sel?.direct[0] ?? sel?.connections[0];
    return first ? itinKey(first) : null;
  });

  private readonly expandedItin = computed(() => {
    const k = this.expandedKey();
    if (!k) return null;
    for (const d of this.days()) {
      const hit = d.direct.find(i => itinKey(i) === k) ?? d.connections.find(i => itinKey(i) === k);
      if (hit) return hit;
    }
    return null;
  });

  constructor() {
    effect(() => this.chosen.emit(this.expandedItin()));
  }

  toggle(it: Itinerary): void {
    const k = itinKey(it);
    this.expandedKey.set(this.expandedKey() === k ? null : k);
  }

  expandDay(dateKey: string): void {
    this.openDays.update(s => new Set([...s, dateKey]));
  }

  /** Directs are always listed; on direct days connections wait behind a button. */
  protected showingConnections(d: OutboundDay): boolean {
    return this.openDays().has(d.dateKey) || !d.direct.length;
  }

  protected visibleConnections(d: OutboundDay): Itinerary[] {
    if (this.openDays().has(d.dateKey)) return d.connections;
    return d.direct.length ? [] : d.connections.slice(0, CONNECTIONS_SHOWN);
  }

  protected hiddenCount(d: OutboundDay): number {
    return d.connections.length - this.visibleConnections(d).length;
  }

  protected dow(key: string): string {
    return WEEKDAY_SHORT[weekdayIndex(key)];
  }

  protected dnum(key: string): string {
    return formatKey(key, { day: 'numeric' });
  }

  protected dayLabel(d: OutboundDay): string {
    return longDay(d.dateKey);
  }
}
