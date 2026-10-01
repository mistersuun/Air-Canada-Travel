import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { profilePath } from '../../extras/links';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import type { Recommendation } from '../model';
import { ProfileService } from '../profile.service';
import { RecsService } from '../recs.service';
import { RecCardComponent, dismissWithUndo } from './rec-card.component';

/**
 * Trips tab: "Ideas for later" (extras spec §6.3, mock x13 right). Up to 3
 * cards from your own log, your styles and the next long weekend, never an
 * active trip's goal. With no active trips the heading is just "Ideas".
 */
@Component({
  selector: 'app-trip-ideas',
  standalone: true,
  imports: [RouterLink, IconComponent, RecCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <section class="ideas" aria-labelledby="h-ideas" data-ideas>
        <div class="ui-sec-h hd">
          <h2 class="ui-h3" id="h-ideas">{{ title() }}</h2>
          <a [routerLink]="profileLink" [queryParams]="state.globalParams()" data-profile-link>Profile</a>
        </div>
        <p class="line">Scheduled flights, not seats. No boarding chances.</p>
        <div class="list">
          @for (r of items(); track r.id) {
            <app-rec-card [items]="[r]" (dismiss)="dismiss($event)" />
          }
          @if (profile.isEmpty()) {
            <a class="ui-card tell" [routerLink]="profileLink" [queryParams]="state.globalParams()" data-tell>
              <span class="tell__ic"><app-icon name="sparkle" [size]="18" /></span>
              <span class="tell__tx"><b>Tell us what you like</b>&ngsp;<span>Travel profile</span></span>
              <app-icon class="chev" name="chevron-right" [size]="16" />
            </a>
          }
        </div>
        @if (hasWeather()) {
          <p class="foot">Typical weather from Open-Meteo (CC BY 4.0). Not a forecast.</p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .ideas { margin-top: 8px; }
    .hd { margin: 0 2px 2px; }
    .hd .ui-h3 { font-size: 19px; margin: 0; }
    .hd > a { position: relative; padding: 13px 8px; margin: -13px -8px; }
    .line { margin: 0 2px 10px; font-size: 13px; color: var(--ink-2); }
    .list { display: grid; gap: 12px; }
    .tell { display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 56px; color: var(--ink); text-decoration: none; }
    .tell__ic { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; flex: none;
      background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue); }
    .tell__tx { flex: 1; display: grid; gap: 1px; min-width: 0; }
    .tell__tx b { font-size: 14.5px; font-weight: 650; }
    .tell__tx span { font-size: 12.5px; color: var(--ink-2); }
    .tell .chev { color: var(--ink-3); }
    .foot { margin: 10px 2px 0; font-size: 12px; color: var(--ink-2); }
  `],
})
export class TripIdeasComponent {
  protected readonly state = inject(AppStateService);
  protected readonly profile = inject(ProfileService);
  private readonly recs = inject(RecsService);
  private readonly trips = inject(TripsService);

  protected readonly profileLink = profilePath();
  protected readonly items = computed(() => this.recs.forTrips().flatMap(g => g.items));
  protected readonly title = computed(() => (this.trips.activeTrips().length ? 'Ideas for later' : 'Ideas'));
  protected readonly hasWeather = computed(() => this.items().some(r => r.weather));

  constructor() {
    afterNextRender(() => void this.recs.ensureClimate());
  }

  protected dismiss(r: Recommendation): void {
    dismissWithUndo(this.profile, this.state, r);
  }
}
