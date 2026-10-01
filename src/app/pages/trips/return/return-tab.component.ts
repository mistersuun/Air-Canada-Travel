import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip } from '../../../trips/model';

/**
 * Return tab of a trip (home by, miss-one), owner S3.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-return-tab',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class ReturnTabComponent {
  readonly trip = input.required<Trip>();
}
