import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../state/app-state.service';
import { flightPath } from '../../ui/links';
import { itinKey } from '../../ui/format';
import type { TimelineItem } from './dest-model';

/**
 * The destination page's departures timeline (`.ui-tl`): a rail with one
 * node per departure, the first one lit as "now". With `linked`, every item
 * opens its flight page (/flight/CODE/DATE/SLUG).
 */
@Component({
  selector: 'app-dest-timeline',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <ol class="ui-tl" [attr.aria-label]="label() || null">
        @for (t of items(); track key(t); let first = $first) {
          <li>
            @if (linked()) {
              <a class="ui-tl__it" [class.ui-tl__it--now]="first"
                 [routerLink]="path(t)" [queryParams]="state.globalParams()">
                <div class="d">{{ t.dateLabel }}</div>
                <div class="x"><b>{{ t.time }}</b><span>{{ t.detail }}</span></div>
                <div class="ui-sub tn">{{ t.sub }}</div>
              </a>
            } @else {
              <div class="ui-tl__it" [class.ui-tl__it--now]="first">
                <div class="d">{{ t.dateLabel }}</div>
                <div class="x"><b>{{ t.time }}</b><span>{{ t.detail }}</span></div>
                <div class="ui-sub tn">{{ t.sub }}</div>
              </div>
            }
          </li>
        }
      </ol>
      @if (more()) {
        <button type="button" class="ui-link more" (click)="showMore.emit()">Show more</button>
      }
    } @else {
      <ng-content />
    }
  `,
  styles: [`
    :host { display: block; }
    li { list-style: none; }
    .more { display: inline-block; margin: 6px 0 0 26px; font-size: 13.5px; padding: 4px 0; }
  `],
})
export class DestTimelineComponent {
  protected readonly state = inject(AppStateService);

  readonly items = input<readonly TimelineItem[]>([]);
  readonly code = input<string>('');
  readonly linked = input(false, { transform: booleanAttribute });
  readonly more = input(false, { transform: booleanAttribute });
  readonly label = input<string>('');

  readonly showMore = output<void>();

  protected key(t: TimelineItem): string {
    return itinKey(t.it);
  }

  protected path(t: TimelineItem): string[] {
    return flightPath(this.code(), t.it.dateKey, t.it);
  }
}
