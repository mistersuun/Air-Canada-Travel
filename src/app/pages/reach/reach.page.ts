import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Reach a place AC does not fly to (/reach/:place), owner S2.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-reach-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ui-page"><h1 class="ui-h1">Ways to reach</h1></div>`,
})
export class ReachPage {
  readonly place = input<string>('');
}
