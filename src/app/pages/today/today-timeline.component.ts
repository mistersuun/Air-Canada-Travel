import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AppStateService } from '../../state/app-state.service';
import { PrefsService } from '../../state/prefs.service';
import { TripsService } from '../../trips/trips.service';
import { markPast, travelTimeline } from './timeline-model';

/**
 * Vertical timeline of the travel day under the Today hero: each
 * flight's departure and arrival, layovers, the onward ride and the final
 * row. Rows already behind the clock are dimmed. Reads the saved trip only.
 */
@Component({
  selector: 'app-today-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <section class="ui-card tl" aria-labelledby="tl-h" data-timeline>
        <h2 class="ui-label" id="tl-h">Your day</h2>
        <ol class="tl__list">
          @for (r of rows(); track r.id) {
            <li class="tl__row" [class.tl__row--past]="r.past" [class.tl__row--alert]="r.alert" [attr.data-kind]="r.kind" [attr.data-past]="r.past ? '' : null">
              <span class="tl__time tn">{{ r.time }}</span>
              <span class="tl__dot" aria-hidden="true"></span>
              <span class="tl__ct">
                <b>{{ r.title }}</b>
                @if (r.detail) { <small class="tn">{{ r.detail }}</small> }
                @if (r.past) { <span class="ui-visually-hidden">Done</span> }
              </span>
            </li>
          }
        </ol>
      </section>
    }
  `,
  styles: [`
    .tl { margin-top: 14px; padding: 14px 16px 8px; }
    .tl h2 { margin: 0 0 6px; }
    .tl__list { list-style: none; margin: 0; padding: 0; }
    .tl__row { display: grid; grid-template-columns: 64px 12px 1fr; gap: 0 10px; position: relative; padding-bottom: 14px; }
    .tl__row::before { content: ''; position: absolute; left: 79px; top: 14px; bottom: -2px; width: 2px; background: var(--hair); }
    .tl__row:last-child::before { display: none; }
    .tl__time { text-align: right; font-size: 14px; font-weight: 650; color: var(--ink); padding-top: 1px; }
    .tl__dot { width: 12px; height: 12px; border-radius: 50%; margin-top: 3px; background: var(--ink); position: relative; z-index: 1; box-sizing: border-box; }
    .tl__row[data-kind='layover'] .tl__dot, .tl__row[data-kind='ground'] .tl__dot {
      background: var(--fill); border: 2px solid var(--ink-2);
    }
    .tl__row--alert .tl__dot { border-color: var(--amber); }
    .tl__ct { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .tl__ct b { font-size: 14.5px; font-weight: 600; overflow-wrap: anywhere; }
    .tl__ct small { font-size: 12.5px; color: var(--ink-2); }
    .tl__row--alert .tl__ct small { color: var(--amber-ink); }
    .tl__row--past { opacity: .5; }
  `],
})
export class TodayTimelineComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly prefs = inject(PrefsService);

  readonly tripId = input.required<string>();
  readonly legId = input.required<string>();

  /** The rows (no clock): recomputed only when the trip, time format or connection minimum change. */
  private readonly base = computed(() => {
    const trip = this.trips.trips().find(t => t.id === this.tripId());
    const leg = trip?.legs.find(l => l.id === this.legId());
    if (!trip || !leg) return [];
    return travelTimeline({ trip, leg, fmt: this.prefs.timeFormat(), minConnect: this.state.connect().minConnect });
  });

  protected readonly rows = computed(() => markPast(this.base(), this.state.nowMs()));
}
