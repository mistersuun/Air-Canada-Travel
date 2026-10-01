import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { addPassPath, addPassQuery } from '../../extras/links';
import { FilesService } from '../../files/files.service';
import type { Attachment, AttachmentScope } from '../../files/model';
import { AppStateService } from '../../state/app-state.service';
import type { Trip } from '../../trips/model';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { filesErrorText, scopeFromKey, scopeKey, scopeOptions } from './files-model';

type Mode = 'menu' | 'note' | 'address';

/**
 * The add sheet (extras spec §6.2): "Photo or file" (several at once), "Take
 * a photo", "Note", "Address" and "Boarding pass" (the add-pass page). The
 * target ("Add to") starts at the section or leg that opened it.
 */
@Component({
  selector: 'app-add-file-sheet',
  standalone: true,
  imports: [GlassSheetComponent, IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet #sheet [title]="mode() === 'note' ? 'Add a note' : mode() === 'address' ? 'Add an address' : 'Add to this trip'"
                     [open]="true" (closed)="closed.emit()">
      <label class="as__to">
        <span class="ui-label">Add to</span>
        <span class="as__sel">
          <select data-target [value]="target()" (change)="setTarget($event)">
            @for (o of options(); track o.key) {
              <option [value]="o.key" [selected]="o.key === target()">{{ o.label }}</option>
            }
          </select>
          <app-icon name="chevron-down" [size]="16" />
        </span>
      </label>

      @switch (mode()) {
        @case ('menu') {
          <div class="as__list" role="group" aria-label="What to add">
            <label class="as__row" [class.is-off]="busy()">
              <span class="fic fic--pdf"><app-icon name="paperclip" [size]="19" /></span>
              <span class="as__tx"><b>Photo or file</b><span>PDF, screenshot, ticket or confirmation</span></span>
              <input type="file" multiple class="ui-visually-hidden" data-add-file [disabled]="busy()" (change)="pickFiles($event, sheet)">
            </label>
            <label class="as__row" [class.is-off]="busy()">
              <span class="fic fic--photo"><app-icon name="camera" [size]="19" /></span>
              <span class="as__tx"><b>Take a photo</b><span>A receipt, a sign, a parking spot</span></span>
              <input type="file" accept="image/*" capture="environment" class="ui-visually-hidden" data-add-camera
                     [disabled]="busy()" (change)="pickFiles($event, sheet)">
            </label>
            <button type="button" class="as__row" data-add-note (click)="mode.set('note')">
              <span class="fic fic--note"><app-icon name="note" [size]="19" /></span>
              <span class="as__tx"><b>Note</b><span>Door codes, a check-in time</span></span>
            </button>
            <button type="button" class="as__row" data-add-address (click)="mode.set('address')">
              <span class="fic fic--note"><app-icon name="pin" [size]="19" /></span>
              <span class="as__tx"><b>Address</b><span>Opens in your maps app</span></span>
            </button>
            <a class="as__row" data-add-pass [routerLink]="passPath()" [queryParams]="passQuery()" (click)="sheet.close()">
              <span class="fic fic--pass"><app-icon name="barcode" [size]="19" /></span>
              <span class="as__tx"><b>Boarding pass</b><span>Scan it or pick a screenshot or PDF</span></span>
            </a>
          </div>
          @if (busy()) { <p class="as__note" role="status">Saving…</p> }
          <p class="as__note">Kept on this phone and opened offline. Not in share links.</p>
        }
        @default {
          @let address = mode() === 'address';
          <form class="as__form" (submit)="$event.preventDefault(); saveText(titleIn.value, bodyIn.value, sheet)">
            <label class="as__lbl" for="as-title">Title</label>
            <input #titleIn id="as-title" class="as__in" maxlength="120" autocomplete="off" data-title
                   [placeholder]="address ? 'Apartment address' : 'Note'">
            <label class="as__lbl" for="as-body">{{ address ? 'Address' : 'Note' }}</label>
            <textarea #bodyIn id="as-body" class="as__in as__ta" rows="4" maxlength="4000" data-body required
                      [placeholder]="address ? 'Street, city' : 'Alcázar tickets: 10:30 slot'"
                      [attr.autocomplete]="address ? 'street-address' : 'off'"></textarea>
            <div class="as__acts">
              <button type="button" class="ui-btn ui-btn--ghost" (click)="mode.set('menu'); error.set(null)">Back</button>
              <button type="submit" class="ui-btn ui-btn--dark" data-save [disabled]="busy()">Save</button>
            </div>
          </form>
        }
      }
      @if (error(); as e) { <p class="as__err" role="alert" data-error>{{ e }}</p> }
    </app-glass-sheet>
  `,
  styles: [`
    .as__to { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .as__sel { position: relative; display: inline-flex; align-items: center; color: var(--ink-2); min-width: 0; }
    .as__sel select {
      appearance: none; height: 40px; padding: 0 32px 0 12px; max-width: min(250px, 62vw); text-overflow: ellipsis;
      border: 1px solid var(--hair); border-radius: 12px; background: var(--surface); color: var(--ink);
      font: 600 14px var(--sans); cursor: pointer;
    }
    .as__sel app-icon { position: absolute; right: 10px; pointer-events: none; }
    .as__list { display: grid; }
    .as__row {
      display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 0; width: 100%;
      border-bottom: 1px solid var(--hair); text-align: left; color: var(--ink); cursor: pointer; text-decoration: none;
    }
    .as__row:last-child { border-bottom: 0; }
    .as__row:focus-within { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 8px; }
    .as__row.is-off { opacity: .45; pointer-events: none; }
    .as__tx { display: grid; gap: 1px; min-width: 0; }
    .as__tx b { font-size: 15px; font-weight: 650; }
    .as__tx span { font-size: 12.5px; color: var(--ink-2); }
    .fic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--fill); color: var(--ink-2); }
    .fic--pdf { background: color-mix(in srgb, var(--red) 11%, transparent); color: var(--red); }
    .fic--photo { background: color-mix(in srgb, var(--teal) 14%, transparent); color: var(--teal); }
    .fic--note { background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--amber); }
    .fic--pass { background: color-mix(in srgb, var(--blue) 13%, transparent); color: var(--blue); }
    .as__note { margin-top: 10px; font-size: 12.5px; color: var(--ink-2); text-align: center; }
    .as__err { margin-top: 10px; font-size: 13px; color: var(--red-ink); }
    .as__form { display: grid; gap: 8px; }
    .as__lbl { font-size: 13px; font-weight: 600; color: var(--ink-2); }
    .as__in {
      width: 100%; min-height: 46px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--hair);
      background: var(--surface); color: var(--ink); font: 500 15px var(--sans);
    }
    .as__in::placeholder { color: var(--ink-3); }
    .as__ta { resize: vertical; min-height: 96px; }
    .as__in:focus-visible { outline: 2px solid var(--blue); outline-offset: 0; }
    .as__acts { display: flex; gap: 10px; margin-top: 8px; }
    .as__acts .ui-btn { flex: 1; }
  `],
})
export class AddFileSheetComponent {
  private readonly files = inject(FilesService);
  private readonly state = inject(AppStateService);

  readonly trip = input.required<Trip>();
  /** Where the sheet was opened from. */
  readonly scope = input<AttachmentScope>({ kind: 'trip' });
  /** 'note' or 'address' opens that form directly. */
  readonly start = input<Mode>('menu');
  readonly closed = output<void>();
  readonly added = output<Attachment[]>();

  protected readonly mode = linkedSignal<Mode>(() => this.start());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly picked = signal<string | null>(null);
  protected readonly options = computed(() => scopeOptions(this.trip()));
  protected readonly target = computed(() => {
    const want = this.picked() ?? scopeKey(this.scope());
    return this.options().some(o => o.key === want) ? want : 'trip';
  });
  protected readonly passPath = computed(() => addPassPath(this.trip().id));
  protected readonly passQuery = computed(() => {
    const s = scopeFromKey(this.target());
    return addPassQuery(s.kind === 'leg' ? s.legId : null);
  });

  protected setTarget(e: Event): void {
    this.picked.set((e.target as HTMLSelectElement).value);
  }

  protected async pickFiles(e: Event, sheet: GlassSheetComponent): Promise<void> {
    const input = e.target as HTMLInputElement;
    const list = Array.from(input.files ?? []);
    input.value = '';
    if (!list.length) return;
    this.busy.set(true);
    this.error.set(null);
    const scope = scopeFromKey(this.target());
    const done: Attachment[] = [];
    for (const f of list) {
      const r = await this.files.addFile(this.trip().id, scope, f);
      if ('error' in r) {
        this.error.set(list.length > 1 ? `${f.name}: ${filesErrorText(r.error, f.size)}` : filesErrorText(r.error, f.size));
        break;
      }
      done.push(r);
    }
    this.busy.set(false);
    if (done.length) {
      this.added.emit(done);
      this.flashAdded(done.length);
    }
    if (!this.error()) sheet.close();
  }

  protected async saveText(title: string, body: string, sheet: GlassSheetComponent): Promise<void> {
    if (!body.trim()) {
      this.error.set(this.mode() === 'address' ? 'Type the address first.' : 'Type the note first.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const scope = scopeFromKey(this.target());
    const r = this.mode() === 'address'
      ? await this.files.addAddress(this.trip().id, scope, title, body)
      : await this.files.addNote(this.trip().id, scope, title, body);
    this.busy.set(false);
    if ('error' in r) {
      this.error.set(filesErrorText(r.error));
      return;
    }
    this.added.emit([r]);
    this.flashAdded(1);
    sheet.close();
  }

  private flashAdded(n: number): void {
    const where = this.options().find(o => o.key === this.target())?.label ?? 'this trip';
    const short = where.includes(' · ') ? where.split(' · ')[0] : where;
    this.state.flash(`${n === 1 ? 'Saved' : `${n} files saved`} to ${short === 'Whole trip' ? 'the trip' : short}`);
  }
}

