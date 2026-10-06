import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { IconComponent } from '../components/shared/icons.component';
import { NavSection, hidesTopNav, navSection } from './nav-model';

interface NavLink {
  section: NavSection;
  label: string;
  path: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { section: 'explore', label: 'Explore', path: '/' },
  { section: 'map', label: 'Map', path: '/map' },
  { section: 'trips', label: 'Trips', path: '/trips' },
  { section: 'calendar', label: 'Calendar', path: '/calendar' },
];

/**
 * Desktop/tablet top nav (≥ 720px): logo, a glass segmented nav, the data
 * freshness line and the settings circle. Not sticky. Hidden on /to/* (the
 * hero carries its own buttons) and overlaid on the full-bleed /map.
 */
@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-hidden]': 'hidden()',
    '[class.is-overlay]': "section() === 'map'",
  },
  template: `
    <nav class="tn-row" aria-label="Main">
      <div class="tn-left">
        <a class="logo" routerLink="/" [queryParams]="state.globalParams()" aria-label="Routes, Explore">
          <span class="logo__sq" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
          </span>
          Routes
        </a>
        <div class="seg ui-glass">
          @for (l of links; track l.section) {
            <a class="seg__a" [class.on]="l.section === section()" [routerLink]="l.path"
               [queryParams]="state.globalParams()" [attr.aria-current]="l.section === section() ? 'page' : null">{{ l.label }}</a>
          }
        </div>
      </div>
      <div class="tn-right">
        @if (state.dataInfo(); as info) {
          @if (info.staleTag !== null) {
            <button type="button" class="ui-tag ui-tag--amber" [attr.title]="info.staleDetail"
                    (click)="state.flash(info.staleDetail)">{{ info.staleTag }}</button>
          } @else {
            <span class="ui-sub tn data">{{ info.updatedLabel }}</span>
          }
        }
        <button type="button" class="ui-circ ui-circ--glass" (click)="state.openSettings()" aria-label="Settings"
                aria-haspopup="dialog">
          <app-icon name="gear" [size]="19" [strokeWidth]="2" />
        </button>
      </div>
    </nav>
  `,
  styles: [`
    :host { display: none; }
    @media (min-width: 720px) {
      :host { display: block; position: relative; z-index: 20; }
      :host(.is-hidden) { display: none; }
      :host(.is-overlay) { position: absolute; top: 0; left: 0; right: 0; pointer-events: none; }
      :host(.is-overlay) .tn-left, :host(.is-overlay) .tn-right { pointer-events: auto; }
    }
    .tn-row {
      max-width: var(--page-max); margin: 0 auto; padding: 28px 24px 0;
      display: flex; justify-content: space-between; align-items: center; gap: 16px;
    }
    .tn-left { display: flex; align-items: center; gap: 28px; min-width: 0; }
    .tn-right { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 17px; letter-spacing: -.01em; color: var(--ink); }
    .logo__sq { width: 30px; height: 30px; border-radius: 9px; background: var(--red); display: grid; place-items: center; flex: none; }
    .seg { display: inline-flex; background: var(--glass); border-radius: 11px; padding: 3px; }
    .seg__a { padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
    .seg__a:hover:not(.on) { color: var(--ink); }
    .seg__a.on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
    .seg__a:focus-visible { outline-offset: 0; }
    .data { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (min-width: 1024px) { .tn-row { padding: 28px 48px 0; } }
    @media (max-width: 899px) { .data { display: none; } }
  `],
})
export class TopNavComponent {
  protected readonly state = inject(AppStateService);
  protected readonly links = NAV_LINKS;
  protected readonly section = computed(() => navSection(this.state.path()));
  protected readonly hidden = computed(() => hidesTopNav(this.state.path()));
}
