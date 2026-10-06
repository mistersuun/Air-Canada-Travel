import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { storageInfo } from '../../files/quota';
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
      <p class="ui-label">Your trips</p>
      <p class="hint">Your trips live on this device. There is no account: export a backup to move them or keep them safe.</p>
      <div class="acts">
        <button type="button" class="btn" data-export (click)="exportTrips()">Export trips</button>
        <label class="btn" [class.is-off]="trips.readOnly()">
          Import trips
          <input type="file" accept="application/json,.json" class="ui-visually-hidden" data-import
                 [disabled]="trips.readOnly()" (change)="importFile($event)">
        </label>
      </div>
      @if (trips.unsaved()) { <p class="res is-err" role="status" data-unsaved>{{ unsavedText }}</p> }
      @if (trips.backupReminder(); as n) { <p class="hint" data-backup-nudge>{{ n }}</p> }
      @if (result(); as r) { <p class="res" [class.is-err]="r.error" role="status">{{ r.text }}</p> }
      @if (count()) { <p class="hint tn">{{ count() }} on this device.</p> }
      @if (keepLine(); as k) { <p class="hint" data-persisted>{{ k }}</p> }
      @if (trips.damaged().length) {
        <div class="dmg" data-damaged>
          <p class="hint">A damaged copy of your trips was kept.</p>
          <div class="acts">
            <button type="button" class="btn" data-damaged-download (click)="downloadDamaged()">Download</button>
            <button type="button" class="btn btn--del" data-damaged-delete (click)="trips.deleteDamaged()">Delete</button>
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

  protected readonly result = signal<{ text: string; error: boolean } | null>(null);
  protected readonly count = computed(() => {
    const n = this.trips.trips().length;
    return n ? `${n} ${n === 1 ? 'trip' : 'trips'}` : '';
  });

  protected readonly unsavedText = UNSAVED_NOTICE;
  private readonly persisted = signal<boolean | null>(null);
  protected readonly keepLine = computed(() => {
    const p = this.persisted();
    return p === null ? '' : p ? 'This phone keeps your trips unless you clear site data.' : 'Your browser may clear your trips if space runs low. A backup keeps them safe.';
  });

  constructor() {
    void storageInfo().then(i => this.persisted.set(i.persisted), () => undefined);
  }

  exportTrips(): void {
    const r = this.trips.downloadBackup();
    this.result.set(r ? { text: `Downloaded ${r.filename}`, error: false }
      : { text: 'Could not create the file on this browser.', error: true });
  }

  downloadDamaged(): void {
    if (!this.trips.downloadDamaged()) this.result.set({ text: 'Could not create the file on this browser.', error: true });
  }

  async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      this.result.set({ text: 'That file is too large to be a trips backup.', error: true });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.result.set({ text: 'Could not read that file.', error: true });
      return;
    }
    this.importText(text);
  }

  /** Merges a backup and reports what changed: 'Added 1 trip, updated 0'. */
  importText(text: string): void {
    const r = this.trips.importBackup(text);
    if ('error' in r) {
      this.result.set({ text: r.error, error: true });
      return;
    }
    const msg = `Added ${r.added} ${r.added === 1 ? 'trip' : 'trips'}, updated ${r.updated}`;
    this.result.set({ text: msg, error: false });
    this.state.flash(msg);
  }
}
