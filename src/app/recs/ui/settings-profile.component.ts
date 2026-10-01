import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Settings: "Travel profile" row (extras spec §2.2).
 * Phase 0 placeholder (owner: SR): renders nothing and never throws.
 */
@Component({
  selector: 'app-settings-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class SettingsProfileComponent {}
