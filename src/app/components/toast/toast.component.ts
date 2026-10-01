import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../shared/icons.component';

/**
 * Floating ink pill: a message, an optional action chip and a dismiss button.
 * Used for "New schedules available · Reload", "Link copied" and undo notices.
 * Sits above the mobile tab bar, 24px from the bottom on desktop.
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
          <app-icon name="close" [size]="15" [strokeWidth]="2" />
        </button>
      }
    </div>
  `,
  styles: [`
    :host {
      position: fixed; left: 50%; transform: translateX(-50%); z-index: 50;
      bottom: calc(100px + env(safe-area-inset-bottom));
      width: max-content; max-width: calc(100vw - 32px);
    }
    @media (min-width: 720px) { :host { bottom: calc(24px + env(safe-area-inset-bottom)); } }
    .toast {
      display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 6px 6px 6px 18px;
      border-radius: 999px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow-l);
      font-size: 13.5px; font-weight: 600;
      animation: ui-enter-up var(--dur) var(--ease-out) both;
    }
    .toast__msg { padding-block: 6px; }
    .toast__action {
      height: 34px; padding: 0 14px; border-radius: 999px; color: inherit; font-weight: 650;
      background: color-mix(in srgb, var(--bg) 16%, transparent);
    }
    .toast__close { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: inherit; opacity: .7; }
    .toast__action:hover, .toast__close:hover { background: color-mix(in srgb, var(--bg) 24%, transparent); opacity: 1; }
    .toast__action:focus-visible, .toast__close:focus-visible { outline: 2px solid var(--bg); outline-offset: 1px; }
  `],
})
export class ToastComponent {
  readonly message = input.required<string>();
  readonly actionLabel = input<string | null | undefined>(null);
  readonly dismissible = input(true);
  readonly action = output<void>();
  readonly dismiss = output<void>();
}
