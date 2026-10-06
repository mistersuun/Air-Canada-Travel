import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { NOW } from '../../state/app-state.service';
import { airportTz } from '../../utils/airports';
import { todayKey } from '../../utils/time';
import { forecastOn, forecastText, withinForecast } from '../forecast';
import { ForecastService } from '../forecast.service';

/** Where the forecast comes from, always shown beside it. */
export const FORECAST_SOURCE_URL = 'https://open-meteo.com/';

/**
 * "Forecast · 24° / 17° · rain likely" for a destination and a date, when the
 * date is within the 16 days the forecast covers and the data is there.
 * Renders nothing otherwise (offline, out of range, unknown place). Not the
 * typical climate: that is labelled "Typical" elsewhere.
 */
@Component({
  selector: 'app-forecast-line',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (text(); as t) {
      <span class="fc tn" data-forecast>Forecast · {{ t }} @if (plain()) { · Open-Meteo } @else { <a class="fc__src" [href]="source" target="_blank" rel="noopener" aria-label="Forecast data from Open-Meteo">Open-Meteo</a> }</span>
    }
  `,
  styles: [`
    :host { display: contents; }
    .fc { font-size: 12.5px; color: var(--ink-2); }
    .fc__src { color: var(--ink-3); text-decoration: underline; text-underline-offset: 2px; }
  `],
})
export class ForecastLineComponent {
  private readonly forecast = inject(ForecastService);
  private readonly now = inject(NOW);

  readonly code = input.required<string>();
  readonly dateKey = input.required<string>();
  /** Inside a link (a row that is itself an anchor): the source is text, not a nested link. */
  readonly plain = input(false);
  protected readonly source = FORECAST_SOURCE_URL;

  private readonly inRange = computed(() => withinForecast(this.dateKey(), todayKey(airportTz(this.code()), this.now())));

  protected readonly text = computed(() => {
    if (!this.inRange()) return null;
    const d = forecastOn(this.forecast.days()[this.code()], this.dateKey());
    return d ? forecastText(d) : null;
  });

  constructor() {
    effect(() => {
      if (this.inRange()) { const c = this.code(); untracked(() => void this.forecast.ensure(c)); }
    });
  }
}
