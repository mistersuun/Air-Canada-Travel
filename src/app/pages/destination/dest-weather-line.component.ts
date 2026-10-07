import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { ClimateService } from '../../recs/climate.service';
import { MONTH_SHORT, climateFor } from '../../recs/climate';
import { forecastOn, weatherText, withinForecast, type DayForecast } from '../../recs/forecast';
import { ForecastService } from '../../recs/forecast.service';
import { NOW } from '../../state/app-state.service';
import { airportTz } from '../../utils/airports';
import { formatKey, todayKey } from '../../utils/time';
import type { ClimateMonth } from '../../recs/model';

export interface WeatherParts { typical: string | null; forecast: string | null }

/** 'Oct 13° / 7°' (no label); null without normals. Pure. */
export function typicalPart(c: ClimateMonth | null): string | null {
  return c ? `${MONTH_SHORT[c.month - 1]} ${c.tmaxC}° / ${c.tminC}°` : null;
}

/** 'Wed 15° / 9°, rain possible' for the day; null without a forecast. Pure. */
export function forecastPart(d: DayForecast | null, dayLabel: string): string | null {
  return d ? `${dayLabel} ${d.hiC}° / ${d.loC}°, ${weatherText(d.code, d.precipPct)}` : null;
}

/**
 * Destination head card: one quiet line, "Typical Oct 13° / 7° · Forecast Wed 15° / 9°, rain possible".
 * Reuses ClimateService and ForecastService (and their caches); the forecast part shows only
 * when the day is within the 16 days it covers. Renders nothing without data.
 */
@Component({
  selector: 'app-dest-weather-line',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (parts(); as p) {
      <p class="wx ui-sub tn" data-weather-line>
        @if (p.typical) { <span class="wx__i"><b>Typical</b> {{ p.typical }}</span> }
        @if (p.forecast) { <span class="wx__i"><b>Forecast</b> {{ p.forecast }}</span> }
      </p>
    }
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .wx { margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 0 14px; }
    .wx b { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); margin-right: 3px; }
  `],
})
export class DestWeatherLineComponent {
  private readonly climate = inject(ClimateService);
  private readonly forecast = inject(ForecastService);
  private readonly now = inject(NOW);

  readonly code = input.required<string>();
  /** The day the weather is for (a date key). */
  readonly dateKey = input.required<string>();

  private readonly inRange = computed(() => withinForecast(this.dateKey(), todayKey(airportTz(this.code()), this.now())));

  protected readonly parts = computed<WeatherParts | null>(() => {
    const typical = typicalPart(climateFor(this.climate.index(), this.code(), Number(this.dateKey().slice(5, 7))));
    const day = this.inRange() ? forecastOn(this.forecast.days()[this.code()], this.dateKey()) : null;
    const forecast = forecastPart(day, formatKey(this.dateKey(), { weekday: 'short' }));
    return typical || forecast ? { typical, forecast } : null;
  });

  constructor() {
    void this.climate.ensureLoaded();
    effect(() => {
      if (this.inRange()) { const c = this.code(); untracked(() => void this.forecast.ensure(c)); }
    });
  }
}
