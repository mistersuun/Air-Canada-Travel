import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Explore banner for the day of travel, owner S4. Renders nothing until built.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-today-banner',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class TodayBannerComponent {
}
