import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { findDestination } from '../../utils/airports';
import { regionVar } from '../../utils/region-color';
import type { OptionRow } from './flight-model';

/**
 * One itinerary as a list row (`.row` with a `.mono-thumb` in the mockup):
 * a monogram tile with the hub (or destination) code, 'Via Toronto' /
 * 'Nonstop' with the elapsed time, and the flights and times. It is a link
 * to that flight's page, or, with `selectable`, a toggle button (return pick).
 */
@Component({
  selector: 'app-option-row',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = row();
    @if (selectable()) {
      <button type="button" class="row" [class.is-sel]="selected()" [attr.aria-pressed]="selected()" (click)="pick.emit()">
        <span class="th ui-mono" [style.--mono]="tint()" aria-hidden="true">{{ r.tile }}</span>
        <span class="tx">
          <span class="nm">{{ r.name }}<small>{{ r.small }}</small></span>
          <span class="tm tn">{{ r.meta }}</span>
        </span>
        <span class="tick" aria-hidden="true">
          @if (selected()) {
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>
          }
        </span>
      </button>
    } @else {
      <a class="row" [routerLink]="link()" [queryParams]="queryParams()" [replaceUrl]="replaceUrl()">
        <span class="th ui-mono" [style.--mono]="tint()" aria-hidden="true">{{ r.tile }}</span>
        <span class="tx">
          <span class="nm">{{ r.name }}<small>{{ r.small }}</small></span>
          <span class="tm tn">{{ r.meta }}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </a>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; contain: inline-size; border-bottom: 1px solid var(--hair); }
    :host(:last-child) { border-bottom: 0; }
    .row { display: flex; align-items: center; gap: 14px; padding: 12px 0; width: 100%; color: var(--ink); text-align: left; min-width: 0; }
    a.row:hover .nm, button.row:hover .nm { color: var(--blue); }
    .row:focus-visible { outline-offset: -2px; border-radius: 12px; }
    .th { width: 44px; height: 44px; flex: none; border-radius: var(--radius-thumb, 12px); }
    .tx { flex: 1; min-width: 0; display: block; }
    .nm, .tm { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nm { font-weight: 600; font-size: 15px; }
    .nm small { font-weight: 500; color: var(--ink-3); font-size: 12px; margin-left: 6px; }
    .tm { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; }
    .chev { color: var(--ink-3); font-size: 18px; line-height: 1; margin-left: 8px; flex: none; }
    .tick {
      width: 22px; height: 22px; flex: none; border-radius: 50%; display: grid; place-items: center;
      border: 2px solid var(--hair); color: #fff;
    }
    .is-sel .tick { background: var(--red); border-color: var(--red); }
  `],
})
export class OptionRowComponent {
  readonly row = input.required<OptionRow>();
  readonly link = input<readonly unknown[] | null>(null);
  readonly queryParams = input<Params | null>(null);
  readonly replaceUrl = input(false);
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly pick = output<void>();

  /** The tile takes the destination's region colour. */
  protected readonly tint = computed(() => {
    const it = this.row().it;
    return regionVar((findDestination(it.dest) ?? findDestination(it.origin))?.region);
  });
}
