import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Phase 0 placeholder page (owner: SA). */
@Component({
  selector: 'app-trip-files-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page" data-placeholder>
      <h1 class="ui-h2">Files</h1>
    </div>
  `,
})
export class TripFilesPage {
  readonly id = input.required<string>();
}
