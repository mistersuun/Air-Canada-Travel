import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { GlassSheetComponent } from '../ui/glass-sheet.component';

export const SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: ['/'], label: 'Search' },
  { keys: ['←', '→'], label: 'Previous / next week (Explore)' },
  { keys: ['1', '–', '7'], label: 'Pick Monday … Sunday (Explore)' },
  { keys: ['0'], label: 'All week (Explore)' },
  { keys: ['T'], label: 'Jump to today (Explore)' },
  { keys: ['Esc'], label: 'Back / close' },
  { keys: ['?'], label: 'Show this list' },
];

/** Keyboard shortcuts reference ('?'). Rendered with @if; emits (closed) when dismissed. */
@Component({
  selector: 'app-shortcuts-sheet',
  standalone: true,
  imports: [GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet title="Keyboard shortcuts" [open]="true" (closed)="closed.emit()">
      <dl class="ks">
        @for (s of shortcuts; track s.label) {
          <div class="ks__row">
            <dt>@for (k of s.keys; track $index) { @if (k === '–') { <span class="ks__to">to</span> } @else { <kbd>{{ k }}</kbd> } }</dt>
            <dd>{{ s.label }}</dd>
          </div>
        }
      </dl>
    </app-glass-sheet>
  `,
  styles: [`
    .ks { display: grid; gap: 10px; }
    .ks__row { display: flex; align-items: center; gap: 12px; }
    .ks__row dt { display: flex; align-items: center; gap: 4px; min-width: 92px; }
    .ks__row dd { color: var(--ink-2); font-size: 14px; }
    .ks__to { font-size: 12px; color: var(--ink-3); }
    kbd {
      display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 8px;
      background: var(--fill); border: 1px solid var(--hair);
      font: 600 12px var(--sans); color: var(--ink);
    }
  `],
})
export class ShortcutsSheetComponent {
  readonly closed = output<void>();
  protected readonly shortcuts = SHORTCUTS;
}
