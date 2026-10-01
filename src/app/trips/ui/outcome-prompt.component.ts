import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { OutcomePrompt } from '../engine/today';

/**
 * "How did it go?" card, owner S5.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-outcome-prompt',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class OutcomePromptComponent {
  readonly prompt = input.required<OutcomePrompt>();
}
