import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip } from '../../../trips/model';

/**
 * Plan tab of a trip, owner S1.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-plan-tab',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class PlanTabComponent {
  readonly trip = input.required<Trip>();
}
