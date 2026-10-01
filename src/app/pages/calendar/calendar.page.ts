import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Calendar page: stub from F1 so the router compiles. Owned by the SC workstream,
 * which replaces this file.
 */
@Component({
  selector: 'app-calendar-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare">
      <h1 class="ui-h1" style="margin-top: 24px">Calendar</h1>
      <p class="ui-sub">{{ code() }}</p>
    </div>
  `,
})
export class CalendarPage {
  readonly code = input<string>();
}
