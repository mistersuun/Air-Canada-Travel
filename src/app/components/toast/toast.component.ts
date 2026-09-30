import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../shared/icons.component';

/**
 * Small floating toast: a message, an optional action and a dismiss button.
 * Used for "New schedules available · Reload" and "Link copied".
 */
@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast" role="status" aria-live="polite">
      <span class="toast__msg">{{ message() }}</span>
      @if (actionLabel()) {
        <button type="button" class="toast__action" (click)="action.emit()">{{ actionLabel() }}</button>
      }
      @if (dismissible()) {
        <button type="button" class="toast__close" (click)="dismiss.emit()" aria-label="Dismiss">
          <app-icon name="close" [size]="16" />
        </button>
      }
    </div>
  `,
  styles: [`
    :host {
      position: fixed;
      left: 50%;
      bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
      transform: translateX(-50%);
      z-index: 50;
      width: max-content;
      max-width: calc(100vw - 2 * var(--gutter, 16px));
    }
    .toast {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 48px;
      padding: 0 var(--space-2) 0 var(--space-4);
      border-radius: 14px;
      background: var(--ink);
      color: var(--bg);
      box-shadow: var(--shadow-pop);
      font-size: 14px;
      font-weight: 500;
      animation: enter-up var(--dur) var(--ease-out) both;
    }
    .toast__msg { padding-block: var(--space-3); }
    .toast__action {
      height: 36px;
      padding: 0 var(--space-3);
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .toast__close {
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: inherit;
      opacity: .7;
      cursor: pointer;
    }
    .toast__action:hover, .toast__close:hover { background: color-mix(in srgb, var(--bg) 14%, transparent); opacity: 1; }
    .toast__action:focus-visible, .toast__close:focus-visible { outline: 2px solid var(--bg); outline-offset: 1px; }
  `],
})
export class ToastComponent {
  readonly message = input.required<string>();
  readonly actionLabel = input<string | null>(null);
  readonly dismissible = input(true);
  readonly action = output<void>();
  readonly dismiss = output<void>();
}
