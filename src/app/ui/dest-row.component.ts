import { ChangeDetectionStrategy, booleanAttribute, Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Params, RouterLink } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { findDestination } from '../utils/airports';
import { regionVar } from '../utils/region-color';
import { DestPhotoComponent } from './dest-photo.component';
import { DotDay, DotRowComponent } from './dot-row.component';

/**
 * A destination list row (`.row` in the mockup): 44px thumb, name with a
 * small code (or distance), a meta line, optional week dots, trailing
 * content and a chevron. The whole row is one link when `link` is set.
 *
 *   <app-dest-row code="LIS" name="Lisbon" small="LIS" meta="21:45 → 09:20⁺¹ · 6h35 · AC812"
 *                 [link]="destPath('LIS')" [dots]="dots" [selectedDay]="2">
 *     <span trailing class="ui-tag ui-tag--amber">Ends Oct 22</span>
 *   </app-dest-row>
 *
 * Buttons projected as [trailing] should call $event.preventDefault() and
 * stopPropagation() so they do not follow the row link. `queryParams`
 * defaults to the global params (hub, week, day, region, q).
 */
@Component({
  selector: 'app-dest-row',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, DestPhotoComponent, DotRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-hl]': 'highlight()' },
  template: `
    <ng-template #body>
      @if (thumb() === 'photo') {
        <app-dest-photo class="th" [code]="code()" size="thumb" />
      } @else {
        <span class="th ui-mono" [style.--mono]="tint()">{{ code() }}</span>
      }
      <div class="tx">
        <div class="nm">{{ displayName() }}@if (small()) {<small>{{ small() }}</small>}</div>
        @if (meta()) { <div class="tm tn">{{ meta() }}</div> }
      </div>
      @if (dots(); as d) { <app-dot-row class="dots" [days]="d" [selected]="selectedDay()" /> }
      <ng-content select="[trailing]" />
      @if (chevron()) { <span class="chev" aria-hidden="true">›</span> }
    </ng-template>

    @if (link(); as l) {
      <a class="row" [routerLink]="l" [queryParams]="params()"><ng-container [ngTemplateOutlet]="body" /></a>
    } @else {
      <div class="row"><ng-container [ngTemplateOutlet]="body" /></div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; contain: inline-size; border-bottom: 1px solid var(--hair); }
    :host(:last-child), :host(.is-last) { border-bottom: 0; }
    .row { display: flex; align-items: center; gap: 14px; padding: 12px 0; color: var(--ink); min-width: 0; }
    a.row:hover .nm { color: var(--blue); }
    a.row:focus-visible { outline-offset: -2px; border-radius: 12px; }
    .th { width: 44px; height: 44px; flex: none; border-radius: var(--radius-thumb); }
    .tx { flex: 1; min-width: 0; }
    .nm, .tm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nm { font-weight: 600; font-size: 15px; }
    .nm small { font-weight: 500; color: var(--ink-3); font-size: 12px; margin-left: 6px; }
    .tm { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; }
    .dots { margin-left: auto; }
    .chev { color: var(--ink-3); font-size: 18px; line-height: 1; margin-left: 8px; flex: none; }
    :host(.is-hl) { border-bottom-color: transparent; }
    :host(.is-hl) .row {
      background: color-mix(in srgb, var(--red) 7%, transparent);
      margin: 0 -10px; padding: 12px 10px; border-radius: 14px;
    }
    @media (max-width: 719px) { app-dot-row { gap: 3px; } }
  `],
})
export class DestRowComponent {
  private readonly state = inject(AppStateService);

  readonly code = input.required<string>();
  /** Defaults to the destination's city. */
  readonly name = input<string | null>(null);
  /** Text after the name (the code, a distance, 'via YYZ'). */
  readonly small = input<string | null>(null);
  readonly meta = input<string | null>(null);
  readonly link = input<string | readonly unknown[] | null>(null);
  /** Defaults to the global params. */
  readonly queryParams = input<Params | null | undefined>(undefined);
  readonly dots = input<readonly DotDay[] | null>(null);
  readonly selectedDay = input<number | null>(null);
  readonly highlight = input(false, { transform: booleanAttribute });
  readonly chevron = input(true, { transform: booleanAttribute });
  readonly thumb = input<'photo' | 'mono'>('photo');

  protected readonly displayName = computed(() => this.name() ?? findDestination(this.code())?.city ?? this.code());
  protected readonly tint = computed(() => regionVar(findDestination(this.code())?.region));
  protected readonly params = computed(() => this.queryParams() ?? this.state.globalParams());
}
