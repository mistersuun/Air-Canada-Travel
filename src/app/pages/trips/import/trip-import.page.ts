import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { t } from '../../../i18n/t';
import { IconComponent } from '../../../components/shared/icons.component';
import { AppStateService } from '../../../state/app-state.service';
import type { SharedTripPreview } from '../../../trips/model';
import { payloadFromFragment } from '../../../trips/share-codec';
import { TripsService } from '../../../trips/trips.service';
import { airportTz } from '../../../utils/airports';
import { tripPath, tripsPath } from '../../../ui/links';
import { TripCardComponent } from '../plan/trip-card.component';
import { sharedLabel } from '../trips-model';

type ImportState = 'loading' | 'invalid' | 'ready';

/**
 * Import a shared trip (/trips/import#t=<payload>). The plan travels in the
 * fragment, which never reaches a server. Shows a preview ("Shared plan ·
 * Thu Oct 1") and saves a copy with a new id on "Save to my trips".
 */
@Component({
  selector: 'app-trip-import-page',
  standalone: true,
  imports: [RouterLink, IconComponent, TripCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare ti">
      <header class="ti__head">
        <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('trips.detail.back')" (click)="notNow()"><app-icon name="arrow-left" [size]="18" /></button>
        <h1 class="ui-h3">{{ t('trips.model.sharedPlan') }}</h1>
        <span class="ti__sp" aria-hidden="true"></span>
      </header>

      @switch (status()) {
        @case ('loading') {
          <p class="ui-sub ti__msg" role="status">{{ t('trips.imp.opening') }}</p>
        }
        @case ('invalid') {
          <div class="ui-card ti__bad" data-invalid>
            <h2 class="ui-h3">{{ t('trips.imp.badTitle') }}</h2>
            <p class="ui-sub">{{ t('trips.imp.badText') }}</p>
            <a class="ui-btn ui-btn--dark" [routerLink]="tripsPath()" [queryParams]="state.globalParams()">{{ t('trips.imp.goTrips') }}</a>
          </div>
        }
        @default {
          @if (preview(); as p) {
            <p class="ui-label ti__lbl" data-shared>{{ label() }}</p>
            <app-trip-card [trip]="p.trip" mode="static" />
            @if (p.trip.party.splitNote) {
              <div class="ui-card ti__split">
                <div class="ui-label">{{ t('trips.share.split') }}</div>
                <p>{{ p.trip.party.splitNote }}</p>
              </div>
            }
            @if (p.notes.length) {
              <p class="ui-sub ti__notes">{{ t('trips.imp.notes', { n: p.notes.length }) }}</p>
            }
            <div class="ti__acts">
              <button type="button" class="ui-btn ui-btn--ghost" data-not-now (click)="notNow()">{{ t('trips.imp.notNow') }}</button>
              <button type="button" class="ui-btn" data-save (click)="save()">{{ t('trips.imp.save') }}</button>
            </div>
            <p class="ui-sub ti__fine">{{ t('trips.imp.fine') }}</p>
          }
        }
      }
    </div>
  `,
  styles: [`
    .ti { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; gap: 12px; }
    .ti__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .ti__head h1 { margin: 0; }
    .ti__sp { width: 40px; flex: none; }
    .ti__msg { text-align: center; padding: 32px 0; }
    .ti__bad { padding: 28px 24px; text-align: center; display: grid; gap: 8px; justify-items: center; }
    .ti__bad .ui-btn { margin-top: 8px; }
    .ti__lbl { margin: 4px 2px 0; }
    .ti__split { padding: 12px 14px; background: var(--fill); box-shadow: none; }
    .ti__split p { font-size: 14px; margin-top: 4px; }
    .ti__notes, .ti__fine { text-align: center; font-size: 12.5px; }
    .ti__acts { display: flex; gap: 10px; }
    .ti__acts .ui-btn { flex: 1; }
    @media (min-width: 720px) { .ti { padding-top: 24px; } }
  `],
})
export class TripImportPage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly trips = inject(TripsService);
  private readonly router = inject(Router);
  protected readonly tripsPath = tripsPath;

  protected readonly status = signal<ImportState>('loading');
  protected readonly preview = signal<SharedTripPreview | null>(null);
  protected readonly label = computed(() => {
    const p = this.preview();
    return p ? sharedLabel(p.sharedAt, airportTz(p.trip.homeAirport)) : '';
  });

  constructor() {
    // Read the fragment now: the app rewrites the URL (and drops the fragment) on its first replace.
    const fragment = inject(ActivatedRoute).snapshot.fragment ?? inject(PlatformLocation).hash.replace(/^#/, '');
    const payload = payloadFromFragment(fragment);
    if (!payload) {
      this.status.set('invalid');
      return;
    }
    void this.trips.decodeShared(payload).then(p => {
      this.preview.set(p);
      this.status.set(p ? 'ready' : 'invalid');
    });
  }

  protected save(): void {
    const p = this.preview();
    if (!p) return;
    const trip = this.trips.saveShared(p);
    this.state.flash(t('trips.imp.saved', { name: trip.name }));
    void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams(), replaceUrl: true });
  }

  protected notNow(): void {
    void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams(), replaceUrl: true });
  }
}
