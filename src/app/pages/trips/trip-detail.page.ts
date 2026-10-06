import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GroundTimetableService } from '../../places/ground-timetable.service';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { tripsPath } from '../../ui/links';
import { TripMenuComponent } from './menu/trip-menu.component';
import { PlanTabComponent } from './plan/plan-tab.component';
import { PrepTabComponent } from './prep/prep-tab.component';
import { ReturnTabComponent } from './return/return-tab.component';
import { tripSubtitle } from './trips-model';
import { TripExtrasComponent } from '../../files/ui/trip-extras.component';

export type TripTab = 'plan' | 'prep' | 'return';
export const TRIP_TABS: SegOption[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'prep', label: 'Prep' },
  { value: 'return', label: 'Return' },
];

/**
 * Trip detail (/trips/:id?tab=plan|prep|return&leg=<legId>): a header with
 * back, the trip name and "Spain and Portugal · 2 travellers", and a share
 * circle that opens the trip menu (offline, share, calendar); then the
 * Plan | Prep | Return seg (?tab=, replaceUrl) and the three tab hosts.
 */
@Component({
  selector: 'app-trip-detail-page',
  standalone: true,
  imports: [RouterLink, IconComponent, SegComponent, PlanTabComponent, PrepTabComponent, ReturnTabComponent, TripMenuComponent, TripExtrasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare td">
      @if (trip(); as t) {
        <header class="td__head">
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <div class="td__title">
            <h1 class="ui-h3">{{ t.name }}</h1>
            <p class="td__sub tn">{{ subtitle() }}</p>
          </div>
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Share and offline" data-menu (click)="menuOpen.set(true)">
            <app-icon name="external" [size]="18" />
          </button>
        </header>
        @if (trips.readOnly()) {
          <p class="ui-sub td__ro">These trips were saved by a newer version of the app. You can look, but changes won't be kept.</p>
        }
        @if (t.sharedFrom) {
          <p class="ui-sub td__ro">A copy of a shared plan. Changes stay on this device.</p>
        }
        <app-trip-extras [trip]="t" />
        <app-seg stretch [options]="tabs" [value]="activeTab()" (valueChange)="setTab($event)" ariaLabel="Trip sections" />
        @switch (activeTab()) {
          @case ('prep') { <app-prep-tab [trip]="t" /> }
          @case ('return') { <app-return-tab [trip]="t" [from]="retFrom() ?? null" /> }
          @default { <app-plan-tab [trip]="t" [leg]="leg()" /> }
        }
        @if (menuOpen()) {
          <app-trip-menu [trip]="t" (closed)="menuOpen.set(false)" (deleted)="afterDelete()" />
        }
      } @else {
        <div class="td__empty" data-empty>
          <h1 class="ui-h2">Trip not found</h1>
          <a class="ui-btn ui-btn--dark" [routerLink]="tripsLink">Open Trips</a>
        </div>
      }
    </div>
  `,
  styles: [`
    .td { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; gap: 14px; }
    .td__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .td__title { min-width: 0; text-align: center; }
    .td__title h1 { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .td__sub { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; }
    .td__empty { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding-top: 12px; }
    .td__ro { text-align: center; font-size: 12.5px; }
    @media (min-width: 720px) {
      .td { padding-top: 24px; }
    }
  `],
})
export class TripDetailPage {
  protected readonly trips = inject(TripsService);
  private readonly router = inject(Router);
  private readonly state = inject(AppStateService);

  constructor() {
    // Timetables for the onward train or bus (Estimated rows until it loads).
    void inject(GroundTimetableService).ensureLoaded();
  }

  readonly id = input<string>('');
  readonly tab = input<string | undefined>(undefined);
  /** ?leg=: opens that leg's sheet on the Plan tab. */
  readonly leg = input<string | undefined>(undefined);
  /** ?retFrom=: the airport the Return tab counts from (defaults to the trip's return airport). ?from= is the global hub. */
  readonly retFrom = input<string | undefined>(undefined);

  protected readonly tabs = TRIP_TABS;
  protected readonly menuOpen = signal(false);
  protected readonly trip = computed(() => this.trips.trips().find(t => t.id === this.id()) ?? null);
  protected readonly subtitle = computed(() => {
    const t = this.trip();
    return t ? tripSubtitle(t) : '';
  });
  protected readonly activeTab = computed<TripTab>(() => {
    const t = this.tab();
    return t === 'prep' || t === 'return' ? t : 'plan';
  });

  protected setTab(value: string | null | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: value === 'plan' ? null : value, leg: null, retFrom: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected readonly tripsLink = tripsPath();

  protected back(): void {
    this.state.goBack(tripsPath());
  }

  protected afterDelete(): void {
    this.menuOpen.set(false);
    void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams(), replaceUrl: true });
  }
}
