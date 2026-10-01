import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Today: "Show boarding pass" when this leg has one, else "Add boarding pass" (extras spec §2.2).
 * Phase 0 placeholder (owner: SP): renders nothing and never throws.
 */
@Component({
  selector: 'app-today-pass',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class TodayPassComponent {
  readonly tripId = input.required<string>();
  readonly legId = input.required<string>();
}
