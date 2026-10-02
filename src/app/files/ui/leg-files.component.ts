import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { filesPath } from '../../extras/links';
import { filesErrorText, itemIcon, itemMeta, legDay } from '../../pages/files/files-model';
import { AppStateService } from '../../state/app-state.service';
import type { Trip, TripLeg } from '../../trips/model';
import { FilesService } from '../files.service';
import type { Attachment } from '../model';

/** Rows shown in the leg sheet before "See all". */
export const LEG_FILES_MAX = 3;

/**
 * Leg sheet "Files" (extras spec §2.2): up to 3 of the leg's files (tap to
 * open them, offline), "See all N" to the trip's Files page at that day, and
 * "Add a file" (one or more, saved to this leg).
 */
@Component({
  selector: 'app-leg-files',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lf" aria-labelledby="lf-h" data-leg-files>
      <div class="lf__h">
        <h3 class="ui-h3" id="lf-h">Files</h3>
        @if (items().length) {
          <a class="lf__all" [routerLink]="filesLink()" [queryParams]="dayQuery()" data-see-all>
            {{ items().length > max ? 'See all ' + items().length : 'All trip files' }}
          </a>
        }
      </div>
      @if (items().length) {
        <ul class="lf__list">
          @for (a of shown(); track a.id) {
            @let ic = iconOf(a);
            <li>
              <button type="button" class="lf__row" (click)="open(a)" [attr.data-file]="a.id">
                @if (thumb(a); as src) {
                  <span class="fic fic--thumb" data-thumb><img [src]="src" alt="" decoding="async"></span>
                } @else {
                  <span [class]="'fic fic--' + ic.tone"><app-icon [name]="ic.name" [size]="18" /></span>
                }
                <span class="lf__tx"><b>{{ a.title }}</b><span class="tn">{{ meta(a) }}</span></span>
              </button>
            </li>
          }
        </ul>
      }
      <label class="lf__add" [class.is-off]="busy()">
        <svg class="plus" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {{ busy() ? 'Saving…' : 'Add a file' }}
        <input type="file" multiple class="ui-visually-hidden" data-leg-add [disabled]="busy()" (change)="add($event)">
      </label>
      @if (error(); as e) { <p class="lf__err" role="alert">{{ e }}</p> }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .lf { display: grid; gap: 6px; }
    .lf__h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .lf__h h3 { margin: 0; }
    .lf__all { font-size: 13px; color: var(--blue); font-weight: 500; white-space: nowrap; }
    .lf__list { list-style: none; margin: 0; padding: 0; display: grid; }
    .lf__row {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 6px 0; text-align: left;
      border-bottom: 1px solid var(--hair); color: var(--ink); cursor: pointer;
    }
    .lf__tx { display: grid; min-width: 0; }
    .lf__tx b { font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lf__tx span { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fic { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; flex: none; background: var(--fill); color: var(--ink-2); }
    .fic--pdf { background: color-mix(in srgb, var(--red) 11%, transparent); color: var(--red); }
    .fic--photo, .fic--ground { background: color-mix(in srgb, var(--teal) 14%, transparent); color: var(--teal); }
    .fic--note { background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--amber); }
    .fic--thumb { overflow: hidden; }
    .fic--thumb img { width: 100%; height: 100%; object-fit: cover; }
    .lf__add {
      display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px; border-radius: 14px;
      background: var(--fill); color: var(--ink); font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .lf__add:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .lf__add.is-off { opacity: .55; pointer-events: none; }
    .plus { fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-linecap: round; flex: none; }
    .lf__err { font-size: 13px; color: var(--red-ink); }
  `],
})
export class LegFilesComponent {
  private readonly files = inject(FilesService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  readonly trip = input.required<Trip>();
  readonly leg = input.required<TripLeg>();

  protected readonly max = LEG_FILES_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly items = computed(() =>
    this.files.attachments().filter(a => a.tripId === this.trip().id && a.scope.kind === 'leg' && a.scope.legId === this.leg().id));
  protected readonly shown = computed(() => this.items().slice(0, LEG_FILES_MAX));
  protected readonly filesLink = computed(() => filesPath(this.trip().id));
  protected readonly dayQuery = computed(() => {
    const d = legDay(this.leg());
    return d ? { day: d } : {};
  });

  constructor() {
    void this.files.ensureReady().catch(() => undefined);
    effect(() => this.files.ensureThumbs(this.shown()));
  }

  /** The file's preview (PDF page 1 or the photo), once made. */
  protected thumb(a: Attachment): string | null {
    return this.files.thumbUrl(a);
  }

  protected iconOf(a: Attachment) {
    return itemIcon(a, this.trip());
  }

  protected meta(a: Attachment): string {
    return itemMeta(a);
  }

  /** Files open in a new tab (offline), addresses in Maps; a note opens the Files page at its day. */
  protected open(a: Attachment): void {
    if (a.kind === 'note') void this.router.navigate(this.filesLink(), { queryParams: this.dayQuery() });
    else void this.files.open(a);
  }

  protected async add(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const list = Array.from(input.files ?? []);
    input.value = '';
    if (!list.length) return;
    this.busy.set(true);
    this.error.set(null);
    let n = 0;
    for (const f of list) {
      const r = await this.files.addFile(this.trip().id, { kind: 'leg', legId: this.leg().id }, f);
      if ('error' in r) {
        this.error.set(filesErrorText(r.error, f.size));
        break;
      }
      n++;
    }
    this.busy.set(false);
    if (n) this.state.flash(n === 1 ? 'Saved to this leg' : `${n} files saved to this leg`);
  }
}
