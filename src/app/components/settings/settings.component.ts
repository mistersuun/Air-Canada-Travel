import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { logbookPath } from '../../extras/links';
import { HUBS } from '../../data/destinations';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import {
  MAX_LAYOVER_OPTIONS, MIN_CONNECT_OPTIONS, PrefsService, THEMES, ThemePref, TimeFormat,
} from '../../state/prefs.service';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { LISTING_HOURS_OPTIONS } from '../../trips/engine/listing';
import { hubDisplayName } from '../../ui/format';
import { formatClock } from '../../utils/time';
import { MsgKey, t } from '../../i18n/t';
import { LANGUAGE_PREFS, LanguagePref } from '../../i18n/locale';
import { LocaleService } from '../../i18n/locale.service';
import { IconComponent } from '../shared/icons.component';
import { DataCreditsComponent } from '../../places/ui/data-credits.component';
import { SettingsBackgroundComponent } from './settings-background.component';
import { SettingsDataComponent } from '../../trips/ui/settings-data.component';
import { SettingsHistoryComponent } from '../../trips/ui/settings-history.component';
import { SettingsFilesComponent } from '../../files/ui/settings-files.component';
import { ClimateCreditComponent } from '../../recs/ui/climate-credit.component';
import { GroundCreditComponent } from '../../places/ui/ground-credit.component';
import { SettingsProfileComponent } from '../../recs/ui/settings-profile.component';

const THEME_LABEL: Record<ThemePref, MsgKey> = { auto: 'settings.theme.auto', light: 'settings.theme.light', dark: 'settings.theme.dark' };
const LANGUAGE_LABEL: Record<LanguagePref, MsgKey> = {
  auto: 'settings.language.auto', en: 'settings.language.en', fr: 'settings.language.fr',
};

/**
 * Settings sheet (app-glass-sheet: bottom sheet on mobile, centred card from
 * 720px). Writes straight to PrefsService, so every change applies and
 * persists immediately. The shell renders it with @if and removes it on
 * (closed).
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    GlassSheetComponent, SegComponent, IconComponent, SettingsDataComponent, SettingsHistoryComponent, DataCreditsComponent,
    SettingsProfileComponent, SettingsFilesComponent, SettingsBackgroundComponent, ClimateCreditComponent, GroundCreditComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet #sheet [title]="t('settings.title')" [open]="true" (closed)="closed.emit()">
      <div class="st">
        <section class="grp">
          <label class="row" for="settings-hub">
            <span class="row__tx"><span class="nm">{{ t('settings.hub') }}</span><span class="hint">{{ t('settings.hubHint') }}</span></span>
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
            <span class="nm">{{ t('settings.language') }}</span>
            <app-seg stretch [ariaLabel]="t('settings.language')" data-setting="language" [options]="languageOptions()"
                     [value]="p().language" (valueChange)="setLanguage($event)" />
            <span class="hint">{{ t('settings.languageHint') }}</span>
          </div>
          <div class="field">
            <span class="nm">{{ t('settings.appearance') }}</span>
            <app-seg stretch [ariaLabel]="t('settings.appearance')" data-setting="theme" [options]="themeOptions()"
                     [value]="p().theme" (valueChange)="setTheme($event)" />
          </div>
          <div class="field">
            <span class="nm">{{ t('settings.timeFormat') }}</span>
            <app-seg stretch [ariaLabel]="t('settings.timeFormat')" data-setting="time" [options]="timeOptions()"
                     [value]="p().timeFormat" (valueChange)="setTime($event)" />
          </div>
        </section>

        <section class="grp">
          <p class="ui-label">{{ t('settings.connections') }}</p>
          <label class="row" for="settings-connections">
            <span class="row__tx"><span class="nm">{{ t('settings.showConnections') }}</span><span class="hint">{{ t('settings.showConnectionsHint') }}</span></span>
            <input id="settings-connections" type="checkbox" role="switch" class="switch"
                   [checked]="p().showConnections" (change)="setConnections($event)">
          </label>
          <div class="field">
            <span class="nm">{{ t('settings.minConnect') }}</span>
            <app-seg stretch [ariaLabel]="t('settings.minConnect')" data-setting="min" [options]="minOptions()"
                     [value]="'' + p().minConnect" (valueChange)="prefs.update({ minConnect: +$event! })" />
          </div>
          <div class="field">
            <span class="nm">{{ t('settings.maxLayover') }}</span>
            <app-seg stretch [ariaLabel]="t('settings.maxLayover')" data-setting="max" [options]="maxOptions()"
                     [value]="'' + p().maxLayover" (valueChange)="prefs.update({ maxLayover: +$event! })" />
          </div>
          <div class="field">
            <span class="nm">{{ t('settings.listing') }}</span>
            <app-seg stretch [ariaLabel]="t('settings.listingLabel')" data-setting="listing" [options]="listingOptions()"
                     [value]="'' + p().listingHours" (valueChange)="prefs.update({ listingHours: +$event! })" />
            <span class="hint">{{ t('settings.listingHint') }}</span>
          </div>
          <label class="row" for="settings-overnight">
            <span class="row__tx"><span class="nm">{{ t('settings.overnight') }}</span><span class="hint">{{ t('settings.overnightHint') }}</span></span>
            <input id="settings-overnight" type="checkbox" role="switch" class="switch"
                   [checked]="p().allowOvernight" (change)="setOvernight($event)">
          </label>
        </section>

        <app-settings-profile />

        <section class="grp">
          <button type="button" class="row row--btn" data-logbook-row (click)="openLogbook()">
            <span class="nm">{{ t('settings.logbook') }}</span><span class="chev" aria-hidden="true">›</span>
          </button>
          <button type="button" class="row row--btn" (click)="openShortcuts()">
            <span class="nm">{{ t('settings.shortcuts') }}</span><span class="chev" aria-hidden="true">›</span>
          </button>
          <div class="info">
            <span class="nm">{{ t('settings.schedules') }}</span>
            <span class="hint tn">{{ state.dataInfo().updatedLabel }}</span>
            @if (state.dataInfo().staleTag !== null) {
              <button type="button" class="ui-tag ui-tag--amber" [attr.title]="state.dataInfo().staleDetail"
                      (click)="state.flash(state.dataInfo().staleDetail)">{{ state.dataInfo().staleTag }}</button>
            }
          </div>
        </section>

        <app-settings-background />
        <app-settings-data />
        <app-settings-files />
        <app-settings-history />

        @if (photos.credits().length) {
          <details class="grp credits">
            <summary class="row"><span class="nm">{{ t('settings.photoCredits') }}</span><span class="chev" aria-hidden="true">›</span></summary>
            <ul class="cr">
              @for (p of photos.credits(); track p.code) {
                <li>
                  <b>{{ p.code }}</b>
                  <a [href]="p.credit.sourceUrl" target="_blank" rel="noopener">{{ p.credit.subject || t('settings.photo') }}</a>
                  {{ t('settings.by') }}
                  @if (p.credit.authorUrl) { <a [href]="p.credit.authorUrl" target="_blank" rel="noopener">{{ p.credit.author }}</a> }
                  @else { {{ p.credit.author }} },
                  @if (p.credit.licenseUrl) { <a [href]="p.credit.licenseUrl" target="_blank" rel="noopener license">{{ p.credit.license }}</a> }
                  @else { {{ p.credit.license }} }
                </li>
              }
            </ul>
          </details>
        }
        <app-data-credits />
        <app-ground-credit />
        <app-climate-credit />

        <div class="foot">
          <button type="button" class="ui-btn ui-btn--ghost" (click)="reset()">{{ t('settings.resetDefaults') }}</button>
          <button type="button" class="ui-btn ui-btn--dark" data-done (click)="sheet.close()">{{ t('common.done') }}</button>
        </div>
        <p class="note">{{ t('settings.resetNote') }}</p>
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
  private readonly router = inject(Router);
  protected readonly prefs = inject(PrefsService);
  protected readonly state = inject(AppStateService);
  protected readonly photos = inject(PhotoService);
  private readonly i18n = inject(LocaleService);
  protected readonly t = t;
  protected readonly p = this.prefs.prefs;
  readonly closed = output<void>();

  protected readonly hubs = HUBS;
  // Option labels are computed so they follow a language switch.
  protected readonly languageOptions = computed<SegOption[]>(() =>
    LANGUAGE_PREFS.map(l => ({ value: l, label: t(LANGUAGE_LABEL[l]) })));
  protected readonly themeOptions = computed<SegOption[]>(() => THEMES.map(th => ({ value: th, label: t(THEME_LABEL[th]) })));
  protected readonly timeOptions = computed<SegOption[]>(() => [
    { value: '24h', label: formatClock('22:10', '24h') },
    { value: '12h', label: formatClock('22:10', '12h') },
  ]);
  protected readonly minOptions = computed<SegOption[]>(() =>
    MIN_CONNECT_OPTIONS.map(m => ({ value: String(m), label: t('format.dur.m', { m }) })));
  protected readonly maxOptions = computed<SegOption[]>(() =>
    MAX_LAYOVER_OPTIONS.map(m => ({ value: String(m), label: t('format.dur.h', { h: m / 60 }) })));
  protected readonly listingOptions = computed<SegOption[]>(() =>
    LISTING_HOURS_OPTIONS.map(h => ({ value: String(h), label: t('format.dur.h', { h }) })));

  protected display(code: string): string {
    return hubDisplayName(code);
  }

  protected setHub(e: Event): void {
    // Through AppStateService so a URL `from=` override is cleared too.
    this.state.setHub((e.target as HTMLSelectElement).value);
  }

  protected setTheme(v: string | undefined): void {
    if (v && (THEMES as readonly string[]).includes(v)) this.prefs.setTheme(v as ThemePref);
  }

  protected setTime(v: string | undefined): void {
    if (v === '12h' || v === '24h') this.prefs.update({ timeFormat: v as TimeFormat });
  }

  protected setLanguage(v: string | undefined): void {
    if ((LANGUAGE_PREFS as readonly string[]).includes(v ?? '')) this.i18n.setPreference(v as LanguagePref);
  }

  protected setConnections(e: Event): void {
    this.state.setShowConnections((e.target as HTMLInputElement).checked);
  }

  protected setOvernight(e: Event): void {
    this.prefs.update({ allowOvernight: (e.target as HTMLInputElement).checked });
  }

  protected openLogbook(): void {
    this.state.closeSettings();
    void this.router.navigate(logbookPath(), { queryParams: this.state.globalParams() });
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
