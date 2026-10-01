import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { IconComponent, IconName } from '../components/shared/icons.component';
import { NavSection, isDetailPath, navSection } from './nav-model';

interface Tab {
  section: NavSection;
  label: string;
  path: string;
  icon: IconName;
}

export const TABS: readonly Tab[] = [
  { section: 'explore', label: 'Explore', path: '/', icon: 'compass' },
  { section: 'map', label: 'Map', path: '/map', icon: 'map' },
  { section: 'saved', label: 'Saved', path: '/saved', icon: 'star' },
];

/**
 * Mobile floating tab bar (< 720px): a glass pill 26px above the bottom.
 * The active tab is an ink pill with its label; the others are icons.
 * Settings opens the sheet. Hidden on /to, /flight and /calendar, which show
 * back buttons instead.
 */
@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-hidden]': 'hidden()' },
  template: `
    <nav class="tb ui-glass" aria-label="Main">
      @for (t of tabs; track t.section) {
        <a class="tb__i" [class.on]="t.section === section()" [routerLink]="t.path" [queryParams]="state.globalParams()"
           [attr.aria-current]="t.section === section() ? 'page' : null"
           [attr.aria-label]="t.section === section() ? null : t.label">
          <app-icon [name]="t.icon" [size]="20" [strokeWidth]="2" />
          @if (t.section === section()) { <span>{{ t.label }}</span> }
        </a>
      }
      <button type="button" class="tb__i" (click)="state.openSettings()" aria-label="Settings" aria-haspopup="dialog">
        <app-icon name="gear" [size]="20" [strokeWidth]="2" />
      </button>
    </nav>
  `,
  styles: [`
    :host {
      position: fixed; z-index: 30; left: 50%; transform: translateX(-50%);
      bottom: calc(26px + env(safe-area-inset-bottom));
    }
    :host(.is-hidden) { display: none; }
    @media (min-width: 720px) { :host { display: none; } }
    .tb {
      height: 62px; border-radius: 31px; padding: 0 8px; gap: 4px;
      display: flex; align-items: center; box-shadow: var(--shadow-l);
    }
    .tb__i {
      height: 48px; min-width: 48px; border-radius: 24px; padding: 0 14px;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      color: var(--ink-2); font-size: 13px; font-weight: 600; white-space: nowrap;
      transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
    }
    .tb__i.on { background: var(--ink); color: var(--bg); }
    .tb__i:focus-visible { outline-offset: -2px; border-radius: 24px; }
  `],
})
export class TabBarComponent {
  protected readonly state = inject(AppStateService);
  protected readonly tabs = TABS;
  protected readonly section = computed(() => navSection(this.state.path()));
  protected readonly hidden = computed(() => isDetailPath(this.state.path()));
}
