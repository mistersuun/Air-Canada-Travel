import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Trip } from '../../trips/model';

/**
 * Trip menu: "Share as image or text" (extras spec §2.2).
 * Phase 0 placeholder (owner: SS): renders nothing and never throws.
 */
@Component({
  selector: 'app-share-entry',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class ShareEntryComponent {
  readonly trip = input.required<Trip>();
}
