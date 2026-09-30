import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { findReturnOptions, NO_OPTS, type ConnectOptions, type Itinerary } from '../../utils/connections';
import type { Coverage } from '../../data/schedule-index';
import { IconComponent } from '../shared/icons.component';
import { ItineraryOptionComponent } from './itinerary-option.component';
import { formatStay, isOutside, itinKey, prettyFlight, shortDay } from './modal-model';

export const NIGHT_PRESETS = [2, 3, 4, 5, 7] as const;
export const MAX_NIGHTS = 30;
const SHOWN = 3;

interface ReturnDay {
  dateKey: string;
  nights: number;
  exact: boolean;
  outside: boolean;
  options: Itinerary[];
  stay: string;
}

/**
 * "Can I get home?": pick a trip length and see the published ways back on
 * that date and a day either side. Nights count from the outbound's local
 * ARRIVAL date (critique 34), so a 22:10 departure landing next morning plus
 * 4 nights returns 4 nights after landing.
 */
@Component({
  selector: 'app-return-panel',
  standalone: true,
  imports: [IconComponent, ItineraryOptionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (outbound(); as out) {
      <div class="basis">
        <span class="ui-label">Outbound</span>
        <p>
          {{ shortDay(out.dateKey) }} · {{ outFlights() }} · lands {{ shortDay(out.arrDateKey) }}
          <span class="ui-muted">· expand another outbound option to change</span>
        </p>
      </div>

      <div class="nights" role="group" aria-label="Nights at destination">
        @for (n of presets; track n) {
          <button type="button" class="ui-pill" [attr.aria-pressed]="nights() === n" (click)="nights.set(n)">
            {{ n }} nights
          </button>
        }
        <div class="stepper" [class.is-active]="isCustom()">
          <button type="button" class="ui-icon-btn" aria-label="One night fewer" [disabled]="nights() <= 1" (click)="step(-1)">
            <app-icon name="chevron-left" [size]="16" />
          </button>
          <output class="stepper__val" aria-live="polite">{{ nights() }}<span> night{{ nights() === 1 ? '' : 's' }}</span></output>
          <button type="button" class="ui-icon-btn" aria-label="One night more" [disabled]="nights() >= maxNights" (click)="step(1)">
            <app-icon name="chevron-right" [size]="16" />
          </button>
        </div>
      </div>

      @for (r of results(); track r.dateKey) {
        <section class="ret" [class.ret--exact]="r.exact" [attr.data-return]="r.dateKey">
          <header class="ret__head">
            <div>
              <div class="ret__date">{{ shortDay(r.dateKey) }}</div>
              <div class="ui-muted ret__sub">{{ r.nights }} night{{ r.nights === 1 ? '' : 's' }}@if (r.stay) { · {{ r.stay }} at destination}</div>
            </div>
            @if (r.exact) { <span class="ui-chip ui-chip--new ui-chip--nodot">Your pick</span> }
          </header>
          @if (r.outside) {
            <p class="ui-muted empty">Schedules not yet published for this date.</p>
          } @else {
            @for (it of visible(r); track key(it)) {
              <app-itinerary-option [itinerary]="it" [expanded]="expandedKey() === key(it)"
                [timeFormat]="timeFormat()" [connect]="connect()" [destName]="destName()"
                [pair]="out" [showAlternatives]="false" (toggle)="toggle(it)" />
            } @empty {
              <p class="ui-muted empty">No published return {{ showConnections() ? '' : 'direct ' }}flights this day.</p>
            }
            @if (r.options.length > visible(r).length) {
              <button type="button" class="more" (click)="openAll(r.dateKey)">Show {{ r.options.length - visible(r).length }} more</button>
            }
          }
        </section>
      }
      @if (noneAtAll()) {
        <p class="none">No published return within that window. Try another trip length.</p>
      }
    } @else {
      <p class="none">No outbound flight this week to plan a return from. Pick a week with flights first.</p>
    }
  `,
  styles: [`
    :host { display: grid; gap: 14px; padding: 4px 12px 8px; }
    .basis p { margin: 4px 0 0; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .nights { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .stepper {
      display: inline-flex; align-items: center; height: 32px; border-radius: var(--radius-chip);
      border: 1px solid var(--line); background: var(--surface);
    }
    .stepper.is-active { border-color: var(--ink); }
    .stepper .ui-icon-btn { width: 32px; height: 30px; border-radius: var(--radius-chip); }
    .stepper .ui-icon-btn:disabled { opacity: .35; cursor: default; }
    .stepper__val { min-width: 64px; text-align: center; font-family: var(--font-code); font-weight: 600; font-size: 13px; }
    .stepper__val span { font-family: var(--font-ui); font-weight: 500; color: var(--ink-3); }
    .ret { display: grid; gap: 8px; padding: 12px; border-radius: var(--radius-card); border: 1px solid transparent; }
    .ret--exact { background: var(--surface-2); border-color: var(--line); }
    .ret__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .ret__date { font-weight: 600; font-size: 15px; }
    .ret__sub { font-size: 12.5px; margin-top: 2px; }
    .empty { margin: 0; font-size: 13px; }
    .none { margin: 8px 0; color: var(--ink-2); font-size: 14px; }
    .more { all: unset; cursor: pointer; justify-self: start; padding: 6px 10px; border-radius: 8px; color: var(--accent-strong); font-size: 13px; font-weight: 600; }
    .more:hover { background: var(--accent-soft); }
  `],
})
export class ReturnPanelComponent {
  readonly outbound = input<Itinerary | null>(null);
  readonly hubCode = input.required<string>();
  readonly destCode = input.required<string>();
  readonly destName = input('');
  readonly connect = input<ConnectOptions>(NO_OPTS);
  readonly showConnections = input(true);
  readonly timeFormat = input<'12h' | '24h'>('24h');
  /** Coverage of the return's origin (the destination's schedules follow the hub PDF). */
  readonly coverage = input<Coverage | null>(null);

  readonly nights = signal(4);
  protected readonly presets = NIGHT_PRESETS;
  protected readonly maxNights = MAX_NIGHTS;
  protected readonly key = itinKey;
  protected readonly shortDay = shortDay;
  protected readonly expandedKey = signal<string | null>(null);
  private readonly allOpen = signal<ReadonlySet<string>>(new Set());

  protected readonly isCustom = computed(() => !(NIGHT_PRESETS as readonly number[]).includes(this.nights()));

  protected readonly outFlights = computed(() =>
    (this.outbound()?.legs ?? []).map(l => (l.estimated ? 'estimated leg' : prettyFlight(l.flightNumber))).join(' + '));

  /** The picked length and a day either side, earliest first. */
  protected readonly results = computed<ReturnDay[]>(() => {
    const out = this.outbound();
    if (!out) return [];
    const n = this.nights();
    const lengths = [n - 1, n, n + 1].filter(x => x >= 1);
    const direct = !this.showConnections();
    return findReturnOptions(this.destCode(), this.hubCode(), out, lengths, this.connect()).map(r => {
      const options = direct ? r.itineraries.filter(i => !i.hubs.length) : r.itineraries;
      const first = options[0];
      return {
        dateKey: r.dateKey,
        nights: r.nights,
        exact: r.nights === n,
        outside: isOutside(r.dateKey, this.coverage()),
        options,
        stay: first ? formatStay(first.departUtc - out.arriveUtc) : '',
      };
    });
  });

  protected readonly noneAtAll = computed(() => this.results().every(r => !r.options.length));

  step(delta: number): void {
    this.nights.update(n => Math.min(MAX_NIGHTS, Math.max(1, n + delta)));
  }

  toggle(it: Itinerary): void {
    const k = itinKey(it);
    this.expandedKey.set(this.expandedKey() === k ? null : k);
  }

  openAll(dateKey: string): void {
    this.allOpen.update(s => new Set([...s, dateKey]));
  }

  protected visible(r: ReturnDay): Itinerary[] {
    return this.allOpen().has(r.dateKey) ? r.options : r.options.slice(0, SHOWN);
  }
}
