import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, signal } from '@angular/core';
import { HeaderComponent } from './components/header/header.component';
import { WeekStripComponent } from './components/week-strip/week-strip.component';
import { RouteListComponent } from './components/route-list/route-list.component';
import { FlightModalComponent } from './components/flight-modal/flight-modal.component';
import { SettingsComponent } from './components/settings/settings.component';
import { ToastComponent } from './components/toast/toast.component';
import { AppStateService } from './state/app-state.service';
import { PrefsService } from './state/prefs.service';
import { PwaUpdateService } from './state/pwa-update.service';

/** @deprecated Import RouteEntry from './utils/routes' (re-exported here until WS5/WS6 land). */
export type { RouteEntry } from './utils/routes';

/**
 * App shell: a thin template over AppStateService (view state, URL sync,
 * computed routes), PrefsService (persisted settings, theme, favourites) and
 * PwaUpdateService (new-deploy toast). This component is the only place the
 * children are wired together; the binding contract is documented per child.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, WeekStripComponent, RouteListComponent, FlightModalComponent, SettingsComponent, ToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
  template: `
    <a class="skip-link" href="#main">Skip to destinations</a>

    <div class="ui-sticky-shell">
      <app-header
        [hubCode]="state.hub()"
        [query]="state.query()"
        [sort]="state.sort()"
        [filters]="state.filters()"
        [region]="state.region()"
        [showConnections]="state.showConnections()"
        [selectedDateKey]="state.selectedDateKey()"
        [theme]="prefs.theme()"
        [favourites]="state.favourites()"
        [starredThisWeek]="state.starredThisWeek()"
        [activeFilterCount]="state.activeFilterCount()"
        [routeCount]="state.routes().length"
        (hubCodeChange)="state.setHub($event)"
        (queryChange)="state.setQuery($event)"
        (sortChange)="state.setSort($event)"
        (filtersChange)="state.setFilters($event)"
        (regionChange)="state.setRegion($event)"
        (showConnectionsChange)="state.setShowConnections($event)"
        (themeChange)="prefs.setTheme($event)"
        (openSettings)="settingsOpen.set(true)"
        (openDestination)="state.openDestinationByCode($event)"
        (clearFilters)="state.clearFilters()"
      />
      <app-week-strip
        [weekStartKey]="state.weekStartKey()"
        [selectedDateKey]="state.selectedDateKey()"
        [todayKey]="state.todayKey()"
        [coverage]="state.coverage()"
        [routeCount]="state.routes().length"
        (prev)="state.prevWeek()"
        (next)="state.nextWeek()"
        (selectDay)="state.selectDay($event)"
        (jumpTo)="state.jumpTo($event)"
      />
    </div>

    <main id="main" tabindex="-1" class="app-main">
      <app-route-list
        [entries]="state.routes()"
        [coverage]="state.coverage()"
        [stats]="state.stats()"
        [favourites]="state.favourites()"
        [timeFormat]="prefs.timeFormat()"
        [weekStartKey]="state.weekStartKey()"
        [selectedDateKey]="state.selectedDateKey()"
        [todayKey]="state.todayKey()"
        [hubCode]="state.hub()"
        [hubName]="state.hubName()"
        [showConnections]="state.showConnections()"
        [hasActiveFilters]="state.hasActiveFilters()"
        (open)="state.openDestinationByCode($event)"
        (toggleFavourite)="prefs.toggleFavourite($event)"
        (clearFilters)="state.clearFilters()"
        (jumpToCoverage)="state.jumpToCoverage($event)"
      />
    </main>

    @if (state.openDestination(); as dest) {
      <app-flight-modal
        [destination]="dest"
        [entry]="state.openEntry()"
        [hubCode]="state.hub()"
        [hubName]="state.hubName()"
        [weekStartKey]="state.weekStartKey()"
        [selectedDateKey]="state.selectedDateKey()"
        [todayKey]="state.todayKey()"
        [coverage]="state.coverage()"
        [showConnections]="state.showConnections()"
        [connect]="state.connect()"
        [timeFormat]="prefs.timeFormat()"
        [isFavourite]="state.favourites().includes(dest.code)"
        (closed)="state.closeDestination()"
        (selectDate)="state.jumpTo($event)"
        (share)="share()"
        (toggleFavourite)="prefs.toggleFavourite(dest.code)"
      />
    }

    @if (settingsOpen()) {
      <app-settings (closed)="settingsOpen.set(false)" />
    }

    @if (toast(); as t) {
      <app-toast
        [message]="t.message"
        [actionLabel]="t.actionLabel"
        (action)="t.onAction()"
        (dismiss)="t.onDismiss()"
      />
    }
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--ink);
    }
    .app-main { display: block; outline: none; padding-bottom: env(safe-area-inset-bottom); }
    .skip-link {
      position: absolute;
      left: var(--space-2);
      top: var(--space-2);
      z-index: 60;
      padding: var(--space-2) var(--space-3);
      border-radius: 10px;
      background: var(--ink);
      color: var(--bg);
      font-weight: 600;
      transform: translateY(-200%);
    }
    .skip-link:focus { transform: none; }
  `],
})
export class AppComponent {
  protected readonly state = inject(AppStateService);
  protected readonly prefs = inject(PrefsService);
  protected readonly pwa = inject(PwaUpdateService);
  private readonly doc = inject(DOCUMENT);

  readonly settingsOpen = signal(false);
  /** Transient message (e.g. "Link copied"); the update toast takes priority. */
  readonly notice = signal<string | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly toast = computed(() => {
    if (this.pwa.ready()) {
      return {
        message: 'New schedules available',
        actionLabel: 'Reload' as string | null,
        onAction: () => this.pwa.reload(),
        onDismiss: () => this.pwa.dismiss(),
      };
    }
    const msg = this.notice();
    return msg
      ? { message: msg, actionLabel: null, onAction: () => undefined, onDismiss: () => this.notice.set(null) }
      : null;
  });

  onVisibilityChange(): void {
    if (this.doc.visibilityState !== 'visible') return;
    this.state.refreshToday();
    this.pwa.check();
  }

  /** Share the current URL (it carries hub, week, day and the open destination). */
  async share(): Promise<void> {
    const nav = this.doc.defaultView?.navigator;
    const url = this.doc.defaultView?.location.href ?? '';
    const dest = this.state.openDestination();
    const title = dest ? `${this.state.hub()} → ${dest.code} · ${dest.city}` : 'Air Canada Trips';
    if (nav?.share) {
      try {
        await nav.share({ title, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return; // user cancelled
      }
    }
    try {
      if (!nav?.clipboard) throw new Error('no clipboard');
      await nav.clipboard.writeText(url);
      this.flash('Link copied');
    } catch {
      this.flash('Could not copy the link');
    }
  }

  private flash(message: string): void {
    this.notice.set(message);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), 2500);
  }
}
