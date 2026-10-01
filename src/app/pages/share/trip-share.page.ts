import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Phase 0 placeholder page (owner: SS). */
@Component({
  selector: 'app-trip-share-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page" data-placeholder>
      <h1 class="ui-h2">Share trip</h1>
    </div>
  `,
})
export class TripSharePage {
  readonly id = input.required<string>();
}
