import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip, TripLeg } from '../../trips/model';

/**
 * Leg sheet: up to 3 of the leg's files plus "Add a file" (extras spec §2.2).
 * Phase 0 placeholder (owner: SA): renders nothing and never throws.
 */
@Component({
  selector: 'app-leg-files',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class LegFilesComponent {
  readonly trip = input.required<Trip>();
  readonly leg = input.required<TripLeg>();
}
