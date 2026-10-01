import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { HUBS } from '../../data/destinations';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import {
  MAX_LAYOVER_OPTIONS, MIN_CONNECT_OPTIONS, PrefsService, THEMES, ThemePref, TimeFormat,
} from '../../state/prefs.service';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { hubDisplayName } from '../../ui/format';
import { IconComponent } from '../shared/icons.component';

const THEME_LABEL: Record<ThemePref, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };

/**
 * Settings sheet (app-glass-sheet: bottom sheet on mobile, centred card from
 * 720px). Writes straight to PrefsService, so every change applies and
 * persists immediately. The shell renders it with @if and removes it on
 * (closed).
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [GlassSheetComponent, SegComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet #sheet title="Settings" [open]="true" (closed)="closed.emit()">
      <div class="st">
        <section class="grp">
          <label class="row" for="settings-hub">
            <span class="row__tx"><span class="nm">Home airport</span><span class="hint">Where the app opens</span></span>
            <span class="sel">
              <select id="settings-hub" [value]="p().hub" (change)="setHub($event)">
                @for (h of hubs; track h.code) {
                  <option [value]="h.code" [selected]="h.code === p().hub">{{ h.code }} · {{ display(h.code) }}</option>
                }
              </select>
              <app-icon name="chevron-down" [size]="16" />
            </span>
          </label>
        </section>

        <section class="grp">
          <div class="field">
            <span class="nm">Appearance</span>
            <app-seg stretch ariaLabel="Appearance" data-setting="theme" [options]="themeOptions"
                     [value]="p().theme" (valueChange)="setTheme($event)" />
          </div>
          <div class="field">
            <span class="nm">Time format</span>
            <app-seg stretch ariaLabel="Time format" data-setting="time" [options]="timeOptions"
                     [value]="p().timeFormat" (valueChange)="setTime($event)" />
          </div>
        </section>

        <section class="grp">
          <p class="ui-label">Connections</p>
          <label class="row" for="settings-connections">
            <span class="row__tx"><span class="nm">Show connections</span><span class="hint">Include one-stop trips through a hub</span></span>
            <input id="settings-connections" type="checkbox" role="switch" class="switch"
                   [checked]="p().showConnections" (change)="setConnections($event)">
          </label>
          <div class="field">
            <span class="nm">Minimum connection</span>
            <app-seg stretch ariaLabel="Minimum connection" data-setting="min" [options]="minOptions"
                     [value]="'' + p().minConnect" (valueChange)="prefs.update({ minConnect: +$event! })" />
          </div>
          <div class="field">
            <span class="nm">Maximum layover</span>
            <app-seg stretch ariaLabel="Maximum layover" data-setting="max" [options]="maxOptions"
                     [value]="'' + p().maxLayover" (valueChange)="prefs.update({ maxLayover: +$event! })" />
          </div>
          <label class="row" for="settings-overnight">
            <span class="row__tx"><span class="nm">Overnight connections</span><span class="hint">Allow a layover that crosses midnight at the hub</span></span>
            <input id="settings-overnight" type="checkbox" role="switch" class="switch"
                   [checked]="p().allowOvernight" (change)="setOvernight($event)">
          </label>
        </section>

        <section class="grp">
          <button type="button" class="row row--btn" (click)="openShortcuts()">
            <span class="nm">Keyboard shortcuts</span><span class="chev" aria-hidden="true">›</span>
          </button>
          <div class="info">
            <span class="nm">Schedules</span>
            <span class="hint tn">{{ state.dataInfo().updatedLabel }}</span>
            @if (state.dataInfo().staleDays !== null) {
              <span class="ui-tag ui-tag--amber">Data {{ state.dataInfo().staleDays }} days old</span>
            }
          </div>
        </section>

        @if (photos.credits().length) {
          <details class="grp credits">
            <summary class="row"><span class="nm">Photo credits</span><span class="chev" aria-hidden="true">›</span></summary>
            <ul class="cr">
              @for (p of photos.credits(); track p.code) {
                <li>
                  <b>{{ p.code }}</b>
                  <a [href]="p.credit.sourceUrl" target="_blank" rel="noopener">{{ p.credit.subject || 'Photo' }}</a>
                  by
                  @if (p.credit.authorUrl) { <a [href]="p.credit.authorUrl" target="_blank" rel="noopener">{{ p.credit.author }}</a> }
                  @else { {{ p.credit.author }} },
                  @if (p.credit.licenseUrl) { <a [href]="p.credit.licenseUrl" target="_blank" rel="noopener license">{{ p.credit.license }}</a> }
                  @else { {{ p.credit.license }} }
                </li>
              }
            </ul>
          </details>
        }

        <div class="foot">
          <button type="button" class="ui-btn ui-btn--ghost" (click)="reset()">Reset to defaults</button>
          <button type="button" class="ui-btn ui-btn--dark" data-done (click)="sheet.close()">Done</button>
        </div>
        <p class="note">Saved destinations are kept when you reset.</p>
      </div>
    </app-glass-sheet>
  `,
  styles: [`
    .st { display: grid; gap: 14px; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .field { display: grid; gap: 8px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; width: 100%; text-align: left; }
    .row__tx { display: grid; gap: 2px; }
    .nm { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--ink-2); }
    .chev { color: var(--ink-3); font-size: 18px; }
    .info { display: grid; gap: 4px; justify-items: start; }
    .sel { position: relative; display: inline-flex; align-items: center; color: var(--ink-2); flex: none; }
    .sel select {
      appearance: none; height: 40px; padding: 0 32px 0 12px; max-width: 200px;
      border: 1px solid var(--hair); border-radius: 12px; background: var(--surface); color: var(--ink);
      font: 600 14px var(--sans); cursor: pointer;
    }
    .sel app-icon { position: absolute; right: 10px; pointer-events: none; }
    app-seg ::ng-deep .seg { background: var(--surface); }
    app-seg ::ng-deep .seg__b.on { background: var(--ink); color: var(--bg); box-shadow: none; }
    .switch {
      appearance: none; flex: none; width: 50px; height: 30px; margin: 0; border-radius: 999px;
      /* Off track: >= 3:1 against the group fill and the thumb (WCAG 1.4.11). */
      background: color-mix(in srgb, var(--ink-2) 70%, var(--ink-3)); position: relative; cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .2);
      transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--teal); }
    .switch:checked::after { transform: translateX(20px); }
    .credits summary { list-style: none; }
    .credits summary::-webkit-details-marker { display: none; }
    .credits .chev { transition: transform var(--dur-fast) var(--ease-out); }
    .credits[open] .chev { transform: rotate(90deg); }
    .cr { list-style: none; display: grid; gap: 8px; max-height: 260px; overflow: auto; font-size: 12.5px; color: var(--ink-2); }
    .cr b { color: var(--ink); font-weight: 650; margin-right: 4px; }
    .cr a { color: var(--blue); overflow-wrap: anywhere; }
    .foot { display: flex; gap: 10px; }
    .foot .ui-btn { flex: 1; }
    .note { font-size: 12px; color: var(--ink-2); text-align: center; }
  `],
})
export class SettingsComponent {
  protected readonly prefs = inject(PrefsService);
  protected readonly state = inject(AppStateService);
  protected readonly photos = inject(PhotoService);
  protected readonly p = this.prefs.prefs;
  readonly closed = output<void>();

  protected readonly hubs = HUBS;
  protected readonly themeOptions: SegOption[] = THEMES.map(t => ({ value: t, label: THEME_LABEL[t] }));
  protected readonly timeOptions: SegOption[] = [
    { value: '24h', label: '22:10' },
    { value: '12h', label: '10:10 PM' },
  ];
  protected readonly minOptions: SegOption[] = MIN_CONNECT_OPTIONS.map(m => ({ value: String(m), label: `${m}m` }));
  protected readonly maxOptions: SegOption[] = MAX_LAYOVER_OPTIONS.map(m => ({ value: String(m), label: `${m / 60}h` }));

  protected display(code: string): string {
    return hubDisplayName(code);
  }

  protected setHub(e: Event): void {
    // Through AppStateService so a URL `from=` override is cleared too.
    this.state.setHub((e.target as HTMLSelectElement).value);
  }

  protected setTheme(t: string | undefined): void {
    if (t && (THEMES as readonly string[]).includes(t)) this.prefs.setTheme(t as ThemePref);
  }

  protected setTime(t: string | undefined): void {
    if (t === '12h' || t === '24h') this.prefs.update({ timeFormat: t as TimeFormat });
  }

  protected setConnections(e: Event): void {
    this.state.setShowConnections((e.target as HTMLInputElement).checked);
  }

  protected setOvernight(e: Event): void {
    this.prefs.update({ allowOvernight: (e.target as HTMLInputElement).checked });
  }

  protected openShortcuts(): void {
    this.state.closeSettings();
    this.state.openShortcuts();
  }

  protected reset(): void {
    this.prefs.reset();
    this.state.resetOverrides();
  }
}
