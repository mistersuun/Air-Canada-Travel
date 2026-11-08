import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { locale } from '../i18n/locale';
import { t } from '../i18n/t';
import { onDayLinks } from './on-the-day';

/** "On the day": plain outbound links to official status pages. Nothing is fetched. */
@Component({
  selector: 'app-on-the-day',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="otd" [attr.aria-label]="t('flight.onDay.title')">
      <h2 class="ui-label">{{ t('flight.onDay.title') }}</h2>
      <ul>
        @for (l of links(); track l.id) {
          <li><a class="ui-link" [href]="l.href" target="_blank" rel="noopener" [attr.data-link]="l.id">{{ t(l.labelKey) }}</a></li>
        }
      </ul>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .otd { margin-top: 18px; padding: 0 4px; }
    .otd h2 { margin: 0 0 4px; }
    ul { list-style: none; margin: 0; padding: 0; }
    a { display: inline-flex; align-items: center; min-height: 44px; font-size: 14px; }
  `],
})
export class OnTheDayComponent {
  protected readonly t = t;
  /** Airports on the trip (hub and destination codes). */
  readonly codes = input.required<readonly string[]>();
  protected readonly links = computed(() => onDayLinks(this.codes(), locale()));
}
