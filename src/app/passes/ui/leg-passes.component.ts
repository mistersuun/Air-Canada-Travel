import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip, TripLeg } from '../../trips/model';

/**
 * Leg sheet: "Show boarding pass" or "Add boarding pass" (extras spec §2.2).
 * Phase 0 placeholder (owner: SP): renders nothing and never throws.
 */
@Component({
  selector: 'app-leg-passes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class LegPassesComponent {
  readonly trip = input.required<Trip>();
  readonly leg = input.required<TripLeg>();
}
