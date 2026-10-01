import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { PrefsService } from '../../state/prefs.service';
import { TripsService } from '../../trips/trips.service';
import { todayPath } from '../../ui/links';
import { bannerText } from './today-model';

/**
 * Explore banner on the day of travel: a glass card "Today · Montréal →
 * Madrid · AC834 17:55 · Listed" that opens /today. Renders nothing when no
 * trip flight leaves today (or left less than 2h ago).
 *
 *   <app-today-banner />
 */
@Component({
  selector: 'app-today-banner',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-on]': '!!text()' },
  template: `
    @if (text(); as t) {
      <a class="tb ui-glass" [routerLink]="link" data-today-banner>
        <span class="tb__ic" aria-hidden="true"><app-icon name="plane" [size]="18" /></span>
        <span class="tb__txt">
          <b class="tb__title">{{ t.title }}</b>
          <span class="tb__detail tn">{{ t.detail }}</span>
        </span>
        <app-icon class="tb__chev" name="chevron-right" [size]="18" />
      </a>
    }
  `,
  styles: [`
    :host { display: none; }
    :host(.is-on) { display: block; margin-bottom: 16px; }
    .tb {
      display: flex; align-items: center; gap: 12px; min-height: 56px;
      padding: 10px 14px; border-radius: var(--radius-card); color: var(--ink);
      box-shadow: var(--shadow);
    }
    .tb:active { transform: scale(.99); }
    .tb__ic {
      flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
      background: var(--ink); color: var(--bg);
    }
    .tb__ic app-icon { transform: rotate(45deg); }
    .tb__txt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
    .tb__title { font-size: 15px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tb__detail { font-size: 13px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tb__chev { flex: none; color: var(--ink-3); }
    @media (min-width: 720px) {
      :host(.is-on) { margin: 24px 0 -16px; max-width: 600px; }
    }
  `],
})
export class TodayBannerComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly prefs = inject(PrefsService);

  protected readonly link = todayPath();
  protected readonly text = computed(() => bannerText(this.trips.trips(), this.state.nowMs(), this.prefs.timeFormat()));
}
