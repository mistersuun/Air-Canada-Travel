import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LEG_STATUS_LABEL, LegStatus } from '../model';

const TONE: Record<LegStatus, string> = {
  planned: 'ui-tag--neutral',
  listed: 'ui-tag--teal',
  checkedIn: 'ui-tag--blue',
  boarded: 'ui-tag--teal',
  notBoarded: 'ui-tag--neutral is-miss',
  didntTry: 'ui-tag--neutral',
  abandoned: 'ui-tag--neutral',
};

/**
 * A flight leg's state as the user set it (Planned, Listed, Checked in,
 * Boarded, Not boarded, Didn't try, Dropped). The text always carries the
 * meaning; colour only supports it.
 *
 *   <app-leg-status-tag [status]="leg.status" />
 */
@Component({
  selector: 'app-leg-status-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:inline-flex', '[attr.data-status]': 'status()' },
  template: `<span [class]="cls()">{{ label() }}</span>`,
  styles: [`.is-miss { color: var(--red-ink); background: var(--fill); }`],
})
export class LegStatusTagComponent {
  readonly status = input.required<LegStatus>();
  protected readonly label = computed(() => LEG_STATUS_LABEL[this.status()] ?? LEG_STATUS_LABEL.planned);
  protected readonly cls = computed(() => `ui-tag ${TONE[this.status()] ?? TONE.planned}`);
}
