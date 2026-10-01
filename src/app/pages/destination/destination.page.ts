import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Destination page: stub from F1 so the router compiles. Owned by the D workstream,
 * which replaces this file.
 */
@Component({
  selector: 'app-destination-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare">
      <h1 class="ui-h1" style="margin-top: 24px">Destination</h1>
      <p class="ui-sub">{{ code() }}</p>
    </div>
  `,
})
export class DestinationPage {
  readonly code = input.required<string>();
}
