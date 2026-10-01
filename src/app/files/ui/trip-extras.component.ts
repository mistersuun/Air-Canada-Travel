import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip } from '../../trips/model';

/**
 * Trip detail chips: passes and files counts (extras spec §2.2).
 * Phase 0 placeholder (owner: SA): renders nothing and never throws.
 */
@Component({
  selector: 'app-trip-extras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class TripExtrasComponent {
  readonly trip = input.required<Trip>();
}
