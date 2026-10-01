import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Phase 0 placeholder page (owner: SP). */
@Component({
  selector: 'app-add-pass-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page" data-placeholder>
      <h1 class="ui-h2">Add boarding pass</h1>
    </div>
  `,
})
export class AddPassPage {
  readonly id = input.required<string>();
}
