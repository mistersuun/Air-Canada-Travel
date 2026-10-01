import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Explore: "For you" (extras spec §6.3).
 * Phase 0 placeholder (owner: SR): renders nothing and never throws.
 */
@Component({
  selector: 'app-for-you',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class ForYouComponent {}
