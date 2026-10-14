import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { t } from '../../../i18n/t';
import { IconComponent } from '../../../components/shared/icons.component';
import { triesMeter } from './tries-meter';

/**
 * Tries home as a row of small planes ("N tries home left"). A count, not a
 * warning: neutral ink, amber only at the last one.
 */
@Component({
  selector: 'app-tries-meter',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tm" role="img" [attr.aria-label]="m().label" [class.tm--last]="m().last" data-tries-meter>
      @for (i of idx(); track i) { <app-icon name="plane" [size]="14" [strokeWidth]="2" [filled]="true" /> }
      @if (m().extra) { <b class="tn">+{{ m().extra }}</b> }
      @if (!m().planes) { <b>{{ t('trips.meter.none') }}</b> }
    </span>
  `,
  styles: [`
    :host { display: inline-block; }
    .tm { display: inline-flex; align-items: center; gap: 3px; color: var(--ink-2); min-height: 20px; }
    .tm--last { color: var(--amber-ink, var(--amber)); }
    .tm b { font-size: 12px; font-weight: 650; margin-left: 2px; }
  `],
})
export class TriesMeterComponent {
  protected readonly t = t;
  readonly count = input.required<number>();
  protected readonly m = computed(() => triesMeter(this.count()));
  protected readonly idx = computed(() => Array.from({ length: this.m().planes }, (_, i) => i));
}
