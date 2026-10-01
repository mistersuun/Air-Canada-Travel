import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { tripsPath } from '../../ui/links';
import { PlanTabComponent } from './plan/plan-tab.component';
import { PrepTabComponent } from './prep/prep-tab.component';
import { ReturnTabComponent } from './return/return-tab.component';

export type TripTab = 'plan' | 'prep' | 'return';
export const TRIP_TABS: SegOption[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'prep', label: 'Prep' },
  { value: 'return', label: 'Return' },
];

/**
 * Trip detail (/trips/:id?tab=plan|prep|return). Phase 0 shell (Trips v2
 * spec §6.1): header, the Plan | Prep | Return seg and the three tab hosts.
 * S1 owns this page and fills in the header actions and the menu.
 */
@Component({
  selector: 'app-trip-detail-page',
  standalone: true,
  imports: [IconComponent, SegComponent, PlanTabComponent, PrepTabComponent, ReturnTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page td">
      @if (trip(); as t) {
        <header class="td__head">
          <button type="button" class="ui-circ" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <div class="td__title">
            <h1 class="ui-h2">{{ t.name }}</h1>
            <p class="ui-sub">{{ t.goal.country }} · {{ t.party.count }} {{ t.party.count === 1 ? 'traveller' : 'travellers' }}</p>
          </div>
        </header>
        <app-seg stretch [options]="tabs" [value]="activeTab()" (valueChange)="setTab($event)" ariaLabel="Trip sections" />
        @switch (activeTab()) {
          @case ('prep') { <app-prep-tab [trip]="t" /> }
          @case ('return') { <app-return-tab [trip]="t" /> }
          @default { <app-plan-tab [trip]="t" /> }
        }
      }
    </div>
  `,
  styles: [`
    .td { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; gap: 16px; }
    .td__head { display: flex; align-items: center; gap: 12px; }
    .td__title { min-width: 0; }
  `],
})
export class TripDetailPage {
  private readonly trips = inject(TripsService);
  private readonly router = inject(Router);
  private readonly state = inject(AppStateService);

  readonly id = input<string>('');
  readonly tab = input<string | undefined>(undefined);

  protected readonly tabs = TRIP_TABS;
  protected readonly trip = computed(() => this.trips.trips().find(t => t.id === this.id()) ?? null);
  protected readonly activeTab = computed<TripTab>(() => {
    const t = this.tab();
    return t === 'prep' || t === 'return' ? t : 'plan';
  });

  protected setTab(value: string | null | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: value === 'plan' ? null : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected back(): void {
    if (this.state.canGoBack()) history.back();
    else void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams() });
  }
}
