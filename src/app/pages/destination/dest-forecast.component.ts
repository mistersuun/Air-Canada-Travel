import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { FORECAST_SOURCE_URL } from '../../recs/ui/forecast-line.component';
import { NOW } from '../../state/app-state.service';
import { airportTz } from '../../utils/airports';
import { addDays, formatKey, todayKey } from '../../utils/time';
import { forecastOn, weatherText, withinForecast, type DayForecast } from '../../recs/forecast';
import { ForecastService } from '../../recs/forecast.service';

/** Days in the strip. */
export const STRIP_DAYS = 5;

/**
 * Destination page: a 5-day forecast strip starting at the day shown, when
 * that day is within the 16 days the forecast covers. Labelled "Forecast",
 * apart from the typical-climate block above it. Hidden when there is no data.
 */
@Component({
  selector: 'app-dest-forecast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (days(); as ds) {
      <div class="fc" data-forecast-strip>
        <p class="fc__t"><b>Forecast</b> · next {{ ds.length }} days from {{ label(ds[0]) }}</p>
        <ol class="fc__s" aria-label="Forecast, daily high and low">
          @for (d of ds; track d.dateKey) {
            <li class="d">
              <span class="d__n">{{ label(d) }}</span>
              <span class="d__hi tn">{{ d.hiC }}°</span>
              <span class="d__lo tn">{{ d.loC }}°</span>
              <span class="d__w">{{ text(d) }}</span>
            </li>
          }
        </ol>
        <p class="fc__c ui-sub">Forecast · <a [href]="source" target="_blank" rel="noopener">Open-Meteo.com</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener license">CC BY 4.0</a>. A forecast for these dates, not typical weather.</p>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .fc { display: grid; gap: 8px; margin-top: 12px; }
    .fc__t { margin: 0; font-size: 13.5px; color: var(--ink-2); }
    .fc__t b { color: var(--ink); font-weight: 650; }
    .fc__s { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
    .d { display: grid; justify-items: center; gap: 2px; padding: 8px 2px; border-radius: 10px; background: var(--fill); text-align: center; font-size: 11px; color: var(--ink-2); }
    .d__n { font-size: 11px; color: var(--ink-3); }
    .d__hi { font-size: 15px; font-weight: 650; color: var(--ink); }
    .d__w { overflow-wrap: anywhere; }
    .fc__c { margin: 0; font-size: 11.5px; }
    .fc__c a { color: var(--blue); }
  `],
})
export class DestForecastComponent {
  private readonly forecast = inject(ForecastService);
  private readonly now = inject(NOW);

  readonly code = input.required<string>();
  /** The day the strip starts at (a date key). */
  readonly dateKey = input.required<string>();
  protected readonly source = FORECAST_SOURCE_URL;

  private readonly inRange = computed(() => withinForecast(this.dateKey(), todayKey(airportTz(this.code()), this.now())));

  protected readonly days = computed<DayForecast[] | null>(() => {
    if (!this.inRange()) return null;
    const all = this.forecast.days()[this.code()];
    const out: DayForecast[] = [];
    for (let i = 0; i < STRIP_DAYS; i++) {
      const d = forecastOn(all, addDays(this.dateKey(), i));
      if (d) out.push(d);
    }
    return out.length ? out : null;
  });

  constructor() {
    effect(() => {
      if (this.inRange()) { const c = this.code(); untracked(() => void this.forecast.ensure(c)); }
    });
  }

  protected label(d: DayForecast): string {
    return formatKey(d.dateKey, { weekday: 'short', day: 'numeric' });
  }

  protected text(d: DayForecast): string {
    return weatherText(d.code, d.precipPct);
  }
}
