import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Settings "Standby history" counts, owner S5.
 * Phase 0 placeholder (Trips v2 spec §6.1): the owning workstream replaces it.
 */
@Component({
  selector: 'app-settings-history',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class SettingsHistoryComponent {
}
