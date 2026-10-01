import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Settings: "Weather credits" (extras spec §5.6).
 * Phase 0 placeholder (owner: FR): renders nothing and never throws.
 */
@Component({
  selector: 'app-climate-credit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class ClimateCreditComponent {}
