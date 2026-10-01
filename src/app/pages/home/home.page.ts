import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Explore page: stub from F1 so the router compiles. Owned by the H workstream,
 * which replaces this file.
 */
@Component({
  selector: 'app-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page">
      <h1 class="ui-h1" style="margin-top: 24px">Explore</h1>
    </div>
  `,
})
export class HomePage {}
