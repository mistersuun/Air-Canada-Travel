import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../../components/shared/icons.component';
import { AppStateService } from '../../../state/app-state.service';
import type { Trip } from '../../../trips/model';
import { TripChangesComponent } from '../../../trips/ui/trip-changes.component';
import { legById, returnNotListed } from '../trips-model';
import { LegSheetComponent } from './leg-sheet.component';
import { PartySheetComponent } from './party-sheet.component';
import { TripCardComponent } from './trip-card.component';

/**
 * Plan tab of a trip (mockup g2 inside the trip): open schedule changes
 * first, then the timeline card with every leg tappable. A leg opens the leg
 * sheet, kept in the URL as ?leg=<legId> (replaceUrl) so a reload or a link
 * from Reach ("I found a train") opens the same sheet.
 */
@Component({
  selector: 'app-plan-tab',
  standalone: true,
  imports: [IconComponent, TripChangesComponent, TripCardComponent, LegSheetComponent, PartySheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pt">
      <app-trip-changes [trip]="trip()" [compact]="true" />
      <app-trip-card [trip]="trip()" mode="button" (legPick)="openLeg($event)" (partyPick)="partyOpen.set(true)" />
      @if (warnReturn()) {
        <p class="note note--amber" data-return-warning>
          <app-icon name="warning" [size]="16" />
          <span>Return leg not listed yet. Listing usually opens a few days before; check your pass rules.</span>
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
    .note { display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; font-size: 13px; }
    .note app-icon { flex: none; margin-top: 1px; }
    .note--amber { background: color-mix(in srgb, var(--amber) 12%, transparent); color: var(--amber-ink); }
    .note--amber app-icon { color: var(--amber); }
  `],
})
export class PlanTabComponent {
  private readonly router = inject(Router);
  private readonly state = inject(AppStateService);

  readonly trip = input.required<Trip>();
  /** ?leg= from the route: the leg whose sheet is open. */
  readonly leg = input<string | null | undefined>(null);

  protected readonly partyOpen = signal(false);
  protected readonly warnReturn = computed(() => returnNotListed(this.trip(), this.state.nowMs()));
  /** The open leg, when it belongs to this trip. */
  protected readonly sheetLeg = computed(() => {
    const id = this.leg();
    return id && legById(this.trip(), id) ? id : null;
  });

  protected openLeg(legId: string): void {
    void this.router.navigate([], { queryParams: { leg: legId }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }

  protected closeLeg(): void {
    if (!this.leg()) return;
    void this.router.navigate([], { queryParams: { leg: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }
}
