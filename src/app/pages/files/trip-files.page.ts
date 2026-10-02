import {
  ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, Injector, afterNextRender, computed, effect, inject, input, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { passPath } from '../../extras/links';
import { FilesService } from '../../files/files.service';
import { Attachment, AttachmentScope, MEMORY_WARNING } from '../../files/model';
import { PassesService } from '../../passes/passes.service';
import { AppStateService } from '../../state/app-state.service';
import { TripsService } from '../../trips/trips.service';
import { AddFileSheetComponent } from './add-file-sheet.component';
import { FileItemSheetComponent } from './file-item-sheet.component';
import {
  categoryCounts, fileSections, isIos, itemIcon, itemMeta, passImageBytes, persistNote, photoTiles, sectionId,
  usageBars, usageTitle,
} from './files-model';
import { summarizeUsage } from '../../files/files.service';
import { LongPressDirective } from './long-press.directive';
import { PhotoViewerComponent } from './photo-viewer.component';

/**
 * Trip files (/trips/:id/files?day=<dateKey>), mock x11: a usage card (size
 * on this phone by category, "Include in backup export"), then the files
 * grouped "Whole trip" and by day and leg, the leg's boarding passes row
 * ("Not shared"), a 3-up photo grid, notes and addresses. Long-press or "⋯"
 * opens Rename / Move to… / Delete. Everything is read from this phone, so
 * the page works offline.
 */
@Component({
  selector: 'app-trip-files-page',
  standalone: true,
  imports: [
    IconComponent, RouterLink, LongPressDirective, AddFileSheetComponent, FileItemSheetComponent, PhotoViewerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare tf">
      @if (trip(); as t) {
        <header class="tf__head">
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <div class="tf__title">
            <h1 class="ui-h3">Files</h1>
            <p class="tf__sub">{{ t.name }}</p>
          </div>
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Add a file" data-add [disabled]="readOnly()"
                  (click)="openAdd({ kind: 'trip' })">
            <svg class="plus" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </header>

        <section class="ui-card tf__use" aria-label="Storage on this phone" data-usage>
          <div class="tf__use-h">
            <h2 class="ui-h3 tn" data-usage-title>{{ title() }}</h2>
            <span class="tf__muted">on this phone</span>
          </div>
          @if (bars().length) {
            <div class="tf__bar" aria-hidden="true">
              @for (b of bars(); track b.cat) { <i [class]="'c-' + b.cat" [style.flex-grow]="b.pct"></i> }
            </div>
            <ul class="tf__legend tn" aria-label="By kind" data-legend>
              @for (b of bars(); track b.cat) { <li><i [class]="'c-' + b.cat" aria-hidden="true"></i>{{ b.text }}</li> }
            </ul>
          }
          <label class="tf__sw" for="tf-backup">
            <span><b>Include in backup export</b>
              <span class="tf__muted" data-backup-state>{{ files.prefs().includeInBackup ? 'On · passes are never included' : 'Off · passes are never shared' }}</span>
            </span>
            <input id="tf-backup" type="checkbox" role="switch" class="switch" data-backup
                   [checked]="files.prefs().includeInBackup" (change)="setBackup($event)">
          </label>
          @if (status() === 'memory') {
            <p class="tf__warn" role="status" data-memory>{{ memoryWarning }}</p>
          } @else if (status() === 'readOnly') {
            <p class="tf__warn" role="status">Files were saved by a newer version of the app. You can open them, but changes won't be kept.</p>
          } @else if (status() === 'error') {
            <p class="tf__warn" role="status">Files couldn't be opened on this browser right now. Reload to try again.</p>
          } @else if (keepNote(); as n) {
            <p class="tf__note" data-persist>{{ n }}</p>
          }
        </section>

        @if (loaded()) {
          @for (s of sections(); track s.key) {
            <section class="tf__sec" [id]="secId(s.key)" [attr.data-day]="s.dateKey" [attr.aria-labelledby]="secId(s.key) + '-h'">
              <div class="tf__day">
                <h2 class="ui-label tn" [id]="secId(s.key) + '-h'">{{ s.title }}</h2>
                @if (s.aside) { <span class="tf__muted">{{ s.aside }}</span> }
              </div>

              @if (s.passes.length || s.items.length || s.photos.length) {
                <div class="ui-card tf__card">
                  @for (g of s.passes; track g.firstId) {
                    <a class="row" [routerLink]="pass(t.id, g.firstId)" data-passes>
                      <span class="fic fic--pass"><app-icon name="barcode" [size]="19" /></span>
                      <span class="rt"><b>Boarding passes</b><span class="m tn">{{ g.meta }}</span></span>
                      <span class="lock"><app-icon name="lock" [size]="12" [strokeWidth]="2.2" />Not shared</span>
                    </a>
                  }
                  @if (s.photos.length) {
                    @let tiles = tilesOf(s.photos);
                    <div class="thumbs" data-thumbs>
                      @for (p of tiles.shown; track p.id; let i = $index) {
                        <button type="button" class="thumb" appLongPress #lp="appLongPress" (longPress)="menuFor.set(p)"
                                [attr.aria-label]="p.title + ', photo ' + (i + 1) + ' of ' + s.photos.length"
                                (click)="lp.took() || view(s.photos, i)">
                          @if (urls()[p.blobId ?? '']; as src) { <img [src]="src" alt="" loading="lazy" decoding="async"> }
                        </button>
                      }
                      @if (tiles.more) {
                        <button type="button" class="thumb thumb--more tn" data-more-photos
                                [attr.aria-label]="'Show ' + tiles.more + ' more photos'" (click)="view(s.photos, tiles.shown.length)">+{{ tiles.more }}</button>
                      }
                    </div>
                  }
                  @for (a of s.items; track a.id) {
                    @let ic = iconOf(a);
                    <div class="row" [attr.data-item]="a.id">
                      <button type="button" class="row__main" appLongPress #lp="appLongPress" (longPress)="menuFor.set(a)"
                              (click)="lp.took() || open(a)" [attr.aria-label]="openLabel(a)">
                        @if (files.thumbUrl(a); as src) {
                          <span class="fic fic--thumb" data-thumb><img [src]="src" alt="" decoding="async"></span>
                        } @else {
                          <span [class]="'fic fic--' + ic.tone"><app-icon [name]="ic.name" [size]="19" /></span>
                        }
                        <span class="rt"><b>{{ a.title }}</b><span class="m tn" [class.m--wrap]="a.kind === 'note'">{{ meta(a) }}</span></span>
                      </button>
                      <button type="button" class="row__more" [attr.aria-label]="'More for ' + a.title" data-item-more (click)="menuFor.set(a)">
                        <app-icon name="more" [size]="18" />
                      </button>
                    </div>
                  }
                </div>
              } @else if (s.emptyLeg; as l) {
                <button type="button" class="ui-card tf__empty" data-empty-leg (click)="openAdd({ kind: 'leg', legId: l.id })" [disabled]="readOnly()">
                  <svg class="plus" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add a pass or file for this leg
                </button>
              } @else if (s.key === 'trip') {
                <button type="button" class="ui-card tf__empty" data-empty-trip (click)="openAdd({ kind: 'trip' })" [disabled]="readOnly()">
                  <svg class="plus" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add a confirmation, ticket, note or address
                </button>
              }
            </section>
          }
          <p class="tf__foot">On this phone only. Opens offline. Boarding passes are never in share links or backups.</p>
        } @else {
          <p class="tf__foot" role="status">Opening files on this phone…</p>
        }

        @if (adding(); as sc) {
          <app-add-file-sheet [trip]="t" [scope]="sc" (closed)="adding.set(null)" />
        }
        @if (menuFor(); as a) {
          <app-file-item-sheet [item]="a" [trip]="t" (closed)="menuFor.set(null)" (view)="viewOne($event)" />
        }
        @if (viewing(); as v) {
          <app-photo-viewer [photos]="v.photos" [start]="v.index" [urls]="urls()" (closed)="viewing.set(null)" (more)="menuLater($event)" />
        }
      }
    </div>
  `,
  styles: [`
    .tf { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .tf__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .tf__title { min-width: 0; text-align: center; }
    .tf__title h1 { margin: 0; }
    .tf__sub { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tf__muted { font-size: 13px; color: var(--ink-2); font-weight: 400; }
    .tf__use { padding: 16px; display: grid; gap: 0; }
    .tf__use-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .tf__use-h h2 { margin: 0; }
    .tf__bar { display: flex; gap: 2px; height: 8px; border-radius: 4px; overflow: hidden; background: var(--fill); margin-top: 12px; }
    .tf__bar i { display: block; height: 100%; flex-basis: 0; min-width: 3px; }
    .tf__legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 8px 0 0; padding: 0; list-style: none; font-size: 12px; color: var(--ink-2); }
    .tf__legend li { display: inline-flex; align-items: center; gap: 5px; }
    .tf__legend i { width: 8px; height: 8px; border-radius: 3px; display: inline-block; }
    .c-passes { background: var(--blue); }
    .c-pdfs { background: var(--red); }
    .c-photos { background: var(--teal); }
    .c-notes { background: var(--amber); }
    .c-other { background: var(--ink-3); }
    .tf__sw { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; cursor: pointer; min-height: 44px; }
    .tf__sw > span { display: grid; gap: 1px; }
    .tf__sw b { font-size: 14px; font-weight: 650; }
    .tf__warn { margin-top: 12px; font-size: 13px; color: var(--amber-ink); }
    .tf__note { margin-top: 12px; font-size: 13px; color: var(--ink-2); }
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
    .tf__sec { scroll-margin-top: 16px; }
    .tf__day { margin: 20px 4px 0; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .tf__day h2 { margin: 0; font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tf__card { margin-top: 8px; padding: 2px 14px; }
    .row { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--hair); min-width: 0; color: var(--ink); text-decoration: none; }
    .row:last-child { border-bottom: 0; }
    .row__main { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; text-align: left; color: inherit; cursor: pointer; min-height: 44px;
      -webkit-touch-callout: none; user-select: none; }
    .row__more { width: 44px; height: 44px; margin-right: -10px; display: grid; place-items: center; flex: none; color: var(--ink-2); border-radius: 12px; cursor: pointer; }
    .row__more:hover { color: var(--ink); }
    .rt { flex: 1; min-width: 0; display: grid; }
    .rt b { font-weight: 650; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .m { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .m--wrap { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .fic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; background: var(--fill); color: var(--ink-2); }
    .fic--pass { background: color-mix(in srgb, var(--blue) 13%, transparent); color: var(--blue); }
    .fic--pdf { background: color-mix(in srgb, var(--red) 11%, transparent); color: var(--red); }
    .fic--photo { background: color-mix(in srgb, var(--teal) 14%, transparent); color: var(--teal); }
    .fic--note { background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--amber); }
    .fic--ground { background: color-mix(in srgb, var(--teal) 14%, transparent); color: var(--teal); }
    .fic--thumb { overflow: hidden; }
    .fic--thumb img { width: 100%; height: 100%; object-fit: cover; }
    .lock { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 650; color: var(--teal-ink); white-space: nowrap; }
    .thumbs { display: flex; gap: 6px; padding: 10px 0 8px; border-bottom: 1px solid var(--hair); }
    .thumbs:last-child { border-bottom: 0; }
    .thumb {
      width: 62px; height: 62px; border-radius: 12px; overflow: hidden; background: var(--fill); flex: none; cursor: pointer; padding: 0;
      -webkit-touch-callout: none; user-select: none;
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .thumb--more { display: grid; place-items: center; color: var(--ink-2); font-weight: 650; font-size: 13px; }
    .tf__empty {
      margin-top: 8px; width: 100%; min-height: 48px; padding: 12px 14px; display: flex; align-items: center; gap: 10px;
      color: var(--ink-2); font-size: 13px; text-align: left; cursor: pointer;
    }
    .tf__empty .plus { color: var(--ink-3); }
    .plus { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; flex: none; }
    .tf__empty:disabled { opacity: .55; cursor: default; }
    .tf__foot { margin: 18px 8px 0; font-size: 12.5px; color: var(--ink-2); text-align: center; }
    @media (min-width: 720px) {
      .tf { padding-top: 24px; }
    }
  `],
})
export class TripFilesPage {
  protected readonly files = inject(FilesService);
  private readonly passes = inject(PassesService);
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  readonly id = input.required<string>();
  /** ?day=<dateKey>: scrolls to that day. */
  readonly day = input<string | undefined>(undefined);

  protected readonly memoryWarning = MEMORY_WARNING;
  protected readonly loaded = signal(false);
  protected readonly adding = signal<AttachmentScope | null>(null);
  protected readonly menuFor = signal<Attachment | null>(null);
  protected readonly viewing = signal<{ photos: Attachment[]; index: number } | null>(null);
  protected readonly urls = signal<Record<string, string>>({});
  private readonly info = signal<{ persisted: boolean | null; installed: boolean } | null>(null);

  protected readonly trip = computed(() => this.trips.trips().find(t => t.id === this.id()) ?? null);
  protected readonly status = this.files.status;
  protected readonly readOnly = computed(() => this.status() === 'readOnly' || this.status() === 'error');
  private readonly mine = computed(() => this.files.forTrip(this.id()));
  private readonly myPasses = computed(() => this.passes.passes().filter(p => p.tripId === this.id()));
  protected readonly sections = computed(() => {
    const t = this.trip();
    return t ? fileSections(t, this.mine(), this.myPasses()) : [];
  });
  private readonly usage = computed(() =>
    summarizeUsage(this.mine(), this.myPasses().length, passImageBytes(this.myPasses(), id => this.passes.imageSize(id))));
  protected readonly title = computed(() => usageTitle(this.usage().count, this.usage().bytes));
  protected readonly bars = computed(() => usageBars(this.usage(), categoryCounts(this.mine(), this.myPasses().length)));
  protected readonly keepNote = computed(() => persistNote(this.info(), isIos(this.doc.defaultView?.navigator)));

  constructor() {
    const destroyRef = inject(DestroyRef);
    void this.files.ensureReady().catch(() => undefined).then(() => {
      this.loaded.set(true);
      afterNextRender(() => this.scrollToDay(), { injector: this.injector });
    });
    void this.files.storageInfo().then(i => this.info.set(i), () => undefined);

    // Previews for the listed PDFs and photos (made in the background when missing).
    effect(() => this.files.ensureThumbs(this.mine()));

    // Object URLs for this trip's photos (loaded once each, revoked on leave).
    const asked = new Set<string>();
    let destroyed = false;
    effect(() => {
      for (const a of this.mine()) {
        if (a.kind !== 'image' || !a.blobId || asked.has(a.blobId)) continue;
        const id = a.blobId;
        asked.add(id);
        void this.files.objectUrl(id, a.mime).then(url => {
          if (!url) return;
          if (destroyed) URL.revokeObjectURL(url); // the page left while this was loading
          else this.urls.update(m => ({ ...m, [id]: url }));
        });
      }
    });
    destroyRef.onDestroy(() => {
      destroyed = true;
      for (const url of Object.values(this.urls())) URL.revokeObjectURL(url);
    });
  }

  protected secId(key: string): string {
    return sectionId(key);
  }

  protected pass(tripId: string, passId: string): string[] {
    return passPath(tripId, passId);
  }

  protected tilesOf(photos: Attachment[]) {
    return photoTiles(photos);
  }

  protected iconOf(a: Attachment) {
    return itemIcon(a, this.trip());
  }

  protected meta(a: Attachment): string {
    return itemMeta(a);
  }

  protected openLabel(a: Attachment): string {
    if (a.kind === 'address') return `${a.title}, ${a.text ?? ''}. Open in Maps`;
    if (a.kind === 'note') return `${a.title}: ${a.text ?? ''}`;
    return `Open ${a.title}, ${itemMeta(a)}`;
  }

  protected openAdd(scope: AttachmentScope): void {
    this.adding.set(scope);
  }

  protected open(a: Attachment): void {
    if (a.kind === 'note') this.menuFor.set(a);
    else if (a.kind === 'image') this.viewOne(a);
    else void this.files.open(a);
  }

  protected view(photos: Attachment[], index: number): void {
    this.viewing.set({ photos, index });
  }

  protected viewOne(a: Attachment): void {
    const s = this.sections().find(x => x.photos.some(p => p.id === a.id));
    const photos = s?.photos ?? [a];
    this.viewing.set({ photos, index: Math.max(0, photos.findIndex(p => p.id === a.id)) });
  }

  /** "⋯" in the viewer: open the item sheet once the viewer has closed. */
  protected menuLater(a: Attachment): void {
    setTimeout(() => this.menuFor.set(a));
  }

  protected setBackup(e: Event): void {
    this.files.setPrefs({ includeInBackup: (e.target as HTMLInputElement).checked });
  }

  protected back(): void {
    this.state.goBack(['/trips', this.id()]);
  }

  private scrollToDay(): void {
    const d = this.day();
    if (!d) return;
    const el = this.doc.getElementById(sectionId(d));
    el?.scrollIntoView?.({ block: 'start' });
  }
}
