import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Phase 0 placeholder page (owner: SP). */
@Component({
  selector: 'app-pass-view-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page" data-placeholder>
      <h1 class="ui-h2">Boarding pass</h1>
    </div>
  `,
})
export class PassViewPage {
  readonly id = input.required<string>();
  readonly passId = input.required<string>();
}
