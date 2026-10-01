import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { tripSharePath } from '../../extras/links';
import type { Trip } from '../../trips/model';

/**
 * Trip menu, under "Copy link" and "Calendar" (extras spec §2.2): a ghost
 * button "Share as image or text" that opens /trips/:id/share.
 */
@Component({
  selector: 'app-share-entry',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="ui-btn ui-btn--sm ui-btn--ghost se" [routerLink]="path()" data-share-entry>
      <app-icon name="share" [size]="16" /> Share as image or text
    </a>
  `,
  styles: [`
    :host { display: block; }
    .se { width: 100%; min-height: 44px; background: var(--surface); text-decoration: none; }
  `],
})
export class ShareEntryComponent {
  readonly trip = input.required<Trip>();
  protected readonly path = computed(() => tripSharePath(this.trip().id));
}
