import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { FilesService } from '../../files/files.service';
import type { Attachment } from '../../files/model';
import type { Trip } from '../../trips/model';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { filesErrorText, itemMeta, scopeFromKey, scopeKey, scopeOptions } from './files-model';

type Mode = 'menu' | 'rename' | 'move' | 'text';

/**
 * The "⋯" / long-press sheet of one file: Open, Rename, Move to… (Whole
 * trip, a leg or a day), edit a note or address, and Delete (the service
 * flashes Undo).
 */
@Component({
  selector: 'app-file-item-sheet',
  standalone: true,
  imports: [GlassSheetComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet #sheet [title]="item().title" [open]="true" (closed)="closed.emit()">
      @let a = item();
      <p class="fs__meta tn">{{ meta() }}</p>
      @if (error(); as e) {
        <p class="fs__err" role="alert" data-item-error>{{ e }}</p>
      }
      @switch (mode()) {
        @case ('rename') {
          <form class="fs__form" (submit)="$event.preventDefault(); rename(nameIn.value, sheet)">
            <label class="fs__lbl" for="fs-name">Name</label>
            <input #nameIn id="fs-name" class="fs__in" [value]="a.title" maxlength="120" autocomplete="off" data-rename-input>
            <div class="fs__acts">
              <button type="button" class="ui-btn ui-btn--ghost" (click)="mode.set('menu')">Cancel</button>
              <button type="submit" class="ui-btn ui-btn--dark" data-rename-save>Save</button>
            </div>
          </form>
        }
        @case ('text') {
          <form class="fs__form" (submit)="$event.preventDefault(); saveText(textIn.value, sheet)">
            <label class="fs__lbl" for="fs-text">{{ a.kind === 'address' ? 'Address' : 'Note' }}</label>
            <textarea #textIn id="fs-text" class="fs__in fs__ta" rows="4" maxlength="4000" [value]="a.text ?? ''" data-text-input></textarea>
            <div class="fs__acts">
              <button type="button" class="ui-btn ui-btn--ghost" (click)="mode.set('menu')">Cancel</button>
              <button type="submit" class="ui-btn ui-btn--dark" data-text-save>Save</button>
            </div>
          </form>
        }
        @case ('move') {
          <fieldset class="fs__move">
            <legend class="ui-label">Move to</legend>
            @for (o of options(); track o.key) {
              <label class="fs__opt">
                <input type="radio" name="fs-move" [value]="o.key" [checked]="o.key === current()" (change)="pick.set(o.key)">
                <span>{{ o.label }}</span>
              </label>
            }
          </fieldset>
          <div class="fs__acts">
            <button type="button" class="ui-btn ui-btn--ghost" (click)="mode.set('menu')">Cancel</button>
            <button type="button" class="ui-btn ui-btn--dark" data-move-save [disabled]="(pick() ?? current()) === current()" (click)="move(sheet)">Move</button>
          </div>
        }
        @default {
          <div class="fs__list" role="group" aria-label="File actions">
            @if (a.blobId || a.kind === 'address') {
              <button type="button" class="fs__row" data-act="open" (click)="open(sheet)">
                <app-icon [name]="a.kind === 'address' ? 'map' : 'external'" [size]="18" />
                <span>{{ a.kind === 'address' ? 'Open in Maps' : 'Open' }}</span>
              </button>
            }
            <button type="button" class="fs__row" data-act="rename" (click)="mode.set('rename')">
              <app-icon name="note" [size]="18" /><span>Rename</span>
            </button>
            @if (a.kind === 'note' || a.kind === 'address') {
              <button type="button" class="fs__row" data-act="text" (click)="mode.set('text')">
                <app-icon name="note" [size]="18" /><span>{{ a.kind === 'address' ? 'Edit address' : 'Edit note' }}</span>
              </button>
            }
            <button type="button" class="fs__row" data-act="move" (click)="mode.set('move')">
              <app-icon name="calendar" [size]="18" /><span>Move to…</span>
              <span class="fs__cur">{{ currentLabel() }}</span>
            </button>
            <button type="button" class="fs__row fs__row--del" data-act="delete" (click)="remove(sheet)">
              <app-icon name="trash" [size]="18" /><span>Delete</span>
            </button>
          </div>
        }
      }
    </app-glass-sheet>
  `,
  styles: [`
    .fs__meta { font-size: 13px; color: var(--ink-2); margin: -2px 0 12px; overflow-wrap: anywhere; }
    .fs__err { font-size: 13px; font-weight: 600; color: var(--red-ink); margin: 0 0 10px; }
    .fs__list { display: grid; }
    .fs__row {
      display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 2px; width: 100%;
      border-bottom: 1px solid var(--hair); text-align: left; font-size: 15px; font-weight: 600; color: var(--ink); cursor: pointer;
    }
    .fs__row:last-child { border-bottom: 0; }
    .fs__row app-icon { color: var(--ink-2); }
    .fs__row--del, .fs__row--del app-icon { color: var(--red-ink); }
    .fs__cur { margin-left: auto; font-size: 13px; font-weight: 500; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
    .fs__form { display: grid; gap: 8px; }
    .fs__lbl { font-size: 13px; font-weight: 600; color: var(--ink-2); }
    .fs__in {
      width: 100%; min-height: 46px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--hair);
      background: var(--surface); color: var(--ink); font: 500 15px var(--sans);
    }
    .fs__ta { resize: vertical; min-height: 96px; }
    .fs__in:focus-visible { outline: 2px solid var(--blue); outline-offset: 0; }
    .fs__acts { display: flex; gap: 10px; margin-top: 8px; }
    .fs__acts .ui-btn { flex: 1; }
    .fs__move { border: 0; padding: 0; margin: 0; display: grid; gap: 2px; max-height: 50dvh; overflow: auto; }
    .fs__move legend { margin-bottom: 6px; }
    .fs__opt { display: flex; align-items: center; gap: 12px; min-height: 46px; font-size: 15px; cursor: pointer; border-bottom: 1px solid var(--hair); }
    .fs__opt input { width: 20px; height: 20px; accent-color: var(--ink); flex: none; }
  `],
})
export class FileItemSheetComponent {
  private readonly files = inject(FilesService);
  readonly item = input.required<Attachment>();
  readonly trip = input.required<Trip>();
  readonly closed = output<void>();
  /** Images open in the page's own viewer. */
  readonly view = output<Attachment>();

  protected readonly mode = signal<Mode>('menu');
  protected readonly pick = signal<string | null>(null);
  /** Why the last save failed; the sheet stays open so nothing typed is lost. */
  protected readonly error = signal<string | null>(null);
  protected readonly meta = computed(() => itemMeta(this.item()));
  protected readonly options = computed(() => scopeOptions(this.trip()));
  protected readonly current = computed(() => scopeKey(this.item().scope));
  protected readonly currentLabel = computed(() => this.options().find(o => o.key === this.current())?.label ?? 'Whole trip');
  protected async rename(value: string, sheet: GlassSheetComponent): Promise<void> {
    const v = value.trim();
    if (v && v !== this.item().title) await this.save({ title: v }, sheet);
    else sheet.close();
  }

  protected saveText(value: string, sheet: GlassSheetComponent): Promise<void> {
    return this.save({ text: value.trim() }, sheet);
  }

  protected async move(sheet: GlassSheetComponent): Promise<void> {
    const key = this.pick();
    if (key && key !== this.current()) await this.save({ scope: scopeFromKey(key) }, sheet);
    else sheet.close();
  }

  private async save(patch: Parameters<FilesService['update']>[1], sheet: GlassSheetComponent): Promise<void> {
    this.error.set(null);
    const err = await this.files.update(this.item().id, patch);
    if (err) this.error.set(filesErrorText(err));
    else sheet.close();
  }

  protected open(sheet: GlassSheetComponent): void {
    const a = this.item();
    sheet.close();
    if (a.kind === 'image') this.view.emit(a);
    else void this.files.open(a);
  }

  protected remove(sheet: GlassSheetComponent): void {
    const id = this.item().id;
    sheet.close();
    void this.files.remove(id);
  }
}
