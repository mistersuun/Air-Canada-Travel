import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Trips list (/trips), owner S1.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-trips-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ui-page"><h1 class="ui-h1">Trips</h1></div>`,
})
export class TripsPage {
}
