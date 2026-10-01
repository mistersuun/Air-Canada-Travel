import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PROVENANCE_LABEL, Provenance } from '../model';

const TONE: Record<Provenance, string> = {
  scheduled: 'ui-tag--teal', estimated: 'ui-tag--neutral', saved: 'ui-tag--blue', unknown: 'ui-tag--amber',
};

/**
 * Where a fact comes from: Scheduled (found in the current schedules),
 * Estimated (our heuristic or corridor table), Saved by you, or Unknown.
 *
 *   <app-provenance-tag [value]="leg.provenance" />
 */
@Component({
  selector: 'app-provenance-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:inline-flex', '[attr.data-provenance]': 'value()' },
  template: `<span [class]="cls()">{{ label() }}</span>`,
})
export class ProvenanceTagComponent {
  readonly value = input.required<Provenance>();
  protected readonly label = computed(() => PROVENANCE_LABEL[this.value()] ?? PROVENANCE_LABEL.unknown);
  protected readonly cls = computed(() => `ui-tag ${TONE[this.value()] ?? TONE.unknown}`);
}
