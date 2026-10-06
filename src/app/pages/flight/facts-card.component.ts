import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import type { TimeFormat } from '../../state/prefs.service';
import { scheduleFacts } from '../../trips/engine/facts';
import { holidayNote } from '../../trips/engine/holidays';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { factsView } from './flight-model';

/**
 * "This day on this route" (mockup g6): the day's departures, the last one,
 * aircraft and the next day, from the published schedules, plus a neutral
 * holiday note. Facts only: no odds, no easy/risky words. Outside coverage
 * every fact is Unknown.
 */
@Component({
  selector: 'app-facts-card',
  standalone: true,
  imports: [IconComponent, ProvenanceTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-card fc" aria-labelledby="fc-h" data-facts>
      <div class="fc__h">
        <h2 class="ui-label" id="fc-h">This day on this route</h2>
        <app-provenance-tag [value]="view().covered ? 'scheduled' : 'unknown'" />
      </div>
      @if (view().covered) {
        <dl class="ui-ess tn fc__ess">
          @for (t of view().tiles; track t.label) {
            <div><dt>{{ t.label }}</dt><dd>{{ t.value }}</dd></div>
          }
        </dl>
      } @else {
        <p class="fc__unk" data-unknown>Unknown · not published yet</p>
      }
      @if (record(); as r) {
        <p class="fc__rec" data-record>
          <span><b>Your record</b> · {{ r }}</span>
          <app-provenance-tag value="saved" />
        </p>
      }
      @if (view().holiday; as h) {
        <p class="fc__note" data-holiday><app-icon name="calendar" [size]="16" /><span>{{ h }}</span></p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .fc { padding: 16px; display: grid; gap: 12px; }
    .fc__h { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .fc__h h2 { margin: 0; }
    .fc__ess { margin: 0; }
    .fc__ess dt { font-size: 11.5px; color: var(--ink-2); }
    .fc__ess dd { margin: 1px 0 0; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
    .fc__unk { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink-2); }
    .fc__rec { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0; font-size: 13px; line-height: 1.4; color: var(--ink-2); }
    .fc__rec b { color: var(--ink); font-weight: 650; }
    .fc__note {
      display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 11px 12px; border-radius: 14px;
      font-size: 13px; line-height: 1.4;
      background: color-mix(in srgb, var(--amber) 12%, transparent); color: var(--amber-ink);
    }
    .fc__note app-icon { flex: none; margin-top: 1px; color: var(--amber); }
    @media (min-width: 1024px) { .fc { padding: 18px 20px; } }
  `],
})
export class FactsCardComponent {
  readonly origin = input.required<string>();
  readonly dest = input.required<string>();
  readonly dateKey = input.required<string>();
  readonly timeFormat = input<TimeFormat>('24h');
  /** Your own track record line for the shown flight (counts only), or null. */
  readonly record = input<string | null>(null);

  protected readonly view = computed(() =>
    factsView(scheduleFacts(this.origin(), this.dest(), this.dateKey()), holidayNote(this.dateKey()), this.timeFormat()));
}
