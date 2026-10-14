import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LEG_STATUS_LABEL, type LegStatus } from '../../trips/model';
import { initials, nameHue } from '../group-doc';

/**
 * A friend as a small chip: initials on a colour taken from the name (no
 * images), optionally followed by their status ("Alex · boarded").
 */
@Component({
  selector: 'app-avatar-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="av" [class.is-bare]="!showName()" [attr.data-avatar]="name()">
      <i class="av__dot" aria-hidden="true" [style.--hue]="hue()">{{ ini() }}</i>
      @if (showName()) { <span class="av__t">{{ name() }}{{ status() ? ' · ' + statusLabel() : '' }}</span> }
      @else { <span class="ui-visually-hidden">{{ name() }}{{ status() ? ', ' + statusLabel() : '' }}</span> }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .av { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 2px 10px 2px 2px; border-radius: 14px; background: var(--fill); font-size: 13px; color: var(--ink); max-width: 100%; }
    .av.is-bare { padding: 0; background: none; }
    .av__dot {
      width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; flex: none;
      font: 650 11px/1 var(--sans); font-style: normal; color: #FFFFFF; background: hsl(var(--hue) 50% 36%);
      box-shadow: 0 0 0 2px var(--surface);
    }
    :host + :host .is-bare .av__dot { margin-left: -6px; }
    .av__t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `],
})
export class AvatarChipComponent {
  readonly name = input.required<string>();
  readonly status = input<LegStatus | null>(null);
  /** False: just the coloured initials (a row of overlapping avatars). */
  readonly showName = input(true);
  protected readonly ini = computed(() => initials(this.name()));
  protected readonly hue = computed(() => nameHue(this.name()));
  protected readonly statusLabel = computed(() => { const s = this.status(); return s ? LEG_STATUS_LABEL[s].toLowerCase() : ''; });
}
