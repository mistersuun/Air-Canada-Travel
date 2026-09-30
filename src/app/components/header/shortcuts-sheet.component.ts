import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, output, viewChild,
} from '@angular/core';
import { IconComponent } from '../shared/icons.component';

export const SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: ['/'], label: 'Search destinations' },
  { keys: ['←', '→'], label: 'Previous / next week' },
  { keys: ['1', '–', '7'], label: 'Pick Monday … Sunday' },
  { keys: ['0'], label: 'All week' },
  { keys: ['T'], label: 'Jump to today' },
  { keys: ['Esc'], label: 'Clear search / close' },
  { keys: ['?'], label: 'Show this list' },
];

/** Keyboard shortcuts reference ('?'), a small native dialog. */
@Component({
  selector: 'app-shortcuts-sheet',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="ui-sheet ks" aria-labelledby="ks-title" (close)="closed.emit()" (click)="onClick($event)">
      <div class="ui-sheet__grabber" aria-hidden="true"></div>
      <header class="ks__head">
        <h2 id="ks-title" class="ks__title">Keyboard shortcuts</h2>
        <button type="button" class="ui-icon-btn" (click)="close()" aria-label="Close shortcuts">
          <app-icon name="close" [size]="20" />
        </button>
      </header>
      <dl class="ks__list">
        @for (s of shortcuts; track s.label) {
          <div class="ks__row">
            <dt>@for (k of s.keys; track $index) { @if (k === '–') { <span class="ks__to">to</span> } @else { <kbd>{{ k }}</kbd> } }</dt>
            <dd>{{ s.label }}</dd>
          </div>
        }
      </dl>
    </dialog>
  `,
  styles: [`
    .ks { max-width: 420px; }
    .ks__head { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-2) 0 var(--space-5); }
    .ks__title { font-size: 18px; font-weight: 700; }
    .ks__list { padding: var(--space-2) var(--space-5) var(--space-5); display: grid; gap: var(--space-2); }
    .ks__row { display: flex; align-items: center; gap: var(--space-3); }
    .ks__row dt { display: flex; align-items: center; gap: 4px; min-width: 92px; }
    .ks__row dd { color: var(--ink-2); font-size: 14px; }
    .ks__to { font-size: 12px; color: var(--ink-3); }
    kbd {
      display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 7px;
      border: 1px solid var(--line-strong); border-bottom-width: 2px; background: var(--surface-2);
      font-family: var(--font-code); font-size: 12px; font-weight: 600; color: var(--ink);
    }
    @media (min-width: 720px) { .ks { width: min(420px, calc(100% - 48px)); } }
  `],
})
export class ShortcutsSheetComponent {
  readonly closed = output<void>();
  protected readonly shortcuts = SHORTCUTS;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    afterNextRender(() => {
      const d = this.dlg().nativeElement;
      if (!d.open) d.showModal();
    });
  }

  close(): void {
    this.dlg().nativeElement.close();
  }

  protected onClick(e: MouseEvent): void {
    if (e.target === this.dlg().nativeElement) this.close();
  }
}
