import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Trips tab: "Ideas for later" (extras spec §6.3).
 * Phase 0 placeholder (owner: SR): renders nothing and never throws.
 */
@Component({
  selector: 'app-trip-ideas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class TripIdeasComponent {}
