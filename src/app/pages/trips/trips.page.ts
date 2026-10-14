import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { PlaceSearchComponent } from '../../places/ui/place-search.component';
import { logbookPath } from '../../extras/links';
import type { Place } from '../../trips/model';
import { reachPath } from '../../ui/links';
import { airportTz } from '../../utils/airports';
import { todayKey } from '../../utils/time';
import { reachDep } from '../home/home-model';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { ComingUpBannerComponent } from '../../trips/ui/coming-up-banner.component';
import { OutcomePromptComponent } from '../../trips/ui/outcome-prompt.component';
import { DestRowComponent } from '../../ui/dest-row.component';
import { destPath } from '../../ui/links';
import { findDestination } from '../../utils/airports';
import { ROUTE_ONLY_NOTE } from '../../data/route-network';
import { rowMeta, upcoming } from '../saved/saved-model';
import { TripCardComponent } from './plan/trip-card.component';
import { returnNotListed } from './trips-model';
import { TripIdeasComponent } from '../../recs/ui/trip-ideas.component';

/** Starred places shown on the Trips tab before "All N". */
export const STARRED_PREVIEW = 3;

/**
 * Trips (/trips, mockup g2): the soonest active trip as the full timeline
 * card, later ones as compact cards, the "return not listed" reminder, the
 * outcome prompts ("How did it go?"), the starred places (top 3, "All N" →
 * /saved), and past trips folded away.
 */
@Component({
  selector: 'app-trips-page',
  standalone: true,
  imports: [RouterLink, IconComponent, GlassSheetComponent, PlaceSearchComponent, TripCardComponent, OutcomePromptComponent, ComingUpBannerComponent, DestRowComponent, TripIdeasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page tp">
      <div class="tp__hd">
        <h1 class="ui-h1 tp__ttl">Trips</h1>
        <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" data-new-trip aria-haspopup="dialog" (click)="newOpen.set(true)">
          + New trip</button>
      </div>
      <nav class="tp__links" aria-label="Saved and logbook">
        <a routerLink="/saved" [queryParams]="state.globalParams()" data-link-saved>Saved</a>
        <a [routerLink]="logbookLink" [queryParams]="state.globalParams()" data-link-logbook>Logbook</a>
      </nav>
      @if (newOpen()) {
        <app-glass-sheet title="New trip" [open]="true" (closed)="newOpen.set(false)">
          <p class="ui-sub tp__np">Where do you want to go? You pick the flight on the next screen.</p>
          <app-place-search label="Search a city or airport" [destinationsOnly]="true" (picked)="startFrom($event)" />
        </app-glass-sheet>
      }
      <app-coming-up-banner />

      @if (trips.readOnly()) {
        <p class="note note--blue"><app-icon name="info" [size]="16" />
          <span>These trips were saved by a newer version of the app. They show here, but changes won't be kept.</span></p>
      }

      @if (trips.unsaved()) {
        <p class="note note--amber" data-unsaved role="status"><app-icon name="warning" [size]="16" />
          <span>Couldn't save on this phone. Export a backup now. <button type="button" class="lnk" (click)="exportNow()">Export</button></span></p>
      } @else if (trips.backupReminder(); as n) {
        <p class="note note--blue" data-backup-nudge><app-icon name="info" [size]="16" />
          <span>{{ n }} <button type="button" class="lnk" (click)="exportNow()">Export now</button></span></p>
      }

      @if (active().length) {
        @for (t of active(); track t.id; let first = $first) {
          <app-trip-card [trip]="t" mode="link" [compact]="!first" showTries />
          @if (first && warnFor(t)) {
            <p class="note note--amber" data-return-warning><app-icon name="warning" [size]="16" />
              <span>Return leg not listed yet. Listing usually opens a few days before; check your pass rules.</span></p>
          }
        }
      } @else {
        <div class="ui-card empty" data-empty>
          <span class="empty__ic"><app-icon name="suitcase" [size]="26" /></span>
          <h2 class="ui-h3">No trips yet</h2>
          <p class="ui-sub">Search a city on Explore, or open a destination and tap Start a trip.</p>
          <a class="ui-btn ui-btn--dark" routerLink="/" [queryParams]="state.globalParams()">Explore destinations</a>
        </div>
      }

      @for (p of trips.pendingOutcomes(); track p.key) {
        <app-outcome-prompt [prompt]="p" />
      }

      <app-trip-ideas />

      @if (starredCount()) {
        <section class="sec" data-starred>
          <div class="ui-sec-h sec__h">
            <h2 class="ui-h3">Starred places</h2>
            <a routerLink="/saved" [queryParams]="state.globalParams()">All {{ starredCount() }}</a>
          </div>
          <div class="ui-card list">
            @for (r of starred(); track r.code) {
              <app-dest-row [code]="r.code" [small]="r.code" [meta]="r.meta" [link]="destPath(r.code)" />
            }
          </div>
        </section>
      }

      @if (past().length) {
        <details class="past" data-past>
          <summary><span class="ui-h3">Past trips</span><span class="ui-sub tn">{{ past().length }}</span><span class="chev" aria-hidden="true">›</span></summary>
          <div class="past__l">
            @for (t of past(); track t.id) {
              <app-trip-card [trip]="t" mode="link" compact />
            }
          </div>
        </details>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tp { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; gap: 12px; }
    .tp__hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .tp__hd .ui-btn { min-height: 44px; flex: none; }
    .tp__links { display: flex; gap: 18px; margin: -4px 2px 0; }
    .tp__links a { display: inline-flex; align-items: center; min-height: 44px; font-weight: 600; color: var(--ink-2); }
    .tp__np { margin: 0 0 10px; }
    .tp__ttl { font-size: 30px; margin: 6px 2px 2px; }
    .note { display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; font-size: 13px; }
    .note app-icon { flex: none; margin-top: 1px; }
    .note--amber { background: color-mix(in srgb, var(--amber) 12%, transparent); color: var(--amber-ink); }
    .note--amber app-icon { color: var(--amber); }
    .note--blue { background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-ink); }
    .note--blue app-icon { color: var(--blue); }
    .lnk { font: inherit; font-weight: 600; text-decoration: underline; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
    .sec { margin-top: 8px; }
    .sec__h { margin: 0 2px 10px; }
    .sec__h .ui-h3 { font-size: 19px; }
    .list { padding: 4px 14px; }
    .empty {
      padding: 32px 24px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
    }
    .empty__ic {
      width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center;
      background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue); margin-bottom: 4px;
    }
    .empty .ui-btn { margin-top: 10px; }
    .past { margin-top: 8px; }
    .past summary {
      list-style: none; display: flex; align-items: center; gap: 8px; cursor: pointer; min-height: 44px; padding: 0 2px;
    }
    .past summary::-webkit-details-marker { display: none; }
    .past .chev { margin-left: auto; color: var(--ink-3); font-size: 18px; transition: transform var(--dur-fast) var(--ease-out); }
    .past[open] .chev { transform: rotate(90deg); }
    .past__l { display: grid; gap: 12px; margin-top: 8px; }
    @media (min-width: 720px) {
      .tp { padding-top: 32px; }
      .tp__ttl { font-size: 34px; }
    }
  `],
})
export class TripsPage {
  protected readonly state = inject(AppStateService);
  protected readonly trips = inject(TripsService);
  protected readonly destPath = destPath;
  private readonly router = inject(Router);
  protected readonly logbookLink = logbookPath();
  protected readonly newOpen = signal(false);

  protected readonly active = this.trips.activeTrips;
  protected readonly past = this.trips.pastTrips;

  protected readonly starredCount = computed(() => this.state.favourites().filter(c => findDestination(c)).length);

  /** The first three favourites: next nonstop first ('Tomorrow · 22:20 · 14h10'), then the rest. */
  protected readonly starred = computed(() => {
    if (!this.starredCount()) return [];
    const up = upcoming(
      this.state.hub(), this.state.favourites(), this.state.todayKey(), this.state.nowMs(),
      this.state.coverage(), this.state.timeFormat(), this.state.connect(),
    );
    const today = this.state.todayKey();
    const fmt = this.state.timeFormat();
    const rows = [
      ...up.items.map(u => ({ code: u.code, meta: rowMeta(u, today, fmt) })),
      ...up.rest.map(n => ({
        code: n.code,
        meta: n.via ? `${n.country} · via ${n.via}`
          : n.routeOnly ? `${n.country} · ${ROUTE_ONLY_NOTE}`
          : `${n.country} · not found in our schedule data`,
      })),
    ];
    return rows.slice(0, STARRED_PREVIEW);
  });

  /**
   * A place was picked: a place Air Canada flies to goes to its destination page ("Start a trip to ..."),
   * any other to the reach flow, which has "Start this trip".
   */
  protected startFrom(place: Place): void {
    this.newOpen.set(false);
    if (place.acCode && !findDestination(place.acCode)) {
      this.state.flash('Trips start from a hub. Pick where you are going.');
      return;
    }
    if (place.acCode) {
      void this.router.navigate(destPath(place.acCode), { queryParams: this.state.globalParams() });
      return;
    }
    const today = todayKey(airportTz(this.state.hub()), this.state.nowMs());
    void this.router.navigate(reachPath(place.id), {
      queryParams: { ...this.state.globalParams(), dep: reachDep(this.state.selectedDateKey(), today) },
    });
  }

  protected exportNow(): void {
    const r = this.trips.downloadBackup();
    this.state.flash(r ? `Downloaded ${r.filename}` : 'Could not create the file on this browser.');
  }

  protected warnFor(t: Parameters<typeof returnNotListed>[0]): boolean {
    return returnNotListed(t, this.state.nowMs());
  }
}
