import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Map page: stub from F1 so the router compiles. Owned by the M workstream,
 * which replaces this file.
 */
@Component({
  selector: 'app-map-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page">
      <h1 class="ui-h1" style="margin-top: 24px">Map</h1>
    </div>
  `,
})
export class MapPage {}
