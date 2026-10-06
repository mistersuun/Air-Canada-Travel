import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { addPassPath, filesPath } from '../../extras/links';
import { FilesService } from '../../files/files.service';
import { FILES_ERROR_TEXT } from '../../files/model';
import { BarcodeService } from '../../passes/barcode.service';
import { isBcbp } from '../../passes/decode-core';
import { ShareInboxService } from '../../share-in/share-inbox.service';
import {
  type SharedKind, actionsFor, noteTextFrom, noteTitleFrom, sharedKind,
} from '../../share-in/share-payload';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { tripPath } from '../../ui/links';

interface Row { file: File; kind: SharedKind; passLike: boolean | null }

/**
 * /share-in: where Android's Share sheet and desktop "Open with" land.
 * Photos and PDFs are checked for a boarding-pass barcode on this device and
 * can go to the add-pass flow or be kept as a trip file; text can be saved as
 * a note. Everything stays on this device; the temporary copy is deleted as
 * soon as it has been read.
 */
@Component({
  selector: 'app-share-in-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page si">
      <h1 class="ui-h2">Add to a trip</h1>
      @if (loading()) {
        <p class="ui-sub" role="status">Opening what you shared…</p>
      } @else if (!hasContent()) {
        <div class="ui-card si__empty" data-empty>
          <p><b>Nothing to add.</b> This share has expired or was already used.</p>
          <a class="ui-btn ui-btn--dark ui-btn--sm" routerLink="/trips">My trips</a>
        </div>
      } @else if (!trips().length) {
        <div class="ui-card si__empty" data-no-trips>
          <p><b>You have no trips yet.</b> Start a trip first, then share again.</p>
          <a class="ui-btn ui-btn--dark ui-btn--sm" routerLink="/">Find a flight</a>
        </div>
      } @else {
        <label class="ui-card si__trip">
          <span class="ui-label">Trip</span>
          <select data-trip [value]="tripId()" (change)="tripId.set($any($event.target).value)">
            @for (t of trips(); track t.id) { <option [value]="t.id" [selected]="t.id === tripId()">{{ t.name }}</option> }
          </select>
        </label>

        @for (r of rows(); track $index) {
          <section class="ui-card si__item" [attr.data-kind]="r.kind">
            <h2 class="ui-h3">{{ r.file.name }}</h2>
            @if (r.passLike) { <p class="ui-sub" data-pass-like>This looks like a boarding pass.</p> }
            <div class="si__acts">
              @if (actions(r.kind).pass) {
                <button type="button" class="ui-btn ui-btn--sm" [class.ui-btn--dark]="r.passLike" [class.ui-btn--ghost]="!r.passLike"
                        data-add-pass (click)="addPass(r)">Add boarding pass</button>
              }
              <button type="button" class="ui-btn ui-btn--sm" [class.ui-btn--dark]="!r.passLike" [class.ui-btn--ghost]="r.passLike"
                      data-save-file [disabled]="busy()" (click)="saveFile(r)">Save to trip files</button>
              @if (actions(r.kind).note) {
                <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-save-note [disabled]="busy()" (click)="saveFileNote(r)">Save as a note</button>
              }
            </div>
          </section>
        }

        @if (text()) {
          <section class="ui-card si__item" data-text>
            <h2 class="ui-h3">{{ item()?.title || 'Shared text' }}</h2>
            <pre class="si__txt">{{ text() }}</pre>
            <div class="si__acts">
              <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" data-save-text [disabled]="busy()" (click)="saveText()">Save as a note</button>
            </div>
          </section>
        }
        @if (error()) { <p class="si__err" role="alert">{{ error() }}</p> }
        <p class="ui-sub si__priv">Stays on this device. Nothing is uploaded.</p>
        <button type="button" class="ui-btn ui-btn--ghost" data-dismiss (click)="dismiss()">Not now</button>
      }
    </div>
  `,
  styles: [`
    .si { display: grid; gap: 14px; align-content: start; }
    .si__trip, .si__item, .si__empty { display: grid; gap: 10px; padding: 14px 16px; }
    .si__trip select { height: 44px; border: 1px solid var(--hair); border-radius: 12px; padding: 0 10px; background: var(--surface); color: var(--ink); font: 600 15px var(--sans); }
    .si__acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .si__txt { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; font: 14px var(--sans); }
    .si__err { color: var(--red, #b3261e); font-size: 14px; }
    .si__priv { text-align: center; }
  `],
})
export class ShareInPage {
  /** ?id= from the service worker's redirect; absent for desktop File Handling. */
  readonly id = input<string | undefined>(undefined);

  private readonly inbox = inject(ShareInboxService);
  private readonly trips_ = inject(TripsService);
  private readonly files = inject(FilesService);
  private readonly barcode = inject(BarcodeService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly item = this.inbox.item;
  protected readonly rows = signal<Row[]>([]);
  protected readonly tripId = signal('');
  protected readonly trips = computed(() => this.trips_.trips().filter(t => !t.archived));
  protected readonly text = computed(() => {
    const it = this.item();
    return it ? noteTextFrom(it) : '';
  });
  protected readonly hasContent = computed(() => this.rows().length > 0 || !!this.text());
  protected readonly actions = actionsFor;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.inbox.clear());
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    effect(() => {
      const list = this.trips();
      if (!this.tripId() && list.length) this.tripId.set((this.trips_.activeTrips().find(t => !t.archived) ?? list[0]).id);
    });
  }

  private async load(id: string | undefined): Promise<void> {
    if (id) await this.inbox.loadStash(id);
    const it = this.item();
    const rows: Row[] = (it?.files ?? []).map(file => ({ file, kind: sharedKind(file), passLike: null }));
    this.rows.set(rows);
    this.loading.set(false);
    // Boarding-pass check, on this device. Slow for PDFs: results fill in as they finish.
    rows.forEach((r, i) => {
      if (!actionsFor(r.kind).pass) return;
      void this.looksLikePass(r).then(passLike => this.rows.update(list => list.map((x, j) => (j === i ? { ...x, passLike } : x))));
    });
  }

  private async looksLikePass(r: Row): Promise<boolean> {
    try {
      if (r.kind === 'pdf') return (await this.barcode.decodePdf(r.file, 1)).reads.some(x => isBcbp(x.text));
      const read = await this.barcode.decodeImage(r.file);
      return !!read && isBcbp(read.text);
    } catch {
      return false;
    }
  }

  /** Hands the file to the existing add-pass flow, which reads and confirms it. */
  protected addPass(r: Row): void {
    const id = this.tripId();
    this.inbox.handoff(r.file);
    void this.router.navigate(addPassPath(id));
  }

  protected async saveFile(r: Row): Promise<void> {
    const id = this.tripId();
    if (!id) return;
    this.busy.set(true);
    const res = await this.files.addFile(id, { kind: 'trip' }, r.file);
    this.busy.set(false);
    if ('error' in res) {
      this.error.set(FILES_ERROR_TEXT[res.error]);
      return;
    }
    this.done(id, 'Saved to trip files');
  }

  protected async saveFileNote(r: Row): Promise<void> {
    const id = this.tripId();
    const it = this.item();
    if (!id || !it) return;
    await this.saveNote(id, noteTitleFrom(it, r.file.name), noteTextFrom(it, await r.file.text()));
  }

  protected async saveText(): Promise<void> {
    const id = this.tripId();
    const it = this.item();
    if (!id || !it) return;
    await this.saveNote(id, noteTitleFrom(it), noteTextFrom(it));
  }

  private async saveNote(id: string, title: string, body: string): Promise<void> {
    this.busy.set(true);
    const res = await this.files.addNote(id, { kind: 'trip' }, title, body);
    this.busy.set(false);
    if ('error' in res) {
      this.error.set(FILES_ERROR_TEXT[res.error]);
      return;
    }
    this.done(id, 'Saved as a note');
  }

  private done(tripId: string, message: string): void {
    this.state.flash(message);
    this.inbox.clear();
    void this.router.navigate(filesPath(tripId));
  }

  protected dismiss(): void {
    this.inbox.clear();
    void this.router.navigate(this.tripId() ? tripPath(this.tripId()) : ['/trips']);
  }
}
