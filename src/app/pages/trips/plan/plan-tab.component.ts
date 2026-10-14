import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { t } from '../../../i18n/t';
import { IconComponent } from '../../../components/shared/icons.component';
import { AppStateService } from '../../../state/app-state.service';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { TripChangesComponent } from '../../../trips/ui/trip-changes.component';
import { isMultiStop, tripStops } from '../../../trips/stops';
import { tripsPath } from '../../../ui/links';
import { legById, returnNotListed } from '../trips-model';
import { LegSheetComponent } from './leg-sheet.component';
import { PartySheetComponent } from './party-sheet.component';
import { TripCardComponent } from './trip-card.component';
import { TripEditComponent } from './trip-edit.component';

/**
 * Plan tab of a trip (mockup g2 inside the trip): open schedule changes
 * first, then the timeline card with every leg tappable. A leg opens the leg
 * sheet, kept in the URL as ?leg=<legId> (replaceUrl) so a reload or a link
 * from Reach ("I found a train") opens the same sheet.
 */
@Component({
  selector: 'app-plan-tab',
  standalone: true,
  imports: [IconComponent, TripChangesComponent, TripCardComponent, LegSheetComponent, PartySheetComponent, TripEditComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pt">
      <div class="pt__bar">
        @if (stopsLine(); as line) { <p class="ui-sub pt__stops tn" data-stops-line>{{ line }}</p> }
        @if (!trips.readOnly()) {
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost pt__edit" data-edit-toggle
                  [attr.aria-pressed]="editing()" (click)="editing.set(!editing())">{{ t(editing() ? 'common.done' : 'trips.plan.edit') }}</button>
        }
      </div>
      @if (editing() && !trips.readOnly()) {
        <app-trip-edit [trip]="trip()" (deleted)="afterDelete()" />
      }
      <app-trip-changes [trip]="trip()" [compact]="true" />
      <app-trip-card [trip]="trip()" mode="button" (legPick)="openLeg($event)" (partyPick)="partyOpen.set(true)" />
      @if (warnReturn()) {
        <p class="note note--amber" data-return-warning>
          <app-icon name="warning" [size]="16" />
          <span>{{ t('trips.page.returnWarn') }}</span>
        </p>
      }
    </div>
    @if (sheetLeg(); as id) {
      <app-leg-sheet [trip]="trip()" [legId]="id" (closed)="closeLeg()" />
    }
    @if (partyOpen()) {
      <app-party-sheet [trip]="trip()" (closed)="partyOpen.set(false)" />
    }
  `,
  styles: [`
    :host { display: block; }
    .pt { display: grid; gap: 12px; }
    .pt__bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pt__stops { margin: 0 2px; min-width: 0; }
    .pt__edit { margin-left: auto; min-height: 44px; }
    .note { display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; font-size: 13px; }
    .note app-icon { flex: none; margin-top: 1px; }
    .note--amber { background: color-mix(in srgb, var(--amber) 12%, transparent); color: var(--amber-ink); }
    .note--amber app-icon { color: var(--amber); }
  `],
})
export class PlanTabComponent {
  protected readonly t = t;
  private readonly router = inject(Router);
  private readonly state = inject(AppStateService);
  protected readonly trips = inject(TripsService);

  readonly trip = input.required<Trip>();
  /** ?leg= from the route: the leg whose sheet is open. */
  readonly leg = input<string | null | undefined>(null);

  protected readonly partyOpen = signal(false);
  protected readonly editing = signal(false);
  /** 'Seville → Lisbon → Porto' for a multi-stop trip. */
  protected readonly stopsLine = computed(() => isMultiStop(this.trip()) ? tripStops(this.trip()).map(s => s.place.name).join(' → ') : null);
  protected readonly warnReturn = computed(() => returnNotListed(this.trip(), this.state.nowMs()));
  /** The open leg, when it belongs to this trip. */
  protected readonly sheetLeg = computed(() => {
    const id = this.leg();
    return id && legById(this.trip(), id) ? id : null;
  });

  protected afterDelete(): void {
    void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams(), replaceUrl: true });
  }

  protected openLeg(legId: string): void {
    void this.router.navigate([], { queryParams: { leg: legId }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }

  protected closeLeg(): void {
    if (!this.leg()) return;
    void this.router.navigate([], { queryParams: { leg: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }
}
