import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { PrefsService } from '../../state/prefs.service';
import { TripsService } from '../../trips/trips.service';
import { DestPhotoComponent } from '../../ui/dest-photo.component';
import { findDestination } from '../../utils/airports';
import { regionVar } from '../../utils/region-color';
import { tripPath, tripQuery, tripUrl, tripsPath } from '../../ui/links';
import { type RecoverRow, recoverView } from './today-model';

/**
 * "Still reachable" (/trips/:id/recover?at=YUL&leg=<legId>), after "I didn't
 * board" or "Pick another flight": keeps the goal and the deadline and lists
 * only what is still physically reachable from `at`, starting now. Options
 * that left too early are greyed with the reason and no Use button. "Use"
 * swaps the option into the trip (TripsService.swapLeg flashes "Swapped to …
 * · Listing is still your step" with Undo) and opens the trip.
 */
@Component({
  selector: 'app-recover-page',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, IconComponent, DestPhotoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare rc">
      @if (view(); as v) {
        <header class="rc__head">
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <div class="rc__title">
            <h1 class="ui-h3">Still reachable</h1>
            <p class="rc__sub tn">{{ v.subtitle }}</p>
          </div>
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Settings (connection times)" (click)="state.openSettings()">
            <app-icon name="gear" [size]="18" />
          </button>
        </header>

        <div class="ui-card rc__goal" data-goal>
          Goal <b>{{ v.goal }}</b> · home by <b class="tn">{{ v.homeBy }}</b>@if (v.legNote) { · {{ v.legNote }}}
        </div>

        <h2 class="ui-h3 rc__h">Tonight</h2>
        @if (v.tonight.length) {
          <div class="ui-card rc__list" data-group="tonight">
            @for (r of v.tonight; track r.key) {
              <ng-container [ngTemplateOutlet]="rowT" [ngTemplateOutletContext]="{ $implicit: r }" />
            }
          </div>
        } @else {
          <p class="ui-card rc__none">Nothing else found tonight from {{ v.at }} in our schedule data.</p>
        }

        <h2 class="ui-h3 rc__h">Tomorrow</h2>
        @if (v.tomorrow.length) {
          <div class="ui-card rc__list" data-group="tomorrow">
            @for (r of v.tomorrow; track r.key) {
              <ng-container [ngTemplateOutlet]="rowT" [ngTemplateOutletContext]="{ $implicit: r }" />
            }
            @if (showMore()) {
              @for (r of v.tomorrowMore; track r.key) {
                <ng-container [ngTemplateOutlet]="rowT" [ngTemplateOutletContext]="{ $implicit: r }" />
              }
            } @else if (v.tomorrowMore.length) {
              <button type="button" class="rc__more ui-link" data-more (click)="showMore.set(true)">
                {{ v.tomorrowMore.length }} more tomorrow
              </button>
            }
          </div>
        } @else {
          <p class="ui-card rc__none">Nothing found tomorrow from {{ v.at }} in our schedule data.</p>
        }

        @if (v.note; as n) {
          <div class="rc__note" [class.is-warn]="n.returnBroken" data-note>
            <app-icon name="info" [size]="16" [strokeWidth]="2" />
            <span>{{ n.text }}
              @if (n.returnBroken) { <a class="ui-link" [routerLink]="tripLink(v.tripId)" [queryParams]="returnQuery">Open Return</a> }
            </span>
          </div>
        }
        <p class="rc__foot">Times are Scheduled; onward trips are Estimated. Listing stays your own step.</p>

        <ng-template #rowT let-r>
          <div class="rc__row" [class.is-off]="!r.usable" [attr.data-gateway]="r.gateway" [attr.data-status]="r.option.status">
            @if (r.thumb.kind === 'photo') {
              <app-dest-photo class="rc__th" [code]="r.thumb.code" size="thumb" />
            } @else {
              <span class="rc__th rc__mono ui-mono" [class.is-hub]="r.option.status === 'missedConnection'" [style.--mono]="tint(r.thumb.code)" aria-hidden="true">{{ r.thumb.code }}</span>
            }
            <div class="rc__rt">
              <p class="rc__name"><b>{{ r.name }}</b>@if (r.code) {<span class="rc__code">{{ r.code }}</span>}</p>
              <p class="rc__m tn">{{ r.line }}</p>
              @if (r.onward) { <p class="rc__m">{{ r.onward }}</p> }
            </div>
            @if (r.usable && v.legId) {
              <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm rc__use" [attr.aria-label]="'Use ' + r.line" (click)="use(r)">Use</button>
            }
          </div>
        </ng-template>
      } @else {
        <div class="rc__empty">
          <h1 class="ui-h2">Trip not found</h1>
          <a class="ui-btn ui-btn--dark" [routerLink]="tripsLink">Open Trips</a>
        </div>
      }
    </div>
  `,
  styles: [`
    .rc { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .rc__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .rc__title { min-width: 0; text-align: center; }
    .rc__title h1 { margin: 0; }
    .rc__sub { margin: 1px 0 0; font-size: 12.5px; color: var(--ink-2); }
    .rc__goal { margin-top: 14px; padding: 12px 14px; font-size: 13.5px; color: var(--ink-2); }
    .rc__goal b { color: var(--ink); font-weight: 650; }
    .rc__h { margin: 22px 2px 10px; font-size: 19px; }
    .rc__list { padding: 4px 14px; }
    .rc__none { margin: 0; padding: 14px; font-size: 13.5px; color: var(--ink-2); }
    .rc__row { display: flex; align-items: center; gap: 12px; padding: 12px 0; min-height: 68px; border-bottom: 1px solid var(--hair); }
    .rc__row:last-child, .rc__row:has(+ .rc__more) { border-bottom: 0; }
    /* Not usable, but still facts: only the thumbnail is muted; text keeps full contrast. */
    .rc__row.is-off .rc__th { opacity: .5; }
    .rc__th { width: 46px; height: 46px; flex: none; border-radius: var(--radius-thumb); }
    .rc__mono { font-family: var(--cond); font-size: 13px; }
    .rc__mono.is-hub { --mono: var(--teal) !important; }
    .rc__rt { min-width: 0; flex: 1; }
    .rc__rt p { margin: 0; }
    .rc__name { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rc__name b { font-weight: 650; }
    .rc__code { margin-left: 5px; font-size: 12px; font-weight: 600; color: var(--ink-3); }
    .rc__m { font-size: 12.5px; line-height: 1.4; color: var(--ink-2); margin-top: 2px !important; overflow-wrap: anywhere; }
    .rc__use { flex: none; min-height: 40px; min-width: 52px; position: relative; }
    .rc__use::after { content: ''; position: absolute; inset: -4px; }
    .rc__more { display: block; width: 100%; min-height: 44px; text-align: left; font-size: 13.5px; border-top: 1px solid var(--hair); }
    .rc__note {
      display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 12px 14px; border-radius: var(--radius-card);
      background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-ink); font-size: 13.5px; line-height: 1.45;
    }
    .rc__note app-icon { flex: none; margin-top: 2px; }
    .rc__note.is-warn { background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--amber-ink); }
    .rc__note .ui-link { color: inherit; text-decoration: underline; text-underline-offset: 2px; margin-left: 2px; }
    .rc__foot { margin: 16px 2px 0; font-size: 12px; color: var(--ink-3); }
    .rc__empty { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding-top: 12px; }
    @media (min-width: 720px) {
      .rc { padding-top: 24px; }
    }
  `],
})
export class RecoverPage {
  private readonly trips = inject(TripsService);
  protected readonly state = inject(AppStateService);
  private readonly prefs = inject(PrefsService);
  private readonly router = inject(Router);

  readonly id = input<string>('');
  /** ?at=YUL: where the traveller is now. */
  readonly at = input<string | undefined>(undefined);
  /** ?leg=<legId>: the outbound leg being replaced. */
  readonly leg = input<string | undefined>(undefined);

  protected readonly tripsLink = tripsPath();
  protected readonly returnQuery = tripQuery('return');
  protected readonly showMore = signal(false);

  protected readonly view = computed(() => {
    const trip = this.trips.trips().find(t => t.id === this.id());
    if (!trip) return null;
    return recoverView({
      trip, at: this.at()?.toUpperCase() ?? null, legId: this.leg() ?? null,
      nowMs: this.state.nowMs(), connect: this.state.connect(), fmt: this.prefs.timeFormat(),
    });
  });

  /** The region colour of a gateway's code tile (hub tiles are teal). */
  protected tint(code: string): string {
    return regionVar(findDestination(code)?.region);
  }

  protected tripLink(id: string): string[] {
    return tripPath(id);
  }

  protected back(): void {
    this.state.goBack(tripPath(this.id()));
  }

  protected use(r: RecoverRow): void {
    const v = this.view();
    if (!v || !v.legId || !r.usable) return;
    this.trips.swapLeg(v.tripId, v.legId, r.option.itinerary, r.option.ground);
    void this.router.navigateByUrl(tripUrl(v.tripId));
  }
}
