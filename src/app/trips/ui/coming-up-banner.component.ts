import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { tripPath } from '../../ui/links';
import { TripsService } from '../trips.service';
import { comingUp } from '../engine/coming-up';
import { emptyFlightLog } from '../model';

/**
 * One line for the next trip leaving within a week: "Seville in 4 days · List
 * AC834 · 1 schedule change", linking to the trip. Nothing when none.
 *
 *   <app-coming-up-banner />
 */
@Component({
  selector: 'app-coming-up-banner',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-on]': '!!item()' },
  template: `
    @if (item(); as c) {
      <a class="cu ui-glass" [routerLink]="path(c.tripId)" data-coming-up>
        <span class="cu__txt tn">{{ c.text }}</span>
        <app-icon class="cu__chev" name="chevron-right" [size]="18" />
      </a>
    }
  `,
  styles: [`
    :host { display: none; }
    :host(.is-on) { display: block; margin-bottom: 16px; }
    .cu {
      display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 10px 14px;
      border-radius: var(--radius-card); color: var(--ink); box-shadow: var(--shadow);
    }
    .cu:active { transform: scale(.99); }
    .cu__txt { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; }
    .cu__chev { flex: none; color: var(--ink-3); }
  `],
})
export class ComingUpBannerComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);

  protected readonly item = computed(() => comingUp(this.trips.trips(), emptyFlightLog(), this.state.nowMs()));
  protected path(id: string): string[] { return tripPath(id); }
}
