import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { t } from '../../i18n/t';

/** One half of the bar's first row: a picked flight, or how many there are to pick from. */
export interface PlanBarSide {
  /** The picked flight ('AC834') and its departure ('22:10'), else null. */
  picked: { flight: string; time: string } | null;
  /** Rows to pick from (shown as 'pick one (3)'); null when there is no day to pick on yet. */
  count: number | null;
}

/**
 * The round trip's sticky bar (dates-spec §3.2.7): 'Out · AC834 22:10' |
 * 'Home · pick one (3)' (each scrolls to its section), then Start a trip /
 * Add to <trip>. An unpicked side has a dashed border and says "pick one", so
 * the state never rests on colour. The button is aria-disabled (it stays in
 * the tab order) until a flight out is picked, and says why
 * (aria-describedby): no flight out yet, or trips are read-only here.
 */
@Component({
  selector: 'app-plan-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pb ui-glass" role="region" [attr.aria-label]="t('planner.plan.barAria')">
      <div class="pb__row">
        <button type="button" class="pb__s tn" data-side="out" [class.is-open]="!out().picked" (click)="goOut.emit()"
                [attr.aria-label]="out().picked ? null : t('planner.plan.barOutPickAria', { n: out().count ?? 0 })">
          @let o = out().picked;
          {{ o ? t('planner.plan.barOut', o) : t('planner.plan.barOutPick', { n: out().count ?? 0 }) }}
        </button>
        <button type="button" class="pb__s tn" data-side="home" [class.is-open]="!home().picked" (click)="goHome.emit()"
                [attr.aria-label]="home().picked || home().count === null ? null : t('planner.plan.barHomePickAria', { n: home().count ?? 0 })">
          @let h = home().picked;
          @let hn = home().count;
          {{ h ? t('planner.plan.barHome', h) : hn === null ? t('planner.plan.barHomeNoDay') : t('planner.plan.barHomePick', { n: hn }) }}
        </button>
      </div>
      <button type="button" class="ui-btn ui-btn--block pb__go" data-start [class.is-off]="disabled()"
              [attr.aria-disabled]="disabled() ? 'true' : null"
              [attr.aria-describedby]="disabled() && reason() ? 'pb-need' : null" (click)="go()">
        {{ label() }}
      </button>
      @if (disabled() && reason(); as r) { <span id="pb-need" class="pb__why">{{ r }}</span> }
    </div>
  `,
  styles: [`
    :host {
      position: fixed; z-index: 25; left: 0; right: 0; bottom: 0;
      display: flex; justify-content: center; pointer-events: none;
    }
    .pb {
      pointer-events: auto; width: 100%; max-width: 480px; display: grid; gap: 6px;
      padding: 8px 16px calc(8px + env(safe-area-inset-bottom));
      border-radius: 20px 20px 0 0; box-shadow: var(--shadow-l);
    }
    .pb__row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pb__s {
      min-height: 44px; min-width: 0; padding: 6px 10px; border-radius: 12px; background: var(--fill);
      border: 1px solid transparent; color: var(--ink); font-size: 13.5px; font-weight: 600; line-height: 1.25;
      text-align: center; overflow-wrap: anywhere;
    }
    .pb__s.is-open { background: transparent; border: 1px dashed var(--ink-2); color: var(--ink-2); }
    .pb__go { min-height: 44px; padding: 11px 16px; font-size: 15px; }
    .pb__go.is-off { opacity: .5; cursor: default; }
    .pb__why { font-size: 12px; color: var(--ink-2); text-align: center; margin-top: -2px; }
    @media (min-width: 720px) { .pb { margin-bottom: 12px; border-radius: 20px; } }
  `],
})
export class PlanBarComponent {
  protected readonly t = t;

  readonly out = input.required<PlanBarSide>();
  readonly home = input.required<PlanBarSide>();
  /** 'Start a trip' or 'Add to Lisbon trip'. */
  readonly label = input.required<string>();
  readonly disabled = input(false);
  /** Why the button can't run yet ('Pick a flight out first'), shown under it and read with it. */
  readonly reason = input<string | null>(null);

  readonly goOut = output<void>();
  readonly goHome = output<void>();
  readonly start = output<void>();

  /** The button stays focusable while aria-disabled, so a tap there does nothing. */
  protected go(): void {
    if (!this.disabled()) this.start.emit();
  }
}
