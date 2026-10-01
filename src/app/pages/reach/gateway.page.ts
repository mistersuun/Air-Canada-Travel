import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One gateway door to door (/reach/:place/:code), owner S2.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-gateway-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ui-page"><h1 class="ui-h1">Via {{ code() }}</h1></div>`,
})
export class GatewayPage {
  readonly place = input<string>('');
  readonly code = input<string>('');
}
