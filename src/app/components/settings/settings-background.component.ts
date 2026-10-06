import { ChangeDetectionStrategy, Component, DOCUMENT, inject, signal } from '@angular/core';
import {
  SCHEDULE_CHECK_MIN_INTERVAL_MS, SCHEDULE_CHECK_TAG, backgroundChecksSupport, type BackgroundChecksSupport,
} from '../../share-in/share-payload';

interface PeriodicSyncLike {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}
type RegWithSync = ServiceWorkerRegistration & { periodicSync?: PeriodicSyncLike };

/**
 * Settings "Background schedule checks". Shown only where Periodic Background
 * Sync exists (Chrome/Edge on Android or desktop, installed app). The switch
 * mirrors the real registration, so it is never out of step with the browser.
 * The worker only compares the schedules' publish date; it does not read trips.
 */
@Component({
  selector: 'app-settings-background',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (support().supported) {
      <section class="grp" data-settings-background>
        <label class="row" for="settings-bg">
          <span class="row__tx">
            <span class="nm">Background schedule checks</span>
            <span class="hint">Once or twice a day, look for new schedules and send a notification. Android and Chrome only; the browser decides when it runs, so it is best effort.</span>
          </span>
          <input id="settings-bg" type="checkbox" role="switch" class="switch" [checked]="on()" [disabled]="busy()" (change)="toggle($event)">
        </label>
        @if (msg()) { <p class="hint" role="status" data-bg-msg>{{ msg() }}</p> }
      </section>
    }
  `,
  styles: [`
    .grp { display: grid; gap: 10px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
    .row__tx { display: grid; gap: 2px; }
    .nm { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--ink-2); }
    .switch {
      appearance: none; flex: none; width: 50px; height: 30px; margin: 0; border-radius: 999px; position: relative; cursor: pointer;
      background: color-mix(in srgb, var(--ink-2) 70%, var(--ink-3)); transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--teal); }
    .switch:checked::after { transform: translateX(20px); }
  `],
})
export class SettingsBackgroundComponent {
  private readonly win = inject(DOCUMENT).defaultView;
  private reg: RegWithSync | null = null;
  protected readonly support = signal<BackgroundChecksSupport>({ supported: false, reason: 'no-sw' });
  protected readonly on = signal(false);
  protected readonly busy = signal(false);
  protected readonly msg = signal<string | null>(null);

  constructor() {
    void this.detect();
  }

  private async detect(): Promise<void> {
    const w = this.win;
    if (!w?.navigator.serviceWorker) return;
    try {
      const reg = (await w.navigator.serviceWorker.getRegistration()) as RegWithSync | undefined;
      this.reg = reg ?? null;
      const s = backgroundChecksSupport({ hasServiceWorker: true, hasNotification: 'Notification' in w, registration: reg ?? null });
      this.support.set(s);
      if (s.supported) this.on.set((await reg!.periodicSync!.getTags()).includes(SCHEDULE_CHECK_TAG));
    } catch { /* stays hidden */ }
  }

  protected async toggle(e: Event): Promise<void> {
    const box = e.target as HTMLInputElement;
    const sync = this.reg?.periodicSync;
    const w = this.win;
    if (!sync || !w) return;
    this.busy.set(true);
    this.msg.set(null);
    try {
      if (!box.checked) {
        await sync.unregister(SCHEDULE_CHECK_TAG);
        this.on.set(false);
        return;
      }
      const perm = w.Notification.permission === 'granted' ? 'granted' : await w.Notification.requestPermission();
      if (perm !== 'granted') {
        box.checked = false;
        this.msg.set('Notifications are blocked, so there is nothing to show. Allow them in your browser settings to turn this on.');
        return;
      }
      await sync.register(SCHEDULE_CHECK_TAG, { minInterval: SCHEDULE_CHECK_MIN_INTERVAL_MS });
      this.on.set(true);
    } catch {
      box.checked = this.on();
      this.msg.set('This browser would not allow it. Install the app to your home screen or desktop and try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
