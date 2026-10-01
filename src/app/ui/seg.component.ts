import { ChangeDetectionStrategy, booleanAttribute, Component, ElementRef, computed, input, model, viewChildren } from '@angular/core';
import { IconComponent, IconName } from '../components/shared/icons.component';

export interface SegOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: IconName;
}

/**
 * Segmented control (`.seg` in the mockup): a --fill (or glass) track with
 * the active option raised on --surface.
 *
 *   <app-seg [options]="[{value:'all',label:'Nonstop'},{value:'conn',label:'+ Connections'}]"
 *            [(value)]="mode" glass ariaLabel="Flights shown" />
 *
 * Each option is a toggle button with aria-pressed; ←/→ (and Home/End) move
 * the selection between enabled options.
 */
@Component({
  selector: 'app-seg',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-stretch]': 'stretch()',
    '[class.is-glass]': 'glass()',
    '[class.is-sm]': "size() === 'sm'",
  },
  template: `
    <div class="seg" [class.ui-glass]="glass()" role="group" [attr.aria-label]="ariaLabel() || null">
      @for (o of options(); track o.value) {
        <button #btn type="button" class="seg__b" [class.on]="o.value === value()"
                [attr.aria-pressed]="o.value === value()" [disabled]="o.disabled || null"
                [attr.tabindex]="$index === tabStop() ? 0 : -1"
                (click)="pick(o)" (keydown)="onKey($event, $index)">
          @if (o.icon) { <app-icon [name]="o.icon" [size]="16" /> }
          {{ o.label }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    :host(.is-stretch) { display: flex; width: 100%; }
    .seg {
      display: inline-flex; flex: 1; min-width: 0;
      background: var(--fill); border-radius: 11px; padding: 3px;
    }
    .seg.ui-glass { background: var(--glass); }
    .seg__b {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 7px 14px; border-radius: 8px;
      font-size: 13px; font-weight: 600; color: var(--ink-2); white-space: nowrap;
      transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
    }
    :host(.is-stretch) .seg__b { flex: 1; min-width: 0; padding-inline: 8px; }
    :host(.is-sm) .seg__b { padding: 5px 10px; font-size: 12.5px; }
    .seg__b:hover:not(:disabled):not(.on) { color: var(--ink); }
    .seg__b.on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
    .seg__b:disabled { opacity: .4; cursor: default; }
    .seg__b:focus-visible { outline-offset: 0; }
  `],
})
export class SegComponent {
  readonly options = input<readonly SegOption[]>([]);
  readonly value = model<string>();
  readonly glass = input(false, { transform: booleanAttribute });
  readonly stretch = input(false, { transform: booleanAttribute });
  readonly size = input<'sm' | 'md'>('md');
  readonly ariaLabel = input<string>('');

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('btn');

  /** The roving tab stop: the selected option, else the first enabled one. */
  protected readonly tabStop = computed(() => {
    const opts = this.options();
    const v = this.value();
    const i = opts.findIndex(o => o.value === v && !o.disabled);
    return i >= 0 ? i : opts.findIndex(o => !o.disabled);
  });

  protected pick(o: SegOption): void {
    if (o.disabled) return;
    this.value.set(o.value);
  }

  protected onKey(e: KeyboardEvent, i: number): void {
    const opts = this.options();
    let step = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step = -1;
    else if (e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation(); // the week strip's ←/→ shortcuts must not also fire
    let j = e.key === 'Home' ? -1 : e.key === 'End' ? opts.length : i;
    const dir = e.key === 'Home' ? 1 : e.key === 'End' ? -1 : step;
    for (let n = 0; n < opts.length; n++) {
      j = (j + dir + opts.length) % opts.length;
      if (!opts[j].disabled) break;
    }
    if (opts[j]?.disabled) return;
    this.value.set(opts[j].value);
    this.buttons()[j]?.nativeElement.focus();
  }
}
