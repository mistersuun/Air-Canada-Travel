import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * After "I didn't board" (/trips/:id/recover), owner S4.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-recover-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ui-page"><h1 class="ui-h1">Still reachable</h1></div>`,
})
export class RecoverPage {
  readonly id = input<string>('');
}
