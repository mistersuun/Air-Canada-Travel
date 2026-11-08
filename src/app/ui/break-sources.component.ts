import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { t } from '../i18n/t';
import { breakSources } from '../trips/engine/school-breaks';
import { formatKey } from '../utils/time';

/** "Sources: <board> (reviewed <date>)" with a link to each school-break calendar shown. Renders nothing without breaks. */
@Component({
  selector: 'app-break-sources',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <p class="src" data-break-sources>{{ t('calendar.sources') }}
        @for (s of items(); track s.source; let last = $last) {
          <a class="ui-link" [href]="s.source" target="_blank" rel="noopener">{{ s.board }}</a> ({{ t('calendar.reviewed', { date: s.date }) }})@if (!last) {; }
        }
      </p>
    }
  `,
  styles: [`
    :host { display: block; }
    .src { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-3); }
  `],
})
export class BreakSourcesComponent {
  protected readonly t = t;
  readonly hub = input.required<string>();
  readonly from = input<string>();
  readonly to = input<string>();
  protected readonly items = computed(() =>
    breakSources(this.hub(), this.from(), this.to()).map(s => ({ ...s, date: formatKey(s.reviewed, { month: 'short', day: 'numeric', year: 'numeric' }) })));
}
