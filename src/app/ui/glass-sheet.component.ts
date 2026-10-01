import {
  ChangeDetectionStrategy, Component, DOCUMENT, ElementRef, afterRenderEffect, inject, input, model, output, signal, untracked,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../components/shared/icons.component';

/** Drag distance (px) that closes the bottom sheet. */
export const SHEET_DRAG_CLOSE_PX = 120;

let nextId = 0;

/**
 * Modal sheet on a native <dialog> (showModal: focus trap, Esc, inert page).
 * Under 720px it is a bottom sheet with a handle (drag down 120px to close);
 * from 720px a centred 440px card. Backdrop clicks close it; focus returns to
 * the element that opened it.
 *
 *   <app-glass-sheet title="Filters" [(open)]="filtersOpen" (closed)="…">…</app-glass-sheet>
 *
 * Render it permanently and toggle `open`, or render it with @if and
 * `[open]="true"` and remove it on (closed).
 */
@Component({
  selector: 'app-glass-sheet',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="gs" [attr.aria-labelledby]="titleId" (close)="onClose()" (cancel)="onCancel($event)"
            (click)="onBackdrop($event)" [style.--drag.px]="drag()">
      <div class="gs__handle" aria-hidden="true"
           (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)"
           (pointerup)="dragEnd()" (pointercancel)="dragEnd(true)"></div>
      <header class="gs__head">
        <h2 class="gs__title ui-h3" [id]="titleId">{{ title() }}</h2>
        <button type="button" class="ui-circ ui-circ--glass gs__x" (click)="close()" [attr.aria-label]="'Close ' + title().toLowerCase()">
          <app-icon name="close" [size]="18" [strokeWidth]="2" />
        </button>
      </header>
      <div class="gs__body"><ng-content /></div>
    </dialog>
  `,
  styles: [`
    .gs {
      --drag: 0px;
      margin: auto auto 0; width: 100%; max-width: 100%; max-height: 92dvh;
      border: 1px solid var(--glass-b); border-bottom: 0;
      border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
      background: var(--surface); color: var(--ink);
      box-shadow: var(--shadow-l);
      padding: 10px 0 env(safe-area-inset-bottom);
      overflow: auto; overscroll-behavior: contain;
      transform: translateY(var(--drag));
    }
    @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .gs {
        background: color-mix(in srgb, var(--surface) 88%, transparent);
        -webkit-backdrop-filter: blur(24px) saturate(1.4);
        backdrop-filter: blur(24px) saturate(1.4);
      }
    }
    .gs::backdrop { background: var(--backdrop); }
    .gs[open] { animation: ui-sheet-up var(--dur) var(--ease-out); }
    .gs__handle {
      width: 36px; height: 5px; margin: 0 auto 6px; border-radius: 3px; background: var(--hair);
      touch-action: none; cursor: grab; position: relative;
    }
    .gs__handle::after { content: ''; position: absolute; inset: -14px -40px; }
    .gs__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 16px 6px 20px; }
    .gs__title { margin: 0; }
    .gs__x { width: 36px; height: 36px; }
    .gs__body { padding: 6px 20px 20px; }
    @media (min-width: 720px) {
      .gs {
        margin: auto; width: min(440px, calc(100% - 48px)); max-height: 86dvh;
        border-radius: var(--radius-card); border: 1px solid var(--glass-b);
        padding-top: 14px; transform: none;
      }
      .gs[open] { animation: ui-fade-in var(--dur) var(--ease-out); }
      .gs__handle { display: none; }
    }
  `],
})
export class GlassSheetComponent {
  private readonly doc = inject(DOCUMENT);
  readonly title = input<string>('');
  readonly open = model(false);
  readonly closed = output<void>();

  readonly titleId = `gs-title-${++nextId}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private opener: HTMLElement | null = null;

  protected readonly drag = signal(0);
  private dragFrom: number | null = null;

  constructor() {
    afterRenderEffect(() => {
      const want = this.open();
      const d = this.dlg().nativeElement;
      untracked(() => {
        if (want && !d.open) {
          const active = this.doc.activeElement;
          this.opener = active instanceof HTMLElement && active !== this.doc.body ? active : null;
          d.showModal();
        } else if (!want && d.open) {
          d.close();
        }
      });
    });
  }

  close(): void {
    const d = this.dlg().nativeElement;
    if (d.open) d.close();
    else this.onClose();
  }

  /** Native 'close' (Esc, close(), form method=dialog): sync the model, restore focus, emit. */
  protected onClose(): void {
    this.drag.set(0);
    if (this.open()) this.open.set(false);
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
    this.closed.emit();
  }

  protected onCancel(e: Event): void {
    // Let Esc close normally, but stop Chrome's "close on second Esc" quirks from skipping our handler.
    e.preventDefault();
    this.close();
  }

  protected onBackdrop(e: MouseEvent): void {
    const d = this.dlg().nativeElement;
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) this.close();
  }

  protected dragStart(e: PointerEvent): void {
    this.dragFrom = e.clientY;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  protected dragMove(e: PointerEvent): void {
    if (this.dragFrom === null) return;
    this.drag.set(Math.max(0, e.clientY - this.dragFrom));
  }

  protected dragEnd(cancel = false): void {
    if (this.dragFrom === null) return;
    this.dragFrom = null;
    if (!cancel && this.drag() >= SHEET_DRAG_CLOSE_PX) this.close();
    else this.drag.set(0);
  }
}
