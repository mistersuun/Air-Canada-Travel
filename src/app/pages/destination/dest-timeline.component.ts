import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { t } from '../../i18n/t';
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
        @for (row of items(); track key(row); let first = $first) {
          <li>
            @if (linked()) {
              <a class="ui-tl__it" [class.ui-tl__it--now]="first"
                 [routerLink]="path(row)" [queryParams]="state.globalParams()">
                <div class="d">{{ row.dateLabel }}</div>
                <div class="x"><b>{{ row.time }}</b><span>{{ row.detail }}</span></div>
                <div class="ui-sub tn">{{ row.sub }}@for (r of tags(row); track $index) { <span class="ui-tag ui-tag--blue you" data-you><span aria-hidden="true">{{ r.text }}</span><span class="ui-visually-hidden">{{ r.aria }}</span></span> }</div>
              </a>
            } @else {
              <div class="ui-tl__it" [class.ui-tl__it--now]="first">
                <div class="d">{{ row.dateLabel }}</div>
                <div class="x"><b>{{ row.time }}</b><span>{{ row.detail }}</span></div>
                <div class="ui-sub tn">{{ row.sub }}@for (r of tags(row); track $index) { <span class="ui-tag ui-tag--blue you" data-you><span aria-hidden="true">{{ r.text }}</span><span class="ui-visually-hidden">{{ r.aria }}</span></span> }</div>
              </div>
            }
          </li>
        }
      </ol>
      @if (more()) {
        <button type="button" class="ui-link more" (click)="showMore.emit()">{{ t('dest.showMore') }}</button>
      }
    } @else {
      <ng-content />
    }
  `,
  styles: [`
    :host { display: block; }
    li { list-style: none; }
    .you { margin-left: 8px; }
    .more { display: inline-block; margin: 6px 0 0 26px; font-size: 13.5px; padding: 12px 0; }
  `],
})
export class DestTimelineComponent {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);

  readonly items = input<readonly TimelineItem[]>([]);
  readonly code = input<string>('');
  readonly linked = input(false, { transform: booleanAttribute });
  readonly more = input(false, { transform: booleanAttribute });
  readonly label = input<string>('');
  /** 'you: 3/4' tags (your own saved outcomes) per row, keyed by itinKey. */
  readonly records = input<Readonly<Record<string, readonly { text: string; aria: string }[]>>>({});

  readonly showMore = output<void>();

  protected key(row: TimelineItem): string {
    return itinKey(row.it);
  }

  protected tags(row: TimelineItem): readonly { text: string; aria: string }[] {
    return this.records()[itinKey(row.it)] ?? [];
  }

  protected path(row: TimelineItem): string[] {
    return flightPath(this.code(), row.it.dateKey, row.it);
  }
}
