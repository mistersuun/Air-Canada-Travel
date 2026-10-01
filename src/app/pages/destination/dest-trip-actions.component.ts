import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * "Start a trip to …" / "Add to … trip" on the destination page, owner S2.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-dest-trip-actions',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class DestTripActionsComponent {
  readonly code = input.required<string>();
}
