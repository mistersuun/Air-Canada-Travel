import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { StarredItem } from '../../state/app-state.service';
import { IconComponent } from '../shared/icons.component';

/** "Starred this week": one tappable ticket per favourite with its flying days. */
@Component({
  selector: 'app-starred-strip',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="st">
      <span class="ui-label st__title" id="st-title">Starred this week</span>
      <div class="ui-scroll-row st__row" role="list" aria-labelledby="st-title">
        @for (s of items(); track s.code) {
          <div role="listitem">
            <button type="button" class="st__item" (click)="open.emit(s.code)"
                    [attr.aria-label]="s.city + ', ' + (s.days ? (s.direct ? 'direct ' : 'connecting ') + s.days : 'no flights this week')">
              <app-icon name="star" [size]="13" [filled]="true" class="st__star" />
              <span class="st__code">{{ s.code }}</span>
              <span class="st__city">{{ s.city }}</span>
              @if (s.days) {
                <span class="st__days" [class.st__days--connect]="!s.direct">{{ s.days }}</span>
              } @else {
                <span class="st__none">No flights</span>
              }
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .st { display: flex; align-items: center; gap: var(--space-2); padding-left: var(--gutter); }
    .st__title { flex-shrink: 0; }
    .st__row { flex: 1; min-width: 0; padding-block: 2px; padding-left: var(--space-2); }
    .st__item {
      display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; white-space: nowrap;
      border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink);
      font-size: 13px; cursor: pointer; transition: border-color var(--dur-fast) var(--ease-out);
    }
    .st__item:hover { border-color: var(--line-strong); }
    .st__star { color: var(--warn-fill); }
    .st__code { font-family: var(--font-code); font-size: 12px; font-weight: 600; color: var(--ink-2); }
    .st__city { font-weight: 600; }
    .st__days { font-family: var(--font-code); font-size: 11px; font-weight: 600; color: var(--ok); }
    .st__days--connect { color: var(--connect); }
    .st__none { font-size: 12px; color: var(--ink-3); }
    @media (max-width: 520px) { .st__title { display: none; } .st__row { padding-left: 0; } .st { padding-left: 0; } }
  `],
})
export class StarredStripComponent {
  readonly items = input<readonly StarredItem[]>([]);
  readonly open = output<string>();
}
