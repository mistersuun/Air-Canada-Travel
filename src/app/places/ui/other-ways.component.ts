import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { LegEnd } from '../../trips/model';
import { otherWays } from '../other-ways';

/**
 * "Other ways there": plain search links (Busbud, FlixBus, Omio, Rome2Rio,
 * Kiwi.com) for the distance still to go, pre-filled with the places and the
 * date. Facts only: no prices, no odds; the sites open in a new tab.
 */
@Component({
  selector: 'app-other-ways',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ow" data-other-ways>
      <h2 class="ui-h3 ow__h">{{ heading() }}</h2>
      <ul class="ow__list">
        @for (w of ways(); track w.id) {
          <li><a class="ui-link" [href]="w.href" target="_blank" rel="noopener noreferrer" [attr.data-way]="w.id">{{ w.label }}</a></li>
        }
      </ul>
      <p class="ow__foot">Opens other sites in a new tab. We do not show prices or availability.</p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ow__h { margin: 22px 2px 10px; font-size: 19px; }
    .ow__list { list-style: none; margin: 0; padding: 4px 14px; border-radius: var(--radius-card); background: var(--fill); }
    .ow__list li { border-bottom: 1px solid var(--hair); }
    .ow__list li:last-child { border-bottom: 0; }
    .ow__list a { display: flex; align-items: center; min-height: 44px; font-size: 14.5px; }
    .ow__foot { margin: 8px 2px 0; font-size: 12px; color: var(--ink-3); }
  `],
})
export class OtherWaysComponent {
  readonly from = input.required<LegEnd>();
  readonly to = input.required<LegEnd>();
  /** Local date at `from` ('2026-10-09'). */
  readonly dateKey = input.required<string>();
  /** False when no ground route exists (hides the bus and train sites). */
  readonly land = input<boolean>(true);
  /** Airport to search flights to (Kiwi.com). */
  readonly toAirport = input<string | undefined>(undefined);
  readonly heading = input<string>('Other ways there');

  protected readonly ways = computed(() =>
    otherWays({ from: this.from(), to: this.to(), dateKey: this.dateKey(), land: this.land(), toAirport: this.toAirport() }));
}
