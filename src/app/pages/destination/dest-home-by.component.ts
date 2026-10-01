import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Home-by tries in the destination Returns area, owner S3.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-dest-home-by',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class DestHomeByComponent {
  readonly code = input.required<string>();
}
