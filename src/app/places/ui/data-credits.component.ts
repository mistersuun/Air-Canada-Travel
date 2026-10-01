import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Settings "Data credits": where city search and schedules come from, with
 * the GeoNames CC BY 4.0 attribution the city index requires. Styled like
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
        <li>
          <b>Onward travel</b>&ngsp;Train and bus times come from operators' open timetables where we have them (see Timetable credits), otherwise they are our estimates. Not bookings. Check before you go.
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
export class DataCreditsComponent {}
