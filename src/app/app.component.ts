import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SettingsComponent } from './components/settings/settings.component';
import { ToastComponent } from './components/toast/toast.component';
import { AppStateService } from './state/app-state.service';
import { AppBadgeService } from './state/app-badge.service';
import { PwaUpdateService } from './state/pwa-update.service';
import { OnboardingSheetComponent } from './shell/onboarding-sheet.component';
import { OnboardingService } from './shell/onboarding.service';
import { ShortcutsSheetComponent } from './shell/shortcuts-sheet.component';
import { ShellShortcutsDirective } from './shell/shortcuts';
import { TabBarComponent } from './shell/tab-bar.component';
import { TopNavComponent } from './shell/top-nav.component';
import { TripsService } from './trips/trips.service';
import { hasSkywash, isPassView } from './shell/nav-model';

interface ToastView {
  message: string;
  actionLabel: string | null;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * App shell: top nav (≥ 720px), the routed page, the floating tab bar
 * (< 720px), the settings and shortcuts sheets and the toast. View state
 * lives in AppStateService; this component only wires the chrome.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TopNavComponent, TabBarComponent, SettingsComponent, ShortcutsSheetComponent, ToastComponent, OnboardingSheetComponent],
  hostDirectives: [ShellShortcutsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ui-skywash]': 'skywash()',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
  template: `
    <!-- Handled in code: with <base href="/"> a bare #main resolves to /#main and would leave the page. -->
    <a class="skip-link" href="#main" (click)="skipToMain($event, main)">Skip to content</a>
    @if (state.dataLoad() === 'failed') {
      <div class="data-banner" role="alert">
        <span>Couldn't load flight schedules. Results are empty, not cancelled.</span>
        <button type="button" class="ui-tag ui-tag--amber" (click)="state.retryDataLoad()">Retry</button>
      </div>
    }
    <app-top-nav />
    <main #main id="main" tabindex="-1"><router-outlet /></main>
    <app-tab-bar />

    @if (state.settingsOpen()) {
      <app-settings (closed)="state.closeSettings()" />
    }
    @if (state.shortcutsOpen()) {
      <app-shortcuts-sheet (closed)="state.closeShortcuts()" />
    }
    @if (onboarding.visible()) {
      @defer (when onboarding.visible()) {
        <app-onboarding-sheet (closed)="onboarding.finish()" />
      }
    }
    @if (toast(); as t) {
      <app-toast [message]="t.message" [actionLabel]="t.actionLabel" (action)="t.onAction()" (dismiss)="t.onDismiss()" />
    }
  `,
  styles: [`
    :host { display: block; position: relative; min-height: 100vh; min-height: 100dvh; background-color: var(--bg); color: var(--ink); }
    main { display: block; outline: none; }
    .data-banner {
      display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;
      padding: 10px 16px; font-size: 13.5px; font-weight: 600;
      background: color-mix(in srgb, var(--amber) 15%, var(--bg)); color: var(--amber-ink);
    }
    .data-banner button { font-size: 13px; padding: 5px 12px; }
  `],
})
export class AppComponent {
  protected readonly state = inject(AppStateService);
  protected readonly pwa = inject(PwaUpdateService);
  protected readonly onboarding = inject(OnboardingService);
  private readonly trips = inject(TripsService);
  private readonly doc = inject(DOCUMENT);
  private readonly badge = inject(AppBadgeService);   // keeps the app-icon badge in step

  protected skipToMain(e: Event, main: HTMLElement): void {
    e.preventDefault();
    main.focus();
    main.scrollIntoView?.({ block: 'start' });
  }

  protected readonly skywash = computed(() => hasSkywash(this.state.path()));

  /** The PWA update toast wins over transient notices. */
  protected readonly toast = computed<ToastView | null>(() => {
    if (this.pwa.broken()) {
      return {
        message: 'The app needs to reload to repair itself',
        actionLabel: 'Reload',
        onAction: () => this.pwa.reload(),
        onDismiss: () => this.pwa.dismissBroken(),
      };
    }
    // Never interrupt a boarding pass with a reload prompt; it shows once the user leaves.
    if (this.pwa.ready() && !isPassView(this.state.path())) {
      return {
        message: 'New schedules available',
        actionLabel: 'Reload',
        onAction: () => this.pwa.reload(),
        onDismiss: () => this.pwa.dismiss(),
      };
    }
    const n = this.state.notice();
    if (!n) return null;
    return {
      message: n.message,
      actionLabel: n.actionLabel ?? null,
      onAction: () => n.action?.(),
      onDismiss: () => this.state.dismissNotice(),
    };
  });

  onVisibilityChange(): void {
    if (this.doc.visibilityState !== 'visible') return;
    this.state.refreshToday();
    this.pwa.check();
    this.trips.checkChanges();
  }
}
