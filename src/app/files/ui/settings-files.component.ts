import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Settings: "Files on this phone" (extras spec §6.2).
 * Phase 0 placeholder (owner: SA): renders nothing and never throws.
 */
@Component({
  selector: 'app-settings-files',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class SettingsFilesComponent {}
