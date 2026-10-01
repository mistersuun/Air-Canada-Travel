import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Saved page: stub from F1 so the router compiles. Owned by the SC workstream,
 * which replaces this file.
 */
@Component({
  selector: 'app-saved-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page">
      <h1 class="ui-h1" style="margin-top: 24px">Saved</h1>
    </div>
  `,
})
export class SavedPage {}
