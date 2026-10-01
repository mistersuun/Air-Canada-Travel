import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { profilePath } from '../../extras/links';
import { AppStateService } from '../../state/app-state.service';
import { profileSummary } from '../profile';
import { ProfileService } from '../profile.service';

/**
 * Body of Settings "Travel profile" (loaded in its own chunk; see SettingsProfileComponent).
 * Settings: "Travel profile ›" with a one-line summary ("City, Sun · long
 * weekends · up to 7h · Thu–Mon", or "Not set up"). Tapping closes Settings
 * and opens /profile.
 */
@Component({
  selector: 'app-settings-profile-body',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grp">
      <p class="ui-label">Suggestions</p>
      <button type="button" class="row" data-profile-row (click)="open()">
        <span class="row__tx"><span class="nm">Travel profile</span><span class="hint" data-summary>{{ summary() }}</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; width: 100%; text-align: left; min-height: 44px; color: var(--ink); }
    .row__tx { display: grid; gap: 2px; min-width: 0; }
    .nm { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--ink-2); }
    .chev { color: var(--ink-3); font-size: 18px; }
  `],
})
export class SettingsProfileBodyComponent {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly profile = inject(ProfileService);

  protected readonly summary = computed(() => profileSummary(this.profile.profile()));

  protected open(): void {
    this.state.closeSettings();
    void this.router.navigate(profilePath(), { queryParams: this.state.globalParams() });
  }
}
