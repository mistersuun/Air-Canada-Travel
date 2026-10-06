import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../../components/shared/icons.component';
import { buildPrepChecklist, tripEssentials } from '../../../places/prep';
import { ClimateService } from '../../../recs/climate.service';
import { MAX_USUAL_ITEMS } from '../../../recs/profile';
import { ProfileService } from '../../../recs/profile.service';
import { AppStateService } from '../../../state/app-state.service';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { TripChangesComponent } from '../../../trips/ui/trip-changes.component';
import { tripPath, tripQuery } from '../../../ui/links';
import { type PrepRow, doneLabel, listingStatus, prepRow } from './prep-model';

/**
 * Prep tab of a trip (mockup g7): open schedule changes first (nothing moves
 * until Accept), then "Before you go", the checklist built from the actual
 * route (entry items with official links, listing per flight, finding the
 * real train or bus, and the traveller's own items), then Money and Time.
 */
@Component({
  selector: 'app-prep-tab',
  standalone: true,
  imports: [IconComponent, TripChangesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp">
      <app-trip-changes [trip]="trip()" />

      <section aria-labelledby="pp-h">
        <div class="ui-sec-h pp__h">
          <h2 class="ui-h3" id="pp-h">Before you go</h2>
          <span class="ui-sub tn" data-count>{{ count() }}</span>
        </div>
        <div class="ui-card pp__list">
          @for (r of rows(); track r.item.id) {
            <div class="chk" [class.is-on]="r.item.done" [attr.data-item]="r.item.id">
              <label class="chk__l">
                <input type="checkbox" class="ui-visually-hidden" [checked]="r.item.done" (change)="toggle(r, $event)"
                       [attr.aria-describedby]="r.action.kind === 'leg' ? 'pp-leg-hint' : null">
                <span class="box" aria-hidden="true"><app-icon name="check" [size]="13" [strokeWidth]="2.5" /></span>
                <b class="chk__t">{{ r.item.title }}</b>
              </label>
              @if (r.pre || r.link || r.post) {
                <span class="chk__m">{{ r.pre }}@if (r.link; as l) {<a [href]="l.url" target="_blank" rel="noopener">{{ l.label }}</a>}{{ r.post }}</span>
              }
              @if (r.customId; as cid) {
                @if (!isUsual(r.item.title)) {
                  <button type="button" class="chk__save" data-save-usual (click)="saveUsual(r.item.title)"
                          [attr.aria-label]="'Save ' + r.item.title + ' as a usual item'">Save as usual</button>
                }
                <button type="button" class="chk__rm" [attr.aria-label]="'Remove ' + r.item.title" (click)="removeCustom(cid)">
                  <app-icon name="close" [size]="15" />
                </button>
              }
            </div>
          }
          <form class="add" (submit)="addCustom($event)">
            <label class="ui-visually-hidden" for="pp-add">Add your own item</label>
            <input id="pp-add" class="add__in" type="text" maxlength="300" autocomplete="off" placeholder="Add your own item"
                   [value]="draft()" (input)="draft.set($any($event.target).value)" data-add-input>
            <button type="submit" class="ui-btn ui-btn--ghost ui-btn--sm" [disabled]="!draft().trim() || trips.readOnly()" data-add>Add</button>
          </form>
        </div>
        <p class="ui-visually-hidden" id="pp-leg-hint">Opens the leg so you can save the times you found.</p>
      </section>

      @if (ess(); as e) {
        <div class="ui-ess tn pp__ess" data-ess>
          @if (e.currency) { <div><span>Money</span><b>{{ e.currency }}</b></div> }
          @if (e.timeDiff) { <div><span>Time</span><b>{{ e.timeDiff }}</b></div> }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pp { display: grid; gap: 16px; }
    .pp__h { margin: 6px 0 8px; align-items: center; }
    .pp__h h2 { margin: 0; font-size: 19px; }
    .pp__list { padding: 4px 16px; }
    .chk { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; padding: 6px 0; }
    .chk + .chk, .chk + .add { border-top: 1px solid var(--hair); }
    .chk__l { display: flex; align-items: flex-start; gap: 12px; min-height: 44px; padding-top: 8px; cursor: pointer; }
    .box {
      flex: none; width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid var(--hair); background: var(--surface);
      display: grid; place-items: center; color: #FFFFFF;
      transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
    }
    .box app-icon { opacity: 0; transform: scale(.4); transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur) var(--ease-out); }
    .is-on .box { background: var(--teal); border-color: var(--teal); }
    .is-on .box app-icon { opacity: 1; transform: none; }
    .chk__l input:focus-visible + .box { outline: 2px solid var(--blue); outline-offset: 2px; }
    .chk__t { font-size: 15px; font-weight: 650; line-height: 1.35; padding-top: 1px; }
    .chk__m { grid-column: 1; margin: -4px 0 8px 34px; font-size: 12.5px; color: var(--ink-2); line-height: 1.4; }
    .chk__m a { color: var(--blue); }
    .chk__rm {
      grid-column: 2; grid-row: 1; width: 44px; height: 44px; margin-right: -12px; display: grid; place-items: center;
      border-radius: 12px; color: var(--ink-3); cursor: pointer;
    }
    .chk__rm:hover { color: var(--ink); }
    .chk__save {
      grid-column: 1; grid-row: 3; justify-self: start; min-height: 44px; margin: -4px 0 0 34px; padding: 0 4px;
      font-size: 12.5px; font-weight: 600; color: var(--blue); cursor: pointer;
    }
    .add { display: flex; gap: 8px; align-items: center; padding: 10px 0 12px; }
    .add__in {
      flex: 1; min-width: 0; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--hair);
      background: var(--fill); color: var(--ink); font: inherit; font-size: 14.5px;
    }
    .add__in::placeholder { color: var(--ink-3); }
    .add .ui-btn { min-height: 44px; }
    .pp__ess { margin-top: 2px; }
    @media (prefers-reduced-motion: reduce) {
      .box, .box app-icon { transition: none; }
    }
  `],
})
export class PrepTabComponent {
  protected readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly climate = inject(ClimateService);
  private readonly profile = inject(ProfileService);

  readonly trip = input.required<Trip>();

  constructor() {
    void this.climate.ensureLoaded();
  }

  protected readonly draft = signal('');
  protected readonly items = computed(() => buildPrepChecklist(this.trip(), this.climate.index()));
  protected readonly rows = computed(() => this.items().map(prepRow));
  protected readonly count = computed(() => doneLabel(this.items()));
  protected readonly ess = computed(() => {
    const e = tripEssentials(this.trip(), this.state.nowMs());
    return e.currency || e.timeDiff ? e : null;
  });

  protected toggle(r: PrepRow, e: Event): void {
    const box = e.target as HTMLInputElement;
    const done = box.checked;
    const t = this.trip();
    switch (r.action.kind) {
      case 'prep':
        this.trips.setPrep(t.id, r.item.id, done);
        break;
      case 'status': {
        const next = listingStatus(t, r.action.legId, done);
        if (next) this.trips.setLegStatus(t.id, r.action.legId, next);
        else box.checked = r.item.done;
        break;
      }
      case 'leg':
        // The ride is ticked by saving its real times on the leg.
        box.checked = r.item.done;
        void this.router.navigate(tripPath(t.id), {
          queryParams: { tab: null, ...tripQuery('plan', r.action.legId) }, queryParamsHandling: 'merge', replaceUrl: true,
        });
        break;
    }
  }

  protected addCustom(e: Event): void {
    e.preventDefault();
    const text = this.draft().trim();
    if (!text) return;
    this.trips.addCustomPrep(this.trip().id, text);
    this.draft.set('');
  }

  protected isUsual(text: string): boolean {
    return this.profile.hasUsualItem(text);
  }

  protected saveUsual(text: string): void {
    if (this.profile.addUsualItem(text)) this.state.flash('Saved to My usual items');
    else this.state.flash(`My usual items is full (${MAX_USUAL_ITEMS})`);
  }

  protected removeCustom(id: string): void {
    this.trips.removeCustomPrep(this.trip().id, id);
  }
}
