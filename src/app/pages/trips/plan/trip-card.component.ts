import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../components/shared/icons.component';
import { AppStateService } from '../../../state/app-state.service';
import type { Trip } from '../../../trips/model';
import { LegStatusTagComponent } from '../../../trips/ui/leg-status-tag.component';
import { ProvenanceTagComponent } from '../../../trips/ui/provenance-tag.component';
import { tripPath, tripQuery } from '../../../ui/links';
import { compactSummary, countdown, homeLabel, legRows, partyLabel, tripDatesLabel } from '../trips-model';

/**
 * The trip timeline card (mockup g2): the goal, the dates, a countdown tag,
 * the party and hub chips, every leg with its status (flights) or source
 * (ground), and "Home, Montréal" at the end.
 *
 *   <app-trip-card [trip]="t" mode="link" />            list: legs link to /trips/:id?leg=
 *   <app-trip-card [trip]="t" mode="button" (legPick)="…" (partyPick)="…" />   plan tab
 *   <app-trip-card [trip]="t" compact mode="link" />    a later trip: header and one summary line
 */
@Component({
  selector: 'app-trip-card',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, IconComponent, LegStatusTagComponent, ProvenanceTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="ui-card tc" [class.is-compact]="compact()">
      <div class="tc__hd">
        <div class="tc__goal">
          <div class="ui-label">Goal</div>
          @if (mode() === 'link') {
            <h2 class="ui-h2 tc__name"><a [routerLink]="tripLink()" [queryParams]="state.globalParams()">{{ trip().goal.name }}</a></h2>
          } @else {
            <h2 class="ui-h2 tc__name">{{ trip().goal.name }}</h2>
          }
          <p class="ui-sub tn tc__dates">{{ dates() }}</p>
        </div>
        <span class="ui-tag tc__cd" [class]="'ui-tag--' + cd().tone" data-countdown>{{ cd().text }}</span>
      </div>

      @if (compact()) {
        <p class="ui-sub tc__sum">{{ partyText() }} · From {{ trip().fromHub }} · {{ summary() }}</p>
      } @else {
        <div class="tc__chips">
          @if (mode() === 'button') {
            <button type="button" class="tc__chip" data-party (click)="partyPick.emit()" aria-label="Edit travellers">{{ partyText() }}</button>
          } @else {
            <span class="tc__chip" data-party>{{ partyText() }}</span>
          }
          <span class="tc__chip">From {{ trip().fromHub }}</span>
        </div>

        <ol class="tl" aria-label="Legs">
          @for (r of rows(); track r.id) {
            <li class="tl__it" [class.is-ground]="r.kind === 'ground'" [class.is-done]="r.done" [attr.data-leg]="r.id">
              <span class="tl__ic" aria-hidden="true"><b><app-icon [name]="r.icon" [size]="12" [strokeWidth]="2.2" /></b><u></u></span>
              @switch (mode()) {
                @case ('link') {
                  <a class="tl__b" [routerLink]="tripLink()" [queryParams]="legQuery(r.id)">
                    <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: r }" />
                  </a>
                }
                @case ('button') {
                  <button type="button" class="tl__b" (click)="legPick.emit(r.id)" [attr.aria-label]="r.title + ', ' + r.meta">
                    <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: r }" />
                  </button>
                }
                @default {
                  <div class="tl__b"><ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: r }" /></div>
                }
              }
            </li>
          } @empty {
            <li class="tl__none ui-sub">No legs yet. Add a flight from a destination or a flight page.</li>
          }
          <li class="tl__end"><i aria-hidden="true"><app-icon name="home" [size]="12" [filled]="true" /></i><span>{{ home() }}</span></li>
        </ol>
      }
    </article>

    <ng-template #body let-r>
      <span class="tl__top">
        <span class="tl__t tn">{{ r.title }}</span>
        @if (r.status) { <app-leg-status-tag [status]="r.status" /> }
        @else if (r.provenance) { <app-provenance-tag [value]="r.provenance" /> }
      </span>
      <span class="tl__m tn">{{ r.meta }}</span>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .tc { padding: 16px; }
    .tc__hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .tc__goal { min-width: 0; }
    .tc__name { margin-top: 2px; }
    .tc__name a { color: inherit; }
    .tc__name a:hover { color: var(--blue); }
    .tc__dates { margin-top: 2px; }
    .tc__cd { flex: none; margin-top: 2px; }
    .tc__chips { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .tc__chip {
      display: inline-flex; align-items: center; padding: 5px 10px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; color: var(--ink-2); background: var(--surface);
      box-shadow: inset 0 0 0 1px var(--hair); white-space: nowrap;
    }
    button.tc__chip { cursor: pointer; min-height: 32px; }
    button.tc__chip:hover { color: var(--ink); }
    .tc__sum { margin-top: 10px; }

    .tl { list-style: none; margin: 14px 0 0; padding: 0; display: grid; }
    .tl__it { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; }
    .tl__ic { display: flex; flex-direction: column; align-items: center; }
    .tl__ic b {
      width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none;
      background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue);
    }
    .tl__ic u { flex: 1; width: 2px; background: var(--hair); min-height: 14px; }
    .is-ground .tl__ic b { background: color-mix(in srgb, var(--teal) 15%, transparent); color: var(--teal); }
    .is-ground .tl__ic u { background: repeating-linear-gradient(var(--hair) 0 4px, transparent 4px 8px); }
    .tl__b {
      display: block; width: 100%; text-align: left; padding: 0 0 12px; min-width: 0; color: var(--ink);
      border-radius: 10px; min-height: 44px;
    }
    a.tl__b:hover .tl__t, button.tl__b:hover .tl__t { color: var(--blue); }
    .tl__top { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
    .tl__t { font-weight: 650; font-size: 14px; line-height: 1.35; min-width: 0; }
    .tl__top > :last-child { flex: none; }
    .tl__m { display: block; font-size: 12.5px; color: var(--ink-2); margin-top: 1px; }
    .is-done .tl__t { color: var(--ink-2); text-decoration: line-through; text-decoration-color: var(--ink-3); }
    .is-done .tl__ic b { background: var(--fill); color: var(--ink-3); }
    .tl__none { padding: 0 0 12px 32px; }
    .tl__end { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 14px; }
    .tl__end i {
      width: 22px; height: 22px; border-radius: 50%; background: var(--red); color: #FFFFFF;
      display: grid; place-items: center; flex: none;
    }
  `],
})
export class TripCardComponent {
  protected readonly state = inject(AppStateService);

  readonly trip = input.required<Trip>();
  /** 'link': legs and the goal link to the trip; 'button': legs emit legPick; 'static': read only. */
  readonly mode = input<'link' | 'button' | 'static'>('static');
  readonly compact = input(false, { transform: booleanAttribute });

  readonly legPick = output<string>();
  readonly partyPick = output<void>();

  protected readonly cd = computed(() => countdown(this.trip(), this.state.nowMs()));
  protected readonly dates = computed(() => tripDatesLabel(this.trip(), this.state.timeFormat()));
  protected readonly partyText = computed(() => partyLabel(this.trip().party));
  protected readonly rows = computed(() => legRows(this.trip(), this.state.timeFormat()));
  protected readonly home = computed(() => homeLabel(this.trip()));
  protected readonly summary = computed(() => compactSummary(this.trip()));
  protected readonly tripLink = computed(() => tripPath(this.trip().id));

  protected legQuery(legId: string): Record<string, string> {
    return { ...this.state.globalParams(), ...tripQuery(null, legId) };
  }
}
