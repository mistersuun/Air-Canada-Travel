import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { addPassPath, addPassQuery, passPath } from '../../extras/links';
import { AppStateService } from '../../state/app-state.service';
import type { Trip, TripLeg } from '../../trips/model';
import { PassesService } from '../passes.service';

/** '2 passes · seat 34K, 34J', '1 pass · seat 34K', '1 pass'. */
export function legPassesMeta(seats: readonly (string | null)[]): string {
  const n = seats.length;
  const s = seats.filter((x): x is string => !!x);
  return `${n} ${n === 1 ? 'pass' : 'passes'}${s.length ? ` · seat ${s.join(', ')}` : ''}`;
}

/**
 * The leg sheet's boarding pass row (extras spec §2.2): "Show boarding pass"
 * with the count and seats when the leg has passes, else "Add boarding pass".
 * Flight legs only. No booking code here.
 */
@Component({
  selector: 'app-leg-passes',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isFlight()) {
      @if (list().length) {
        <a class="lp lp--show" [routerLink]="showLink()" [queryParams]="state.globalParams()" data-show-pass>
          <span class="lp__ic" aria-hidden="true"><app-icon name="barcode" [size]="18" [strokeWidth]="2" /></span>
          <span class="lp__tx">
            <b>Show boarding pass</b>
            <span class="lp__meta"><small class="tn">{{ meta() }}</small><span class="lp__lock"><app-icon name="lock" [size]="12" [strokeWidth]="2.2" />Not shared</span></span>
          </span>
          <app-icon class="lp__chev" name="chevron-right" [size]="16" />
        </a>
        <a class="ui-link lp__more" [routerLink]="addLink()" [queryParams]="addQuery()" data-add-another>Add another pass</a>
      } @else {
        <a class="ui-btn ui-btn--ghost ui-btn--block lp__add" [routerLink]="addLink()" [queryParams]="addQuery()" data-add-pass>
          <app-icon name="barcode" [size]="16" [strokeWidth]="2" />Add boarding pass
        </a>
      }
    }
  `,
  styles: [`
    :host { display: grid; gap: 6px; }
    :host:empty { display: none; }
    .lp {
      display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 12px; border-radius: 16px;
      background: var(--fill); color: var(--ink);
    }
    .lp:hover { background: color-mix(in srgb, var(--ink) 6%, var(--fill)); }
    .lp__ic {
      width: 36px; height: 36px; border-radius: 11px; flex: none; display: grid; place-items: center;
      background: var(--ink); color: var(--bg);
    }
    .lp__tx { flex: 1; min-width: 0; display: grid; }
    .lp__tx b { font-size: 15px; font-weight: 650; }
    .lp__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 2px; }
    .lp__meta small { font-size: 12.5px; color: var(--ink-2); }
    .lp__lock {
      display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: 11px; font-weight: 600;
      padding: 2px 7px; border-radius: var(--radius-tag); background: color-mix(in srgb, var(--teal) 13%, transparent); color: var(--teal-ink);
    }
    .lp__chev { color: var(--ink-3); flex: none; }
    .lp__more { justify-self: start; display: inline-flex; align-items: center; min-height: 36px; font-size: 13.5px; }
    .lp__add { min-height: 44px; }
  `],
})
export class LegPassesComponent {
  private readonly passes = inject(PassesService);
  protected readonly state = inject(AppStateService);

  readonly trip = input.required<Trip>();
  readonly leg = input.required<TripLeg>();

  protected readonly isFlight = computed(() => this.leg().kind === 'flight');
  protected readonly list = computed(() => this.passes.forLeg(this.trip().id, this.leg().id));
  protected readonly meta = computed(() => legPassesMeta(this.list().map(p => p.seat)));
  protected readonly showLink = computed(() => {
    const p = this.list()[0];
    return p ? passPath(this.trip().id, p.id) : [];
  });
  protected readonly addLink = computed(() => addPassPath(this.trip().id));
  protected readonly addQuery = computed(() => ({ ...this.state.globalParams(), ...addPassQuery(this.leg().id) }));

  constructor() {
    void this.passes.ensureReady();
  }
}
