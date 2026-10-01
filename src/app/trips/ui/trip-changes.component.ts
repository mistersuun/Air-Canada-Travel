import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip } from '../model';

/**
 * Schedule change cards of a trip, owner S5.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-trip-changes',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class TripChangesComponent {
  readonly trip = input.required<Trip>();
  readonly compact = input<boolean>(false);
}
