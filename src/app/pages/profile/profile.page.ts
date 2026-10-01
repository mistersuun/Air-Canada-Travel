import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Phase 0 placeholder page (owner: SR). */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page" data-placeholder>
      <h1 class="ui-h2">Travel profile</h1>
    </div>
  `,
})
export class ProfilePage {}
