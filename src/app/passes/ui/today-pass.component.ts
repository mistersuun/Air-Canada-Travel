import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { addPassPath, addPassQuery, passPath } from '../../extras/links';
import { AppStateService } from '../../state/app-state.service';
import { PassesService } from '../passes.service';

/**
 * Today, under the big flight card (extras spec §2.2): a dark 56px "Show
 * boarding pass" when this leg has a saved pass, else a ghost "Add boarding
 * pass". No booking code here.
 */
@Component({
  selector: 'app-today-pass',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (first(); as p) {
      <a class="ui-btn ui-btn--dark tp tp--show" [routerLink]="passLink(p.id)" [queryParams]="state.globalParams()" data-show-pass>
        <app-icon name="barcode" [size]="20" [strokeWidth]="2" />
        <span>Show boarding pass</span>
        @if (meta(); as m) { <small class="tn">{{ m }}</small> }
      </a>
    } @else {
      <a class="ui-btn ui-btn--ghost tp" [routerLink]="addLink()" [queryParams]="addQuery()" data-add-pass>
        <app-icon name="barcode" [size]="18" [strokeWidth]="2" />Add boarding pass
      </a>
    }
  `,
  styles: [`
    :host { display: block; margin-top: 14px; }
    .tp { width: 100%; min-height: 52px; border-radius: 16px; font-size: 15px; }
    .tp--show { min-height: 56px; font-size: 16px; }
    .tp small { font-size: 13px; font-weight: 500; opacity: .75; }
  `],
})
export class TodayPassComponent {
  private readonly passes = inject(PassesService);
  protected readonly state = inject(AppStateService);

  readonly tripId = input.required<string>();
  readonly legId = input.required<string>();

  protected readonly list = computed(() => this.passes.forLeg(this.tripId(), this.legId()));
  protected readonly first = computed(() => this.list()[0] ?? null);
  /** '· 2 passes' or '· seat 34K'. */
  protected readonly meta = computed(() => {
    const l = this.list();
    if (l.length > 1) return `· ${l.length} passes`;
    return l[0]?.seat ? `· seat ${l[0].seat}` : null;
  });
  protected readonly addLink = computed(() => addPassPath(this.tripId()));
  protected readonly addQuery = computed(() => ({ ...this.state.globalParams(), ...addPassQuery(this.legId()) }));

  constructor() {
    void this.passes.ensureReady();
  }

  protected passLink(id: string): string[] {
    return passPath(this.tripId(), id);
  }
}
