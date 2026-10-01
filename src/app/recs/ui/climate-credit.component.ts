import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ClimateService } from '../climate.service';

/**
 * Settings "Weather credits" (extras spec §5.6): the Open-Meteo CC BY 4.0 and
 * Copernicus ERA5 attribution for the typical-weather normals. Styled like
 * "Data credits" next to it. Renders nothing when climate.json is missing.
 * It never triggers the climate download itself.
 */
@Component({
  selector: 'app-climate-credit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <details class="grp credits">
        <summary class="row"><span class="nm">Weather credits</span><span class="chev" aria-hidden="true">›</span></summary>
        <p class="cr">
          <b>Typical weather</b>&ngsp;<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> historical weather (ERA5 reanalysis, Copernicus), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener license">CC BY 4.0</a>. Averaged for 2021–2025 from the middle two weeks of each month. Typical, not a forecast.
        </p>
      </details>
    }
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
  private readonly climate = inject(ClimateService);
  readonly show = computed(() => this.climate.status() !== 'missing');
}
