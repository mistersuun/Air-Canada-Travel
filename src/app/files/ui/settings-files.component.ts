import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SettingsFilesBodyComponent } from './settings-files-body.component';

/**
 * Settings "Files on this phone" (extras spec §6.2). Settings ships with the
 * app shell, so the section's body (and the files store behind it) loads in
 * its own chunk when the sheet opens; the placeholder keeps the same height.
 */
@Component({
  selector: 'app-settings-files',
  standalone: true,
  imports: [SettingsFilesBodyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @defer (on idle) {
      <app-settings-files-body />
    } @placeholder (minimum 0ms) {
      <section class="grp" aria-busy="true"><p class="ui-label">Files on this phone</p></section>
    }
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); min-height: 96px; }
  `],
})
export class SettingsFilesComponent {}
