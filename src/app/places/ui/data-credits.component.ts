import { ChangeDetectionStrategy, Component } from '@angular/core';
import { t } from '../../i18n/t';
import { routeNetworkCredit } from '../../data/route-network';
import { formatKey, isDateKey } from '../../utils/time';

/**
 * Settings "Data credits": where city search, schedules and the route list
 * come from, with the GeoNames CC BY 4.0 and Wikipedia CC BY-SA 4.0
 * attributions those files require. Styled like
 * the Settings "Photo credits" group next to it.
 */
@Component({
  selector: 'app-data-credits',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="grp credits">
      <summary class="row"><span class="nm">{{ t('places.credit.title') }}</span><span class="chev" aria-hidden="true">›</span></summary>
      <ul class="cr">
        <li>
          <b>{{ t('places.credit.city') }}</b>&ngsp;<a href="https://www.geonames.org/" target="_blank" rel="noopener">{{ geonames }}</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener license">{{ ccBy }}</a>, {{ t('places.credit.cityTail') }}
        </li>
        <li>
          <b>{{ t('places.credit.schedules') }}</b>&ngsp;<a href="https://vacations.aircanada.com/en/plan-your-trip/travel-info/where-we-fly" target="_blank" rel="noopener">{{ whereWeFly }}</a> {{ t('places.credit.schedulesTail') }}
        </li>
        <li data-route-list>
          <b>{{ t('places.credit.routes') }}</b>&ngsp;<a href="https://en.wikipedia.org/" target="_blank" rel="noopener">{{ wikipedia }}</a> {{ t('places.credit.routesA') }}, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">{{ ccBySa }}</a>, {{ t('places.credit.routesB') }} <a href="https://ourairports.com/" target="_blank" rel="noopener">{{ ourAirports }}</a> {{ t('places.credit.routesC') }}@if (routeListChecked) {&ngsp;{{ t('places.credit.checked', { date: routeListChecked }) }}}
        </li>
        <li data-hotels-credit>
          <b>{{ t('places.credit.hotels') }}</b>&ngsp;{{ t('places.credit.hotelsA') }} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">{{ osm }}</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener license">{{ odbl }}</a>. {{ t('places.credit.hotelsB') }}
        </li>
        <li>
          <b>{{ t('places.credit.onward') }}</b>&ngsp;{{ t('places.credit.onwardText') }}
        </li>
      </ul>
    </details>
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; width: 100%; min-height: 24px; }
    .nm { font-size: 15px; font-weight: 600; }
    .chev { color: var(--ink-3); font-size: 18px; transition: transform var(--dur-fast) var(--ease-out); }
    .credits summary { list-style: none; }
    .credits summary::-webkit-details-marker { display: none; }
    .credits[open] .chev { transform: rotate(90deg); }
    .cr { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
    .cr b { color: var(--ink); font-weight: 650; margin-right: 4px; }
    .cr a { color: var(--blue); overflow-wrap: anywhere; }
  `],
})
export class DataCreditsComponent {
  protected readonly t = t;
  protected readonly geonames = 'GeoNames (geonames.org)';   // i18n-ignore
  protected readonly ccBy = 'CC BY 4.0';
  protected readonly ccBySa = 'CC BY-SA 4.0';
  protected readonly odbl = 'ODbL 1.0';
  protected readonly wikipedia = 'Wikipedia';
  protected readonly ourAirports = 'OurAirports';
  protected readonly whereWeFly = "Air Canada Vacations 'Where We Fly'";   // i18n-ignore
  protected readonly osm = 'OpenStreetMap contributors';   // i18n-ignore
  /** 'Oct 1, 2026': when the route list was last built (null when it is not loaded). */
  protected readonly routeListChecked = checkedLabel(routeNetworkCredit().builtAt);
}

function checkedLabel(builtAt: string | null): string | null {
  const key = builtAt?.slice(0, 10);
  return key && isDateKey(key) ? formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}
