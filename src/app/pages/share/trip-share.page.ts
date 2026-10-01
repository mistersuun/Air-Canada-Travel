import {
  ChangeDetectionStrategy, Component, DestroyRef, InjectionToken, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { type ShareEnv, copyText, downloadBlob, shareImage, shareText } from '../../share/share-out';
import { renderTripCard } from '../../share/trip-card';
import {
  type ShareOptions, backupsSummary, hasBackups, shareFilename, splitNote, tripShareText,
} from '../../share/trip-share-text';
import { AppStateService } from '../../state/app-state.service';
import type { Trip } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { SegComponent, type SegOption } from '../../ui/seg.component';

/** Draws the card (the real canvas renderer by default; specs stub it). */
export const CARD_RENDERER = new InjectionToken<(trip: Trip, opts: ShareOptions) => Promise<Blob>>('CARD_RENDERER', {
  providedIn: 'root',
  factory: () => (trip, opts) => renderTripCard(trip, opts),
});

/** The browser APIs used to send (navigator.share, clipboard, document for downloads). */
export const SHARE_ENV = new InjectionToken<() => ShareEnv>('SHARE_ENV', {
  providedIn: 'root',
  factory: () => () => ({
    navigator: typeof navigator === 'undefined' ? null : navigator,
    document: typeof document === 'undefined' ? null : document,
  }),
});

type Tab = 'image' | 'text';

/**
 * Share trip (/trips/:id/share), mock x14: the plan as an image card (drawn
 * on this phone, 1080 wide) or as plain text. "Share…" opens the phone's
 * share sheet; without one it saves the image or copies the text. What is
 * never included (booking codes, boarding passes, files) is said on screen
 * before anything is sent.
 */
@Component({
  selector: 'app-trip-share-page',
  standalone: true,
  imports: [IconComponent, SegComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare ts">
      @if (trip(); as t) {
        <header class="ts__head">
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Close" data-close (click)="back()">
            <app-icon name="close" [size]="18" />
          </button>
          <div class="ts__title">
            <h1 class="ui-h3">Share trip</h1>
            <p class="ts__sub">{{ t.name }}</p>
          </div>
          <span class="ts__sp" aria-hidden="true"></span>
        </header>

        <app-seg class="ts__seg" stretch [options]="tabs" [value]="tab()" (valueChange)="setTab($event)" ariaLabel="Share as" />

        @if (tab() === 'image') {
          <div class="ts__card" [class.is-busy]="!url()" data-preview>
            @if (url(); as src) {
              <img [src]="src" [alt]="'Trip card. ' + text()" width="1080" [attr.height]="height()">
            } @else if (failed()) {
              <p class="ts__fail" role="status">The image couldn't be drawn on this browser. You can share the plan as text.</p>
            } @else {
              <span class="ui-visually-hidden" role="status">Drawing the card…</span>
            }
          </div>
        } @else {
          <pre class="ts__txt tn" tabindex="0" role="textbox" aria-readonly="true" aria-multiline="true"
               aria-label="Text to share" data-text>{{ text() }}</pre>
        }

        @if (hasNote() || backups()) {
          <section class="ui-card ts__opts" aria-label="What to include">
            @if (hasNote()) {
              <label class="ts__sw" for="ts-split">
                <span><b>Include "If we split up"</b><span class="ts__muted">Your note for companions</span></span>
                <input id="ts-split" type="checkbox" role="switch" class="switch" data-split
                       [checked]="includeSplit()" (change)="includeSplit.set($any($event.target).checked)">
              </label>
            }
            @if (backups(); as b) {
              <label class="ts__sw" for="ts-backups">
                <span><b>Include backups</b><span class="ts__muted tn">{{ b }}</span></span>
                <input id="ts-backups" type="checkbox" role="switch" class="switch" data-backups
                       [checked]="includeBackups()" (change)="includeBackups.set($any($event.target).checked)">
              </label>
            }
          </section>
        }

        @if (tab() === 'image') {
          <section class="ui-card ts__incl" aria-label="What the image has" data-checklist>
            <ul>
              <li class="y"><app-icon name="check" [size]="15" [strokeWidth]="2.4" />
                <span>{{ opts().includeSplitNote ? 'Legs, times and your split-up note' : 'Legs and times' }}</span></li>
              <li class="n"><app-icon name="close" [size]="15" [strokeWidth]="2.4" />
                <span><span class="ui-visually-hidden">Never included: </span>Boarding passes and booking codes</span></li>
              <li class="n"><app-icon name="close" [size]="15" [strokeWidth]="2.4" />
                <span><span class="ui-visually-hidden">Never included: </span>Files and photos</span></li>
            </ul>
          </section>
        } @else {
          <p class="ts__note" data-never>
            <app-icon name="lock" [size]="16" [strokeWidth]="2" />
            <span>Booking codes, boarding passes and files are never added, even if you turn everything on.</span>
          </p>
        }

        <div class="ts__acts">
          <button type="button" class="ui-btn ui-btn--dark" data-share (click)="share()"
                  [disabled]="tab() === 'image' && !blob()">
            <app-icon name="share" [size]="17" /> Share…
          </button>
          @if (tab() === 'image') {
            <button type="button" class="ui-btn ui-btn--ghost" data-save (click)="save()" [disabled]="!blob()">
              <app-icon name="download" [size]="17" /> Save image
            </button>
          } @else {
            <button type="button" class="ui-btn ui-btn--ghost" data-copy (click)="copy()">
              <app-icon name="copy" [size]="17" /> Copy text
            </button>
          }
        </div>
        <p class="ts__foot">Times are local. A standby plan, not a booking. Made on this phone.</p>
      }
    </div>
  `,
  styles: [`
    .ts { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .ts__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .ts__title { min-width: 0; text-align: center; }
    .ts__title h1 { margin: 0; }
    .ts__sub { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ts__sp { width: 40px; flex: none; }
    .ts__seg { margin-top: 2px; }
    .ts__card {
      margin-top: 12px; border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-l);
      background: linear-gradient(165deg, #CFE6FF 0%, #EAF3FF 46%, #FFFFFF 100%);
      align-self: center; width: 100%; max-width: 480px;
    }
    .ts__card.is-busy { aspect-ratio: 1080 / 1160; }
    .ts__card img { display: block; width: 100%; height: auto; }
    .ts__fail { padding: 24px 20px; font-size: 13.5px; color: #5B6475; text-align: center; }
    .ts__txt {
      white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 12px; line-height: 1.55; background: var(--surface); border-radius: 14px;
      box-shadow: inset 0 0 0 1px var(--hair); padding: 12px 14px; margin: 14px 0 0; color: var(--ink);
      user-select: text; -webkit-user-select: text;
    }
    .ts__txt:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    .ts__opts { margin-top: 12px; padding: 2px 14px; }
    .ts__sw {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0;
      border-bottom: 1px solid var(--hair); cursor: pointer; min-height: 44px;
    }
    .ts__sw:last-child { border-bottom: 0; }
    .ts__sw > span { display: grid; gap: 1px; min-width: 0; }
    .ts__sw b { font-size: 14px; font-weight: 650; }
    .ts__muted { font-size: 12.5px; color: var(--ink-2); }
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
    .ts__incl { margin-top: 12px; padding: 12px 14px; }
    .ts__incl ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; font-size: 13px; }
    .ts__incl li { display: flex; gap: 8px; align-items: center; }
    .ts__incl .y app-icon { color: var(--teal); }
    .ts__incl .n { color: var(--ink-2); }
    .ts__incl .n app-icon { color: var(--red); }
    .ts__note {
      display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; margin-top: 12px;
      font-size: 12.5px; background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-ink);
    }
    .ts__note app-icon { color: var(--blue); margin-top: 1px; }
    .ts__acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
    .ts__acts .ui-btn { min-height: 48px; padding: 13px 12px; }
    .ts__foot { margin: 16px 8px 0; font-size: 12px; color: var(--ink-2); text-align: center; }
    @media (min-width: 720px) {
      .ts { padding-top: 24px; }
    }
  `],
})
export class TripSharePage {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly render = inject(CARD_RENDERER);
  private readonly env = inject(SHARE_ENV);

  readonly id = input.required<string>();

  protected readonly tabs: SegOption[] = [{ value: 'image', label: 'Image' }, { value: 'text', label: 'Text' }];
  protected readonly tab = signal<Tab>('image');
  protected readonly includeSplit = signal(true);
  protected readonly includeBackups = signal(false);

  protected readonly trip = computed(() => this.trips.trips().find(t => t.id === this.id()) ?? null);
  protected readonly hasNote = computed(() => {
    const t = this.trip();
    return !!t && splitNote(t) !== null;
  });
  protected readonly backups = computed(() => {
    const t = this.trip();
    return t && hasBackups(t) ? backupsSummary(t) : '';
  });
  readonly opts = computed<ShareOptions>(() => ({
    includeSplitNote: this.includeSplit() && this.hasNote(),
    includeBackups: this.includeBackups() && !!this.backups(),
    fmt: this.state.timeFormat(),
  }));
  readonly text = computed(() => {
    const t = this.trip();
    return t ? tripShareText(t, this.opts()) : '';
  });

  protected readonly blob = signal<Blob | null>(null);
  protected readonly url = signal<string | null>(null);
  protected readonly height = signal(1080);
  protected readonly failed = signal(false);
  private drawn = 0;

  constructor() {
    // Re-draw the card whenever the trip or an option changes; the newest draw wins.
    effect(() => {
      const t = this.trip();
      const o = this.opts();
      if (!t) return;
      untracked(() => void this.draw(t, o));
    });
    inject(DestroyRef).onDestroy(() => {
      this.drawn++;
      this.setUrl(null);
    });
  }

  private async draw(trip: Trip, opts: ShareOptions): Promise<void> {
    const n = ++this.drawn;
    try {
      const blob = await this.render(trip, opts);
      if (n !== this.drawn) return;
      this.blob.set(blob);
      this.failed.set(false);
      this.height.set(await pngHeight(blob));
      if (n !== this.drawn) return;
      this.setUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null);
    } catch {
      if (n !== this.drawn) return;
      this.blob.set(null);
      this.setUrl(null);
      this.failed.set(true);
    }
  }

  private setUrl(next: string | null): void {
    const prev = this.url();
    if (prev && prev !== next && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(prev);
    this.url.set(next);
  }

  protected setTab(v: string | undefined): void {
    this.tab.set(v === 'text' ? 'text' : 'image');
  }

  private title(): string {
    const t = this.trip();
    return t ? `${t.goal.name} trip plan` : 'Trip plan';
  }

  protected async share(): Promise<void> {
    const t = this.trip();
    if (!t) return;
    if (this.tab() === 'text') {
      this.flashText(await shareText(this.text(), this.title(), this.env()));
      return;
    }
    const blob = this.blob();
    if (!blob) return;
    this.flashImage(await shareImage(blob, shareFilename(t), this.title(), this.env()));
  }

  protected save(): void {
    const t = this.trip();
    const blob = this.blob();
    if (!t || !blob) return;
    this.flashImage(downloadBlob(blob, shareFilename(t), this.env()));
  }

  protected async copy(): Promise<void> {
    this.flashText(await copyText(this.text(), this.env()));
  }

  private flashText(r: 'shared' | 'copied' | 'cancelled' | 'failed'): void {
    if (r === 'copied') this.state.flash('Copied');
    else if (r === 'failed') this.state.flash("Couldn't copy. Select the text and copy it.");
  }

  private flashImage(r: 'shared' | 'downloaded' | 'cancelled' | 'failed'): void {
    if (r === 'downloaded') this.state.flash('Image saved');
    else if (r === 'failed') this.state.flash("Couldn't save the image");
  }

  protected back(): void {
    this.state.goBack(['/trips', this.id()]);
  }
}

/** The height of a PNG from its IHDR (bytes 20–23), 1080 when it can't be read. */
async function pngHeight(blob: Blob): Promise<number> {
  try {
    const buf = typeof blob.arrayBuffer === 'function' ? await blob.slice(0, 24).arrayBuffer() : null;
    if (!buf || buf.byteLength < 24) return 1080;
    const h = new DataView(buf).getUint32(20);
    return h > 0 && h < 10000 ? h : 1080;
  } catch {
    return 1080;
  }
}
