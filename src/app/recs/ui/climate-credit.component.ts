import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { t } from '../../i18n/t';
import { ClimateService } from '../climate.service';

/**
 * Settings "Weather credits" (extras spec §5.6): the Open-Meteo CC BY 4.0 and
 * Copernicus ERA5 attribution for the typical-weather normals. Styled like
 * "Data credits" next to it. The forecast credit always shows.
 * It never triggers the climate download itself.
 */
@Component({
  selector: 'app-climate-credit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="grp credits">
        <summary class="row"><span class="nm">{{ t('recs.credit.title') }}</span><span class="chev" aria-hidden="true">›</span></summary>
        <p class="cr" data-forecast-credit>
          <b>{{ t('recs.credit.forecast') }}</b>&ngsp;<a href="https://open-meteo.com/" target="_blank" rel="noopener">{{ om }}</a> {{ t('recs.credit.forecastApi') }}, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener license">{{ ccBy }}</a>. {{ t('recs.credit.forecastNote') }}
        </p>
        @if (typical()) {
        <p class="cr">
          <b>{{ t('recs.credit.typical') }}</b>&ngsp;<a href="https://open-meteo.com/" target="_blank" rel="noopener">{{ om }}</a> {{ t('recs.credit.typicalData') }}, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener license">{{ ccBy }}</a>. {{ t('recs.credit.typicalNote') }}
        </p>
        }
      </details>
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; width: 100%; min-height: 24px; }
    .nm { font-size: 15px; font-weight: 600; }
    .chev { color: var(--ink-3); font-size: 18px; transition: transform var(--dur-fast) var(--ease-out); }
    .credits summary { list-style: none; }
    .credits summary::-webkit-details-marker { display: none; }
    .credits[open] .chev { transform: rotate(90deg); }
    .cr { margin: 0; font-size: 12.5px; color: var(--ink-2); }
    .cr b { color: var(--ink); font-weight: 650; margin-right: 4px; }
    .cr a { color: var(--blue); overflow-wrap: anywhere; }
  `],
})
export class ClimateCreditComponent {
  protected readonly t = t;
  protected readonly om = 'Open-Meteo.com';
  protected readonly ccBy = 'CC BY 4.0';
  private readonly climate = inject(ClimateService);
  /** The forecast credit is always due; the typical-weather one follows its file. */
  readonly typical = computed(() => this.climate.status() !== 'missing');
}
