import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip } from '../../../trips/model';

/**
 * Prep tab of a trip (changes, checklist), owner S5.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-prep-tab',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class PrepTabComponent {
  readonly trip = input.required<Trip>();
}
