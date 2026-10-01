import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { allItineraries, NO_OPTS, type ConnectOptions, type Itinerary } from '../../utils/connections';
import type { Coverage } from '../../data/schedule-index';
import type { TimeFormat } from '../../state/prefs.service';
import { addDays, diffDays, isDateKey } from '../../utils/time';
import { formatStay, isOutside, itinKey, shortDay } from '../../ui/format';
import { MAX_NIGHTS, NIGHT_PRESETS, optionRow, type OptionRow } from './flight-model';
import { OptionRowComponent } from './option-row.component';

const SHOWN = 4;
/** Minimum turnaround (minutes) when the connection settings give none. */
const DEFAULT_MIN_CONNECT = 60;

interface Nearby {
  nights: number;
  dateKey: string;
  label: string;
  count: number;
}

/**
 * "Return": pick a stay length (2/3/4/5/7 nights or the stepper) or arrive
 * with an explicit ?ret= date from the calendar, and see the published ways
 * home that day. Nights count from the outbound's local ARRIVAL date, so a
 * 22:10 departure landing next morning plus 4 nights returns 4 nights after
 * landing. Tapping a row selects it for the round-trip .ics.
 */
@Component({
  selector: 'app-return-panel',
  standalone: true,
  imports: [OptionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nights" role="group" aria-label="Nights at destination">
      @for (n of presets; track n) {
        <button type="button" class="chip" [attr.aria-pressed]="shownNights() === n" (click)="nightsChange.emit(n)">{{ n }} nights</button>
      }
      <div class="stepper" [class.is-on]="isCustom()">
        <button type="button" aria-label="One night fewer" [disabled]="shownNights() <= 1" (click)="nightsChange.emit(shownNights() - 1)">−</button>
        <output class="tn" aria-live="polite">{{ shownNights() }}<span> night{{ shownNights() === 1 ? '' : 's' }}</span></output>
        <button type="button" aria-label="One night more" [disabled]="shownNights() >= maxNights" (click)="nightsChange.emit(shownNights() + 1)">+</button>
      </div>
    </div>

    <div class="when">
      <div>
        <div class="date tn" [attr.data-return]="retDate()">{{ shortDay(retDate()) }}</div>
        <div class="ui-sub tn">{{ shownNights() }} night{{ shownNights() === 1 ? '' : 's' }}@if (stay()) { · {{ stay() }} at destination}@if (fromCalendar()) { · from the calendar}</div>
      </div>
      <span class="ui-tag ui-tag--blue tn">{{ code() }} → {{ hub() }}</span>
    </div>

    @if (outside()) {
      <p class="empty">Schedules for {{ shortDay(retDate()) }} aren't published yet.</p>
    } @else {
      <div class="list">
        @for (r of visible(); track r.key) {
          <app-option-row [row]="r" [selectable]="true" [selected]="selectedKey() === r.key" (pick)="toggle(r)" />
        } @empty {
          <p class="empty">No published {{ showConnections() ? '' : 'nonstop ' }}return on {{ shortDay(retDate()) }}.</p>
        }
      </div>
      @if (rows().length > visible().length) {
        <button type="button" class="more ui-link" (click)="expand.emit()">Show {{ rows().length - visible().length }} more</button>
      }
      @if (!rows().length && nearby().length) {
        <p class="near">
          Nearby:
          @for (n of nearby(); track n.dateKey) {
            <button type="button" class="ui-link" (click)="nightsChange.emit(n.nights)">{{ n.label }} ({{ n.count }})</button>
          }
        </p>
      }
    }
  `,
  styles: [`
    :host { display: grid; gap: 12px; }
    .nights { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .chip {
      padding: 7px 12px; border-radius: 999px; background: var(--fill); color: var(--ink-2);
      font-size: 13px; font-weight: 600; white-space: nowrap;
    }
    .chip[aria-pressed='true'] { background: var(--ink); color: var(--bg); }
    .stepper { display: inline-flex; align-items: center; border-radius: 999px; background: var(--fill); padding: 2px; }
    .stepper.is-on { background: var(--ink); color: var(--bg); }
    .stepper button { width: 30px; height: 30px; border-radius: 50%; font-size: 16px; font-weight: 600; color: inherit; }
    .stepper button:disabled { opacity: .35; cursor: default; }
    .stepper output { min-width: 62px; text-align: center; font-size: 13px; font-weight: 650; }
    .stepper output span { font-weight: 500; opacity: .7; }
    .when { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 4px; }
    .date { font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
    .when .ui-sub { font-size: 12.5px; margin-top: 2px; }
    .list { margin-top: -4px; }
    .empty { margin: 0; padding: 6px 0 2px; font-size: 13.5px; color: var(--ink-2); }
    .more { justify-self: start; font-size: 13px; }
    .near { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; color: var(--ink-2); }
    .near button { font-size: 13px; }
  `],
})
export class ReturnPanelComponent {
  readonly outbound = input.required<Itinerary>();
  readonly hub = input.required<string>();
  readonly code = input.required<string>();
  readonly nights = input(4);
  /** An explicit return date (?ret=, from the calendar). Wins over nights when on or after the arrival. */
  readonly ret = input<string | null>(null);
  readonly coverage = input<Coverage | null>(null);
  readonly connect = input<ConnectOptions>(NO_OPTS);
  readonly showConnections = input(true);
  readonly timeFormat = input<TimeFormat>('24h');
  readonly selectedKey = input<string | null>(null);
  readonly showAll = input(false);

  readonly nightsChange = output<number>();
  readonly selectedChange = output<Itinerary | null>();
  readonly expand = output<void>();

  protected readonly presets = NIGHT_PRESETS;
  protected readonly maxNights = MAX_NIGHTS;
  protected readonly shortDay = shortDay;

  protected readonly fromCalendar = computed(() => {
    const r = this.ret();
    return !!r && isDateKey(r) && r >= this.outbound().arrDateKey;
  });

  readonly retDate = computed(() =>
    this.fromCalendar() ? this.ret()! : addDays(this.outbound().arrDateKey, this.nights()));

  protected readonly shownNights = computed(() => diffDays(this.outbound().arrDateKey, this.retDate()));
  protected readonly isCustom = computed(() => !(NIGHT_PRESETS as readonly number[]).includes(this.shownNights()));
  protected readonly outside = computed(() => isOutside(this.retDate(), this.coverage()));

  private optionsOn(key: string): Itinerary[] {
    if (isOutside(key, this.coverage())) return [];
    const its = allItineraries(this.code(), this.hub(), key, this.connect());
    return this.showConnections() ? its : its.filter(i => !i.hubs.length);
  }

  /** Returns must leave at least the minimum connection time after the outbound lands. */
  readonly rows = computed<OptionRow[]>(() => {
    const earliest = this.outbound().arriveUtc + (this.connect().minConnect ?? DEFAULT_MIN_CONNECT) * 60_000;
    return this.optionsOn(this.retDate())
      .filter(i => i.departUtc >= earliest)
      .map(i => optionRow(i, this.timeFormat()));
  });

  protected readonly visible = computed(() => (this.showAll() ? this.rows() : this.rows().slice(0, SHOWN)));

  /** Time at the destination: to the picked return, else to the first one listed. */
  protected readonly stay = computed(() => {
    const rows = this.rows();
    const key = this.selectedKey();
    const row = (key && rows.find(r => itinKey(r.it) === key)) || rows[0];
    return row ? formatStay(row.it.departUtc - this.outbound().arriveUtc) : '';
  });

  /** A day either side, when the exact day has nothing. */
  protected readonly nearby = computed<Nearby[]>(() => {
    const n = this.shownNights();
    return [n - 1, n + 1]
      .filter(x => x >= 1 && x <= MAX_NIGHTS)
      .map(x => {
        const dateKey = addDays(this.outbound().arrDateKey, x);
        return { nights: x, dateKey, label: shortDay(dateKey), count: this.optionsOn(dateKey).length };
      })
      .filter(x => x.count > 0);
  });

  protected toggle(r: OptionRow): void {
    this.selectedChange.emit(this.selectedKey() === itinKey(r.it) ? null : r.it);
  }
}
