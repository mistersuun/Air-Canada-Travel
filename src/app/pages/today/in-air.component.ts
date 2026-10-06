import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AppStateService } from '../../state/app-state.service';
import type { FlightRef, LegStatus } from '../../trips/model';
import { RouteMapComponent } from '../../ui/route-map.component';
import { findDestination, findHub } from '../../utils/airports';
import { formatKm } from '../../utils/geo';
import { inAirProgress } from './in-air';

/** The "In the air" card on Today: distance left and a small map, estimated from the schedule. */
@Component({
  selector: 'app-today-in-air',
  standalone: true,
  imports: [RouteMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (air(); as a) {
      <section class="ui-card ia" aria-label="In the air" data-in-air>
        <app-route-map class="ia__map" [hub]="ref().origin" [points]="points()" [highlight]="ref().dest"
                       [progress]="a.progress" [labels]="[ref().origin, ref().dest]" [pulse]="false" />
        <div class="ia__ct">
          <b>In the air · @if (a.kmLeft < 50) { Landing soon } @else { about <span class="tn" data-km>{{ km(a.kmLeft) }}</span> to go }</b>
          <small>Estimated from the schedule</small>
        </div>
      </section>
    }
  `,
  styles: [`
    .ia { margin-top: 14px; overflow: hidden; }
    .ia__map { height: 140px; }
    .ia__ct { padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 2px; }
    .ia__ct b { font-size: 15px; font-weight: 650; }
    .ia__ct small { font-size: 12.5px; color: var(--ink-2); }
  `],
})
export class TodayInAirComponent {
  private readonly state = inject(AppStateService);
  readonly ref = input.required<FlightRef>();
  /**
   * Shown only once the traveller says they boarded: a scheduled departure time
   * alone does not mean they are on the plane (not boarded, dropped, still listed
   * or checked in all mean they are not).
   */
  readonly status = input<LegStatus>('planned');

  protected readonly air = computed(() => (this.status() === 'boarded' ? inAirProgress(this.ref(), this.state.nowMs()) : null));
  protected readonly points = computed(() => {
    const d = findDestination(this.ref().dest) ?? findHub(this.ref().dest);
    return d ? [{ code: d.code, lat: d.lat, lng: d.lng }] : [];
  });
  protected km(n: number): string {
    return formatKm(n);
  }
}
