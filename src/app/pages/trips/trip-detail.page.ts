import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { t, type MsgKey } from '../../i18n/t';
import { GroundTimetableService } from '../../places/ground-timetable.service';
import { recapPath } from '../../extras/links';
import { returnBoarded } from '../../logbook/logbook';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { tripsPath } from '../../ui/links';
import { GroupCardComponent } from '../../group/ui/group-card.component';
import { TripShareSheetComponent } from './menu/trip-share-sheet.component';
import { TripMenuComponent } from './menu/trip-menu.component';
import { PlanTabComponent } from './plan/plan-tab.component';
import { PrepTabComponent } from './prep/prep-tab.component';
import { ReturnTabComponent } from './return/return-tab.component';
import { tripSubtitle } from './trips-model';
import { TripExtrasComponent } from '../../files/ui/trip-extras.component';

export type TripTab = 'plan' | 'prep' | 'return';
const TRIP_TABS: { value: TripTab; label: MsgKey }[] = [
  { value: 'plan', label: 'trips.tab.plan' },
  { value: 'prep', label: 'trips.tab.prep' },
  { value: 'return', label: 'trips.tab.return' },
];

/**
 * Trip detail (/trips/:id?tab=plan|prep|return&leg=<legId>): a header with
 * back, the trip name and "Spain and Portugal · 2 travellers", a Share
 * circle (the Share sheet) and a "⋯" circle (More: offline, calendar, delete);
 * a "Travelling with friends?" card on the Plan tab; then the
 * Plan | Prep | Return seg (?tab=, replaceUrl) and the three tab hosts.
 */
@Component({
  selector: 'app-trip-detail-page',
  standalone: true,
  imports: [RouterLink, IconComponent, SegComponent, PlanTabComponent, PrepTabComponent, ReturnTabComponent, TripMenuComponent, TripShareSheetComponent, GroupCardComponent, TripExtrasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare td">
      @if (trip(); as tp) {
        <header class="td__head">
          <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('trips.detail.back')" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <div class="td__title">
            <h1 class="ui-h3">{{ tp.name }}</h1>
            <p class="td__sub tn">{{ subtitle() }}</p>
          </div>
          <div class="td__acts">
            <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('trips.detail.share')" data-share-open (click)="openShare(false)">
              <app-icon name="share-box" [size]="18" />
            </button>
            <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('trips.detail.more')" data-menu (click)="menuOpen.set(true)">
              <app-icon name="more" [size]="18" [strokeWidth]="2.6" />
            </button>
          </div>
        </header>
        @if (trips.readOnly()) {
          <p class="ui-sub td__ro">{{ t('trips.detail.newer') }}</p>
        }
        @if (tp.sharedFrom) {
          <p class="ui-sub td__ro">{{ t('trips.detail.copy') }}</p>
        }
        @if (recapReady()) {
          <a class="td__recap" data-recap [routerLink]="recapLink(tp.id)" [queryParams]="state.globalParams()">
            <app-icon name="share" [size]="17" />
            <span><b>{{ t('trips.detail.recap') }}</b><span class="ui-sub">{{ t('trips.detail.recapSub') }}</span></span>
          </a>
        }
        <app-trip-extras [trip]="tp" />
        <app-seg stretch [options]="tabs()" [value]="activeTab()" (valueChange)="setTab($event)" [ariaLabel]="t('trips.detail.sections')" />
        @switch (activeTab()) {
          @case ('prep') { <app-prep-tab [trip]="tp" /> }
          @case ('return') { <app-return-tab [trip]="tp" [from]="retFrom() ?? null" /> }
          @default {
            <app-group-card [trip]="tp" (start)="openShare(true)" />
            <app-plan-tab [trip]="tp" [leg]="leg()" />
          }
        }
        @if (shareOpen()) {
          <app-trip-share-sheet [trip]="tp" [startGroup]="startGroup()" (closed)="shareOpen.set(false)" />
        }
        @if (menuOpen()) {
          <app-trip-menu [trip]="tp" (closed)="menuOpen.set(false)" (deleted)="afterDelete()" />
        }
      } @else {
        <section class="ui-card empty" role="status" data-empty>
          <h1 class="ui-h3">{{ t('trips.detail.notFound') }}</h1>
          <p class="ui-sub">{{ t('trips.detail.notFoundText') }}</p>
          <a class="ui-btn ui-btn--dark ui-btn--sm" [routerLink]="tripsLink" [queryParams]="state.globalParams()">{{ t('trips.detail.backToTrips') }}</a>
        </section>
      }
    </div>
  `,
  styles: [`
    .td { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; gap: 14px; }
    .td__head { display: grid; grid-template-columns: 96px minmax(0, 1fr) 96px; align-items: center; gap: 8px; }
    .td__acts { display: flex; gap: 8px; justify-self: end; }
    .td__title { min-width: 0; text-align: center; }
    .td__title h1 { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .td__sub { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; }
    .td__recap {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; min-height: 44px;
      background: color-mix(in srgb, var(--teal) 12%, transparent); color: var(--ink); text-decoration: none;
    }
    .td__recap app-icon { color: var(--teal); flex: none; }
    .td__recap span { display: grid; gap: 1px; }
    .td__recap b { font-size: 14.5px; font-weight: 650; }
    .td__ro { text-align: center; font-size: 12.5px; }
    @media (min-width: 720px) {
      .td { padding-top: 24px; }
    }
  `],
})
export class TripDetailPage {
  protected readonly t = t;
  protected readonly trips = inject(TripsService);
  private readonly router = inject(Router);
  protected readonly state = inject(AppStateService);

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

  protected readonly tabs = computed<SegOption[]>(() => TRIP_TABS.map(x => ({ value: x.value, label: t(x.label) })));
  protected readonly menuOpen = signal(false);
  protected readonly shareOpen = signal(false);
  /** True when the Share sheet was opened from the "Travelling with friends?" card. */
  protected readonly startGroup = signal(false);
  protected readonly trip = computed(() => this.trips.trips().find(x => x.id === this.id()) ?? null);
  protected readonly subtitle = computed(() => {
    const tr = this.trip();
    return tr ? tripSubtitle(tr) : '';
  });
  protected readonly activeTab = computed<TripTab>(() => {
    const tab = this.tab();
    return tab === 'prep' || tab === 'return' ? tab : 'plan';
  });

  /** True once the way home is boarded: then the trip can be recapped. */
  protected readonly recapReady = computed(() => {
    const tr = this.trip();
    return !!tr && returnBoarded(tr);
  });
  protected recapLink(id: string): string[] {
    return recapPath(id);
  }

  protected openShare(startGroup: boolean): void {
    this.startGroup.set(startGroup);
    this.shareOpen.set(true);
  }

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
