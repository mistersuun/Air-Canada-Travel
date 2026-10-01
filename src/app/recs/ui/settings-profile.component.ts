import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SettingsProfileBodyComponent } from './settings-profile-body.component';

/**
 * Settings: "Travel profile ›" with a one-line summary (extras spec §2.2).
 * Settings ships with the app shell, so the row (and the profile code behind
 * it) loads in its own chunk when the sheet opens; the placeholder keeps the
 * same height.
 */
@Component({
  selector: 'app-settings-profile',
  standalone: true,
  imports: [SettingsProfileBodyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @defer (on idle) {
      <app-settings-profile-body />
    } @placeholder (minimum 0ms) {
      <section class="grp" aria-busy="true"><p class="ui-label">Suggestions</p><span class="nm">Travel profile</span></section>
    }
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); min-height: 108px; align-content: start; }
    .nm { font-size: 15px; font-weight: 600; }
  `],
})
export class SettingsProfileComponent {}
