import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AirportHotelsService, distanceLabel, hotelMapUrl } from '../airport-hotels';
import { stayLinks } from '../stay-links';

/** Hotels listed at most. */
export const STUCK_HOTELS_SHOWN = 5;

/**
 * "Stuck tonight?": nothing else leaves today, so show hotels close to the
 * airport (names, distances, from OpenStreetMap; no prices) and plain search
 * links for tonight. Without the data file only the links show.
 */
@Component({
  selector: 'app-stuck-tonight',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="st ui-card" data-stuck-tonight>
      <h2 class="ui-h3 st__h">Stuck tonight?</h2>
      <p class="st__lead">Nothing else leaves {{ airportName() }} tonight in our schedule data. Hotels near the airport:</p>
      @if (hotels().length) {
        <ul class="st__hotels" data-hotels>
          @for (h of hotels(); track h.name + h.lat) {
            <li>
              <a class="ui-link" [href]="mapUrl(h)" target="_blank" rel="noopener noreferrer">{{ h.name }}</a>
              <span class="st__d tn">{{ dist(h.distM) }}</span>
            </li>
          }
        </ul>
        <p class="st__foot">Hotel data © <a class="ui-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>,
          <a class="ui-link" [href]="licenseUrl()" target="_blank" rel="noopener noreferrer license">ODbL</a>. Distances are straight-line. No prices or availability.</p>
      }
      <ul class="st__links" data-stay-links>
        @for (l of links(); track l.id) {
          <li><a class="ui-link" [href]="l.href" target="_blank" rel="noopener noreferrer" [attr.data-stay]="l.id">{{ l.label }}</a></li>
        }
      </ul>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .st { margin-top: 22px; padding: 14px; }
    .st__h { margin: 0 0 6px; font-size: 19px; }
    .st__lead { margin: 0 0 8px; font-size: 13.5px; color: var(--ink-2); }
    .st ul { list-style: none; margin: 0; padding: 0; }
    .st__hotels li { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 40px; border-bottom: 1px solid var(--hair); font-size: 14px; }
    .st__d { flex: none; font-size: 12.5px; color: var(--ink-3); }
    .st__links { margin-top: 6px !important; }
    .st__links a { display: flex; align-items: center; min-height: 44px; font-size: 14.5px; }
    .st__foot { margin: 8px 0 0; font-size: 12px; color: var(--ink-3); }
  `],
})
export class StuckTonightComponent {
  private readonly service = inject(AirportHotelsService);
  /** IATA code of the airport the traveller is at. */
  readonly code = input.required<string>();
  readonly airportName = input.required<string>();
  /** Local date of tonight's check-in ('2026-10-09'). */
  readonly checkIn = input.required<string>();

  protected readonly hotels = computed(() => this.service.hotelsNear(this.code()).slice(0, STUCK_HOTELS_SHOWN));
  protected readonly licenseUrl = computed(() => this.service.file()?.licenseUrl ?? 'https://opendatacommons.org/licenses/odbl/1-0/');
  protected readonly links = computed(() => stayLinks({ airportName: this.airportName(), code: this.code(), checkIn: this.checkIn() }));
  protected readonly mapUrl = hotelMapUrl;
  protected readonly dist = distanceLabel;

  constructor() {
    void this.service.ensureLoaded();
  }
}
