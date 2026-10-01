import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, signal } from '@angular/core';
import { isIos, persistNote } from '../../pages/files/files-model';
import { PassesService } from '../../passes/passes.service';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { FilesService } from '../files.service';
import { MEMORY_WARNING } from '../model';
import { formatBytes } from '../quota';

/** Largest "backup with files" Import reads (bytes): 50 MB of files grow by a third in base64. */
export const MAX_FILES_BACKUP_BYTES = 400 * 1024 * 1024;

/** About how big a backup with these files will be (base64 adds a third, plus the trips JSON). */
export function estimateBackupBytes(fileBytes: number): number {
  return Math.ceil(fileBytes * 4 / 3) + 1024 * 1024;
}

/** '14.2 MB · 9 files in 2 trips'. */
export function settingsUsageLine(count: number, bytes: number, trips: number): string {
  if (!count) return 'No files yet';
  return `${formatBytes(bytes)} · ${count} ${count === 1 ? 'file' : 'files'} in ${trips} ${trips === 1 ? 'trip' : 'trips'}`;
}

/** '3 files from deleted trips · 4.1 MB'. */
export function orphansLine(count: number, bytes: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} from deleted trips · ${formatBytes(bytes)}`;
}

/**
 * The body of Settings "Files on this phone" (extras spec §6.2), loaded on
 * demand by app-settings-files so the files store stays out of the first
 * download: the space used, whether
 * the browser keeps the files, the backup-with-files switch (with Export and
 * Import), the default for deleting boarding passes after a trip, photo
 * compression, and files left from deleted trips.
 */
@Component({
  selector: 'app-settings-files-body',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grp" data-settings-files>
      <p class="ui-label">Files on this phone</p>
      <div class="use">
        <span class="nm tn" data-files-usage>{{ usageLine() }}</span>
        @if (files.status() === 'memory') {
          <span class="hint warn">{{ memoryWarning }}</span>
        } @else {
          <span class="hint" data-keep>{{ keepLine() }}</span>
        }
      </div>

      <label class="row" for="sf-backup">
        <span class="row__tx"><span class="nm">Include files in backups</span><span class="hint">Adds your files to a separate backup</span></span>
        <input id="sf-backup" type="checkbox" role="switch" class="switch" data-sf-backup
               [checked]="prefs().includeInBackup" (change)="files.setPrefs({ includeInBackup: checked($event) })">
      </label>
      @if (prefs().includeInBackup) {
        <div class="acts">
          <button type="button" class="btn" data-sf-export [disabled]="busy()" (click)="exportFiles()">Export backup with files</button>
          <label class="btn" [class.is-off]="busy()">
            Import backup with files
            <input type="file" accept="application/json,.json" class="ui-visually-hidden" data-sf-import
                   [disabled]="busy()" (change)="importFile($event)">
          </label>
        </div>
      }
      @if (result(); as r) { <p class="res" [class.is-err]="r.error" role="status" data-sf-result>{{ r.text }}</p> }

      <label class="row" for="sf-passes">
        <span class="row__tx"><span class="nm">Delete boarding passes the day after you're home</span><span class="hint">For new passes; change it on each pass</span></span>
        <input id="sf-passes" type="checkbox" role="switch" class="switch" data-sf-passes
               [checked]="prefs().deletePassesAfterTrip" (change)="files.setPrefs({ deletePassesAfterTrip: checked($event) })">
      </label>
      <label class="row" for="sf-photos">
        <span class="row__tx"><span class="nm">Make photos smaller</span><span class="hint">Saves space and removes the location from camera photos</span></span>
        <input id="sf-photos" type="checkbox" role="switch" class="switch" data-sf-photos
               [checked]="prefs().compressPhotos" (change)="files.setPrefs({ compressPhotos: checked($event) })">
      </label>
      <p class="hint">Boarding passes are never exported or shared.</p>

      @if (orphans().count) {
        <div class="orph" data-sf-orphans>
          <span class="hint tn">{{ orphansText() }}</span>
          @if (confirming()) {
            <span class="orph__acts">
              <button type="button" class="mini" (click)="confirming.set(false)">Keep</button>
              <button type="button" class="mini mini--del" data-sf-orphans-confirm (click)="removeOrphans()">Delete them</button>
            </span>
          } @else {
            <button type="button" class="mini mini--del" data-sf-orphans-delete (click)="confirming.set(true)">Delete</button>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .use { display: grid; gap: 2px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; width: 100%; text-align: left; }
    .row__tx { display: grid; gap: 2px; }
    .nm { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--ink-2); }
    .warn { color: var(--amber-ink); }
    .acts { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      flex: 1 1 140px; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px;
      border-radius: 12px; background: var(--surface); color: var(--ink); font-size: 14px; font-weight: 600; text-align: center;
      cursor: pointer; border: 1px solid var(--hair);
    }
    .btn:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .btn:disabled, .btn.is-off { opacity: .45; cursor: not-allowed; }
    .res { font-size: 13px; color: var(--teal-ink); }
    .res.is-err { color: var(--red-ink); }
    .switch {
      appearance: none; flex: none; width: 50px; height: 30px; margin: 0; border-radius: 999px;
      background: color-mix(in srgb, var(--ink-2) 70%, var(--ink-3)); position: relative; cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--teal); }
    .switch:checked::after { transform: translateX(20px); }
    .orph { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--hair); }
    .orph__acts { display: flex; gap: 8px; }
    .mini {
      min-height: 44px; padding: 0 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--hair);
      color: var(--ink); font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .mini--del { color: var(--red-ink); }
  `],
})
export class SettingsFilesBodyComponent {
  protected readonly files = inject(FilesService);
  private readonly passes = inject(PassesService);
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);

  protected readonly memoryWarning = MEMORY_WARNING;
  protected readonly prefs = this.files.prefs;
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly result = signal<{ text: string; error: boolean } | null>(null);
  private readonly info = signal<{ persisted: boolean | null; installed: boolean } | null>(null);

  protected readonly usageLine = computed(() => {
    const u = this.files.usage();
    const tripIds = new Set([...this.files.attachments().map(a => a.tripId), ...this.passes.passes().map(p => p.tripId)]);
    return settingsUsageLine(u.count, u.bytes, tripIds.size);
  });
  protected readonly keepLine = computed(() =>
    persistNote(this.info(), isIos(this.doc.defaultView?.navigator)) ?? 'Kept until you delete them.');
  private readonly tripIds = computed(() => this.trips.trips().map(t => t.id));
  protected readonly orphans = computed(() => this.files.orphans(this.tripIds()));
  protected readonly orphansText = computed(() => orphansLine(this.orphans().count, this.orphans().bytes));

  constructor() {
    void this.files.ensureReady().catch(() => undefined);
    void this.files.storageInfo().then(i => this.info.set(i), () => undefined);
  }

  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  async exportFiles(): Promise<void> {
    const est = estimateBackupBytes(this.files.attachments().reduce((n, a) => n + a.bytes, 0));
    if (est > MAX_FILES_BACKUP_BYTES) {
      this.result.set({
        text: `This backup would be about ${formatBytes(est)}, too large to import again. Delete some large files, or use Export trips.`,
        error: true,
      });
      return;
    }
    this.busy.set(true);
    const win = this.doc.defaultView;
    try {
      const blob = await this.files.exportWithFiles();
      const url = win?.URL.createObjectURL(blob);
      if (!url) throw new Error('no URL');
      const a = this.doc.createElement('a');
      a.href = url;
      a.download = this.files.backupFilename();
      a.rel = 'noopener';
      this.doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => win?.URL.revokeObjectURL(url), 10_000);
      this.result.set({ text: `Downloaded ${a.download} (${formatBytes(blob.size)})`, error: false });
    } catch {
      this.result.set({ text: 'Could not create the backup on this browser.', error: true });
    } finally {
      this.busy.set(false);
    }
  }

  async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_FILES_BACKUP_BYTES) {
      this.result.set({ text: 'That file is too large to import here.', error: true });
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.files.importWithFiles(file);
      if ('error' in r) {
        this.result.set({ text: r.error, error: true });
        return;
      }
      const t = r.trips, f = r.files;
      const msg = `Added ${t.added} ${t.added === 1 ? 'trip' : 'trips'}, updated ${t.updated}; added ${f.added} ${f.added === 1 ? 'file' : 'files'}`
        + (f.skipped ? `, skipped ${f.skipped}` : '');
      this.result.set({ text: msg, error: false });
      this.state.flash(msg);
    } catch {
      this.result.set({ text: 'Could not read that file.', error: true });
    } finally {
      this.busy.set(false);
    }
  }

  async removeOrphans(): Promise<void> {
    this.confirming.set(false);
    const n = await this.files.removeOrphans(this.tripIds());
    this.state.flash(n === 1 ? '1 file deleted' : `${n} files deleted`);
  }
}
