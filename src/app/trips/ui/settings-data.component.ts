import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { storageInfo } from '../../files/quota';
import { t, type MsgKey, type MsgParams } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';
import { TripsService, UNSAVED_NOTICE } from '../trips.service';

/** Largest backup file Import trips reads (bytes). */
export const MAX_BACKUP_BYTES = 5_000_000;

/**
 * Settings "Your trips": Export trips (a JSON backup of trips, load notes and
 * outcomes) and Import trips (merges by id; the newer copy wins), with the
 * reminder that trips live on this device only.
 */
@Component({
  selector: 'app-settings-data',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grp" data-settings-data>
      <p class="ui-label">{{ t('trips.data.title') }}</p>
      <p class="hint">{{ t('trips.data.hint') }}</p>
      <div class="acts">
        <button type="button" class="btn" data-export (click)="exportTrips()">{{ t('trips.data.export') }}</button>
        <label class="btn" [class.is-off]="trips.readOnly()">
          {{ t('trips.data.import') }}
          <input type="file" accept="application/json,.json" class="ui-visually-hidden" data-import
                 [disabled]="trips.readOnly()" (change)="importFile($event)">
        </label>
      </div>
      @if (trips.unsaved()) { <p class="res is-err" role="status" data-unsaved>{{ t(unsavedKey) }}</p> }
      @if (trips.backupReminder(); as n) { <p class="hint" data-backup-nudge>{{ n }}</p> }
      @if (result(); as r) { <p class="res" [class.is-err]="r.error" role="status">{{ r.text() }}</p> }
      @if (count()) { <p class="hint tn">{{ t('trips.data.onDevice', { n: count() }) }}</p> }
      @if (keepLine(); as k) { <p class="hint" data-persisted>{{ k }}</p> }
      @if (trips.damaged(); as d) {
        <div class="dmg" data-damaged>
          <p class="hint">{{ t('trips.data.damaged', { what: t(damagedKey(d)) }) }}</p>
          <div class="acts">
            <button type="button" class="btn" data-damaged-download (click)="downloadDamaged()">{{ t('trips.data.download') }}</button>
            <button type="button" class="btn btn--del" data-damaged-delete (click)="deleteDamaged()">{{ t(confirmDelete() ? 'trips.data.tapAgain' : 'trips.data.delete') }}</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 10px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .hint { font-size: 13px; color: var(--ink-2); }
    .acts { display: flex; gap: 8px; }
    .btn {
      flex: 1; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px;
      border-radius: 12px; background: var(--surface); color: var(--ink); font-size: 14px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--hair);
    }
    .btn--del { color: var(--red-ink); }
    .dmg { display: grid; gap: 8px; }
    .btn:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .btn.is-off { opacity: .45; cursor: not-allowed; }
    .res { font-size: 13px; color: var(--teal-ink); }
    .res.is-err { color: var(--red-ink); }
  `],
})
export class SettingsDataComponent {
  protected readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);

  protected readonly t = t;
  /** The result line is a function, so it is written in the language shown when it is read. */
  protected readonly result = signal<{ text: () => string; error: boolean } | null>(null);
  protected readonly count = computed(() => this.trips.trips().length);

  protected readonly unsavedKey = UNSAVED_NOTICE;
  private readonly persisted = signal<boolean | null>(null);
  protected readonly keepLine = computed(() => {
    const p = this.persisted();
    return p === null ? '' : t(p ? 'trips.data.persisted' : 'trips.data.notPersisted');
  });

  protected damagedKey(d: 'trips' | 'flight log' | 'trips and flight log'): MsgKey { // i18n-ignore
    return d === 'trips' ? 'trips.data.damagedTrips' : d === 'flight log' ? 'trips.data.damagedLog' : 'trips.data.damagedBoth'; // i18n-ignore
  }

  private say(key: MsgKey, error: boolean, params?: MsgParams): void {
    this.result.set({ text: () => t(key, params), error });
  }

  constructor() {
    void storageInfo().then(i => this.persisted.set(i.persisted), () => undefined);
  }

  exportTrips(): void {
    const r = this.trips.downloadBackup();
    if (r) this.say('trips.data.downloaded', false, { name: r.filename });
    else this.say('trips.data.noFile', true);
  }

  protected readonly confirmDelete = signal(false);

  /** Two taps: the first arms it, the second deletes (the first disarms itself after 4 s). */
  deleteDamaged(): void {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      setTimeout(() => this.confirmDelete.set(false), 4000);
      return;
    }
    this.confirmDelete.set(false);
    this.trips.deleteDamaged();
  }

  downloadDamaged(): void {
    if (!this.trips.downloadDamaged()) this.say('trips.data.noFile', true);
  }

  async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      this.say('trips.data.tooLarge', true);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.say('trips.data.unreadable', true);
      return;
    }
    this.importText(text);
  }

  /** Merges a backup and reports what changed: 'Added 1 trip, updated 0'. */
  importText(text: string): void {
    const r = this.trips.importBackup(text);
    if ('error' in r) {
      this.result.set({ text: () => r.error, error: true });
      return;
    }
    this.say('trips.data.imported', false, { added: r.added, updated: r.updated });
    this.state.flash(t('trips.data.imported', { added: r.added, updated: r.updated }));
  }
}
