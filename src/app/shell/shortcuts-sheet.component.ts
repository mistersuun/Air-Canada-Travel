import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { GlassSheetComponent } from '../ui/glass-sheet.component';
import { MsgKey, t } from '../i18n/t';

export const SHORTCUTS: readonly { keys: string[]; label: MsgKey }[] = [
  { keys: ['/'], label: 'shell.shortcuts.search' },
  { keys: ['←', '→'], label: 'shell.shortcuts.week' },
  { keys: ['1', '–', '7'], label: 'shell.shortcuts.day' },
  { keys: ['0'], label: 'shell.shortcuts.allWeek' },
  { keys: ['T'], label: 'shell.shortcuts.today' },
  { keys: ['Esc'], label: 'shell.shortcuts.back' },
  { keys: ['?'], label: 'shell.shortcuts.help' },
];

/** Keyboard shortcuts reference ('?'). Rendered with @if; emits (closed) when dismissed. */
@Component({
  selector: 'app-shortcuts-sheet',
  standalone: true,
  imports: [GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet [title]="t('shell.shortcuts.title')" [open]="true" (closed)="closed.emit()">
      <dl class="ks">
        @for (s of shortcuts; track s.label) {
          <div class="ks__row">
            <dt>@for (k of s.keys; track $index) { @if (k === '–') { <span class="ks__to">{{ t('shell.shortcuts.to') }}</span> } @else { <kbd>{{ k }}</kbd> } }</dt>
            <dd>{{ t(s.label) }}</dd>
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
  protected readonly t = t;
}
