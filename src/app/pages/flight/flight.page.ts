import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Flight details page: stub from F1 so the router compiles. Owned by the FL workstream,
 * which replaces this file.
 */
@Component({
  selector: 'app-flight-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare">
      <h1 class="ui-h1" style="margin-top: 24px">Flight details</h1>
      <p class="ui-sub">{{ code() }} · {{ date() }} · {{ flight() }}</p>
    </div>
  `,
})
export class FlightPage {
  readonly code = input.required<string>();
  readonly date = input<string>();
  readonly flight = input<string>();
}
