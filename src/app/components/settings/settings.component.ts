import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, output, viewChild,
} from '@angular/core';
import { HUBS } from '../../data/destinations';
import {
  MAX_LAYOVER_OPTIONS, MIN_CONNECT_OPTIONS, PrefsService, THEMES, ThemePref, TimeFormat,
} from '../../state/prefs.service';
import { IconComponent } from '../shared/icons.component';

/**
 * Settings sheet (native <dialog>): bottom sheet on mobile, centred panel from
 * 720px (the .ui-sheet primitive). Writes straight to PrefsService, so every
 * change applies and persists immediately. The parent renders it with @if and
 * removes it on (closed); the dialog opens itself after first render.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="ui-sheet settings" aria-labelledby="settings-title" (close)="closed.emit()"
            (click)="onBackdrop($event)">
      <div class="ui-sheet__grabber" aria-hidden="true"></div>
      <header class="settings__head">
        <h2 id="settings-title" class="settings__title">Settings</h2>
        <button type="button" class="ui-icon-btn" (click)="close()" aria-label="Close settings">
          <app-icon name="close" [size]="20" />
        </button>
      </header>

      <div class="settings__body">
        <section class="settings__group">
          <label class="settings__row" for="settings-hub">
            <span class="settings__row-label">
              <span class="settings__name">Home airport</span>
              <span class="settings__hint">Where the app opens</span>
            </span>
            <span class="settings__select">
              <select id="settings-hub" [value]="p().hub" (change)="setHub($event)">
                @for (h of hubs; track h.code) {
                  <option [value]="h.code" [selected]="h.code === p().hub">{{ h.code }} · {{ h.name }}</option>
                }
              </select>
              <app-icon name="chevron-down" [size]="16" />
            </span>
          </label>
        </section>

        <section class="settings__group">
          <fieldset class="settings__field">
            <legend class="settings__name">Theme</legend>
            <div class="seg" role="presentation">
              @for (t of themes; track t) {
                <label class="seg__opt">
                  <input type="radio" name="settings-theme" [value]="t" [checked]="p().theme === t"
                         (change)="prefs.setTheme(t)">
                  <span><app-icon [name]="t === 'auto' ? 'auto' : t === 'light' ? 'sun' : 'moon'" [size]="16" />{{ themeLabel(t) }}</span>
                </label>
              }
            </div>
          </fieldset>
          <fieldset class="settings__field">
            <legend class="settings__name">Time format</legend>
            <div class="seg">
              @for (f of timeFormats; track f) {
                <label class="seg__opt">
                  <input type="radio" name="settings-time" [value]="f" [checked]="p().timeFormat === f"
                         (change)="prefs.update({ timeFormat: f })">
                  <span class="ui-num">{{ f === '24h' ? '22:10' : '10:10 pm' }}</span>
                </label>
              }
            </div>
          </fieldset>
        </section>

        <section class="settings__group">
          <p class="ui-label settings__group-label">Connections</p>
          <fieldset class="settings__field">
            <legend class="settings__name">Minimum connection</legend>
            <div class="seg">
              @for (m of minConnectOptions; track m) {
                <label class="seg__opt">
                  <input type="radio" name="settings-min" [value]="m" [checked]="p().minConnect === m"
                         (change)="prefs.update({ minConnect: m })">
                  <span class="ui-num">{{ m }}m</span>
                </label>
              }
            </div>
          </fieldset>
          <fieldset class="settings__field">
            <legend class="settings__name">Maximum layover</legend>
            <div class="seg">
              @for (m of maxLayoverOptions; track m) {
                <label class="seg__opt">
                  <input type="radio" name="settings-max" [value]="m" [checked]="p().maxLayover === m"
                         (change)="prefs.update({ maxLayover: m })">
                  <span class="ui-num">{{ m / 60 }}h</span>
                </label>
              }
            </div>
          </fieldset>
          <label class="settings__row" for="settings-overnight">
            <span class="settings__row-label">
              <span class="settings__name">Overnight connections</span>
              <span class="settings__hint">Allow a layover that crosses midnight at the hub</span>
            </span>
            <input id="settings-overnight" type="checkbox" role="switch" class="switch"
                   [checked]="p().allowOvernight" (change)="setOvernight($event)">
          </label>
        </section>

        <footer class="settings__foot">
          <button type="button" class="ui-btn" (click)="reset()">Reset to defaults</button>
          <button type="button" class="ui-btn ui-btn--primary" (click)="close()">Done</button>
        </footer>
        <p class="settings__note">Starred places are kept when you reset.</p>
      </div>
    </dialog>
  `,
  styles: [`
    .settings { color: var(--ink); }
    .settings__head {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--space-2) var(--space-2) 0 var(--space-5);
    }
    .settings__title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
    .settings__body { padding: var(--space-3) var(--space-5) var(--space-5); display: grid; gap: var(--space-4); }
    .settings__group {
      display: grid; gap: var(--space-4);
      padding: var(--space-4);
      border: 1px solid var(--line);
      border-radius: var(--radius-card);
      background: var(--surface-2);
    }
    .settings__group-label { margin: 0 0 calc(-1 * var(--space-2)); }
    .settings__field { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: var(--space-2); }
    .settings__field legend { padding: 0; margin-bottom: var(--space-2); }
    .settings__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); cursor: pointer; }
    .settings__row-label { display: grid; gap: 2px; }
    .settings__name { font-size: 15px; font-weight: 600; }
    .settings__hint { font-size: 13px; color: var(--ink-2); }

    .settings__select { position: relative; display: inline-flex; align-items: center; color: var(--ink-2); }
    .settings__select select {
      appearance: none;
      height: 40px;
      padding: 0 32px 0 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      color: var(--ink);
      font: 600 14px var(--font-code);
      cursor: pointer;
    }
    .settings__select app-icon { position: absolute; right: 10px; pointer-events: none; }

    .seg {
      display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
      padding: 3px; gap: 3px;
      border-radius: 12px;
      background: var(--surface);
      border: 1px solid var(--line);
    }
    .seg__opt { position: relative; display: block; }
    .seg__opt input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .seg__opt span {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 40px; padding: 0 var(--space-2);
      border-radius: 9px;
      font-size: 13px; font-weight: 600; color: var(--ink-2);
      transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
    }
    .seg__opt input:checked + span { background: var(--ink); color: var(--bg); }
    .seg__opt input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }

    .switch {
      appearance: none; flex: none;
      width: 48px; height: 28px; margin: 0;
      border-radius: 999px;
      background: var(--line-strong);
      position: relative; cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px;
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--surface);
      box-shadow: var(--shadow-card);
      transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--accent-fill); }
    .switch:checked::after { transform: translateX(20px); }
    .switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .settings__foot { display: flex; justify-content: space-between; gap: var(--space-3); }
    .settings__foot .ui-btn { flex: 1; }
    .settings__note { margin: calc(-1 * var(--space-2)) 0 0; font-size: 12px; color: var(--ink-3); text-align: center; }
  `],
})
export class SettingsComponent {
  protected readonly prefs = inject(PrefsService);
  protected readonly p = this.prefs.prefs;
  readonly closed = output<void>();

  protected readonly hubs = HUBS;
  protected readonly themes = THEMES;
  protected readonly timeFormats: readonly TimeFormat[] = ['24h', '12h'];
  protected readonly minConnectOptions = MIN_CONNECT_OPTIONS;
  protected readonly maxLayoverOptions = MAX_LAYOVER_OPTIONS;

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    afterNextRender(() => {
      const d = this.dlg().nativeElement;
      if (!d.open) d.showModal();
    });
  }

  close(): void {
    // Fires the dialog's 'close' event, which emits (closed).
    this.dlg().nativeElement.close();
  }

  protected onBackdrop(e: MouseEvent): void {
    // A click on the ::backdrop targets the dialog element itself, but so does
    // a click on the dialog's own padding: check the point is outside its box.
    const d = this.dlg().nativeElement;
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) this.close();
  }

  protected setHub(e: Event): void {
    this.prefs.update({ hub: (e.target as HTMLSelectElement).value });
  }

  protected setOvernight(e: Event): void {
    this.prefs.update({ allowOvernight: (e.target as HTMLInputElement).checked });
  }

  protected reset(): void {
    this.prefs.reset();
  }

  protected themeLabel(t: ThemePref): string {
    return t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark';
  }
}
