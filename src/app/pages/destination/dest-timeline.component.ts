import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input, output } from '@angular/core';
import { RouterLink, type Params } from '@angular/router';
import { t } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';
import { flightPath } from '../../ui/links';
import { itinKey } from '../../ui/format';
import type { TimelineItem } from './dest-model';

/** Where a timeline row opens: a route and its own query params (the global ones are added). */
export interface TimelineLink {
  path: string[];
  params: Params;
}

/**
 * The destination page's timeline (`.ui-tl`): a rail with one node per
 * flight, the first one lit as "now". With `linked`, every item opens its
 * flight page (/flight/CODE/DATE/SLUG); `linkFor` overrides that per row
 * (the round-trip page once dates are set) and a null from it leaves the row
 * unlinked. `stayTag` adds a tag to a row ('8 nights').
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
            @let to = link(row);
            @let stay = stayTag()?.(row) ?? null;
            @if (to) {
              <a class="ui-tl__it" [class.ui-tl__it--now]="first"
                 [routerLink]="to.path" [queryParams]="params(to)">
                <div class="d">{{ row.dateLabel }}@if (stay) { <span class="ui-tag ui-tag--blue stay tn" data-stay>{{ stay }}</span> }</div>
                <div class="x"><b>{{ row.time }}</b><span>{{ row.detail }}</span></div>
                <div class="ui-sub tn">{{ row.sub }}@for (r of tags(row); track $index) { <span class="ui-tag ui-tag--blue you" data-you><span aria-hidden="true">{{ r.text }}</span><span class="ui-visually-hidden">{{ r.aria }}</span></span> }</div>
              </a>
            } @else {
              <div class="ui-tl__it" [class.ui-tl__it--now]="first">
                <div class="d">{{ row.dateLabel }}@if (stay) { <span class="ui-tag ui-tag--blue stay tn" data-stay>{{ stay }}</span> }</div>
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
    .you, .stay { margin-left: 8px; }
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
  /** Per-row link (null: unlinked); when unset, `linked` rows open their flight page. */
  readonly linkFor = input<((row: TimelineItem) => TimelineLink | null) | null>(null);
  /** Per-row stay tag ('8 nights'), or null for none. */
  readonly stayTag = input<((row: TimelineItem) => string | null) | null>(null);
  readonly records = input<Readonly<Record<string, readonly { text: string; aria: string }[]>>>({});

  readonly showMore = output<void>();

  protected key(row: TimelineItem): string {
    return itinKey(row.it);
  }

  protected tags(row: TimelineItem): readonly { text: string; aria: string }[] {
    return this.records()[itinKey(row.it)] ?? [];
  }

  protected link(row: TimelineItem): TimelineLink | null {
    const fn = this.linkFor();
    if (fn) return fn(row);
    return this.linked() ? { path: flightPath(this.code(), row.it.dateKey, row.it), params: {} } : null;
  }

  protected params(to: TimelineLink): Params {
    return { ...this.state.globalParams(), ...to.params };
  }
}
