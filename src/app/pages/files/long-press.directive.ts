import { Directive, OnDestroy, output } from '@angular/core';

/** Hold time (ms) that counts as a long-press. */
export const LONG_PRESS_MS = 500;
/** Finger travel (px) that cancels a long-press (the user is scrolling). */
const SLOP_PX = 10;

/**
 * (longPress) after a 500 ms touch or mouse hold that didn't move. The row
 * checks took() in its click handler so the release doesn't also open it. Rows
 * keep a visible "⋯" button too, for keyboards and screen readers.
 */
@Directive({
  selector: '[appLongPress]',
  exportAs: 'appLongPress',
  standalone: true,
  host: {
    '(pointerdown)': 'down($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'cancel()',
    '(pointercancel)': 'cancel()',
    '(pointerleave)': 'cancel()',
    '(contextmenu)': 'menu($event)',
  },
})
export class LongPressDirective implements OnDestroy {
  readonly longPress = output<void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private start: { x: number; y: number } | null = null;
  private fired = false;

  protected down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.fired = false;
    this.start = { x: e.clientX, y: e.clientY };
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fired = true;
      this.longPress.emit();
    }, LONG_PRESS_MS);
  }

  protected move(e: PointerEvent): void {
    if (!this.start || !this.timer) return;
    if (Math.abs(e.clientX - this.start.x) > SLOP_PX || Math.abs(e.clientY - this.start.y) > SLOP_PX) this.clear();
  }

  protected cancel(): void {
    this.clear();
    this.start = null;
  }

  /**
   * True once after a long-press: the row's (click) calls it first and skips
   * its own action, `(click)="lp.took() || open(a)"`.
   */
  took(): boolean {
    const f = this.fired;
    this.fired = false;
    return f;
  }

  /** Mobile browsers open their own menu on a long touch; ours replaces it. */
  protected menu(e: Event): void {
    if (this.timer || this.fired) e.preventDefault();
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
