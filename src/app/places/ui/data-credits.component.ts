import { ChangeDetectionStrategy, Component } from '@angular/core';
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
      <summary class="row"><span class="nm">Data credits</span><span class="chev" aria-hidden="true">›</span></summary>
      <ul class="cr">
        <li>
          <b>City search</b>&ngsp;<a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames (geonames.org)</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener license">CC BY 4.0</a>, compacted to names, coordinates, population and time zones.
        </li>
        <li>
          <b>Schedules</b>&ngsp;<a href="https://vacations.aircanada.com/en/plan-your-trip/travel-info/where-we-fly" target="_blank" rel="noopener">Air Canada Vacations 'Where We Fly'</a> (published schedules, not seat availability).
        </li>
        <li data-route-list>
          <b>Route list</b>&ngsp;<a href="https://en.wikipedia.org/" target="_blank" rel="noopener">Wikipedia</a> airport articles ("Airlines and destinations", Wikipedia contributors), <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">CC BY-SA 4.0</a>, with airport details from <a href="https://ourairports.com/" target="_blank" rel="noopener">OurAirports</a> (public domain). Says a route is flown, not when; check times on aircanada.com.@if (routeListChecked) {&ngsp;Checked {{ routeListChecked }}.}
        </li>
        <li>
          <b>Onward travel</b>&ngsp;Train and bus times are our estimates from public timetables, not bookings. Check before you go.
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
  /** 'Oct 1, 2026': when the route list was last built (null when it is not loaded). */
  protected readonly routeListChecked = checkedLabel(routeNetworkCredit().builtAt);
}

function checkedLabel(builtAt: string | null): string | null {
  const key = builtAt?.slice(0, 10);
  return key && isDateKey(key) ? formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}
