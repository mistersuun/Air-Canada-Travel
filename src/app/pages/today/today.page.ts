import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Day of travel (/today), owner S4.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-today-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ui-page"><h1 class="ui-h1">Today</h1></div>`,
})
export class TodayPage {
}
