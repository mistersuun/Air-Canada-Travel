import {
  ChangeDetectionStrategy, Component, DestroyRef, InjectionToken, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { recapLine, returnBoarded, tripRecap } from '../../logbook/logbook';
import {
  DEFAULT_RECAP_OPTIONS, type RecapOptions, loadDestPhoto, recapFilename, renderRecapCard,
} from '../../share/recap-card';
import { downloadBlob, shareImage } from '../../share/share-out';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import type { Trip } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { SHARE_ENV } from './trip-share.page';

/** Draws the recap (the real canvas renderer by default; specs stub it). */
export const RECAP_RENDERER = new InjectionToken<(trip: Trip, opts: RecapOptions) => Promise<Blob>>('RECAP_RENDERER', {
  providedIn: 'root',
  factory: () => {
    const photos = inject(PhotoService);
    return (trip, opts) => renderRecapCard(trip, opts, {
      photo: async code => (photos.has(code) ? loadDestPhoto(code, photos.position(code)) : null),
    });
  },
});

/**
 * Trip recap (/trips/:id/recap): a picture of a finished trip, drawn on this
 * phone. A destination photo, the place and dates, and one line of counts.
 * The route arc and the standby record ("Boarded 3 of 4 tries") are off
 * until switched on. Booking codes, passes, files and notes never reach it.
 */
@Component({
  selector: 'app-recap-page',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rp ui-page ui-page--bare">
      @if (trip(); as t) {
        <header class="rp__head">
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Close" data-close (click)="back()">
            <app-icon name="close" [size]="18" />
          </button>
          <div class="rp__title">
            <h1 class="ui-h3">Trip recap</h1>
            <p class="rp__sub">{{ t.name }}</p>
          </div>
          <span class="rp__sp" aria-hidden="true"></span>
        </header>

        @if (!ready()) {
          <p class="ui-sub rp__wait" data-not-ready role="status">A recap is available once your way home is marked as boarded.</p>
        } @else {
          <div class="rp__card" [class.is-busy]="!url()" data-preview>
            @if (url(); as src) {
              <img [src]="src" [alt]="alt()" width="1080" [attr.height]="height()">
            } @else if (failed()) {
              <p class="rp__fail" role="status">The image couldn't be drawn on this browser.</p>
            } @else {
              <span class="ui-visually-hidden" role="status">Drawing the card…</span>
            }
          </div>

          <section class="ui-card rp__opts" aria-label="What to include">
            <label class="rp__sw" for="rp-arc">
              <span><b>Route arc</b><span class="rp__muted">A dashed line from home to {{ t.goal.name }}</span></span>
              <input id="rp-arc" type="checkbox" role="switch" class="switch" data-arc
                     [checked]="arc()" (change)="arc.set($any($event.target).checked)">
            </label>
            @if (hasTries()) {
              <label class="rp__sw" for="rp-record">
                <span><b>Standby record</b><span class="rp__muted tn">{{ recordText() }}</span></span>
                <input id="rp-record" type="checkbox" role="switch" class="switch" data-record
                       [checked]="record()" (change)="record.set($any($event.target).checked)">
              </label>
            }
          </section>

          <p class="rp__note" data-never>
            <app-icon name="lock" [size]="16" [strokeWidth]="2" />
            <span>Counts only. Booking codes, boarding passes, files and notes are never added.</span>
          </p>

          <div class="rp__acts">
            <button type="button" class="ui-btn ui-btn--dark" data-share (click)="share()" [disabled]="!blob()">
              <app-icon name="share" [size]="17" /> Share…
            </button>
            <button type="button" class="ui-btn ui-btn--ghost" data-save (click)="save()" [disabled]="!blob()">
              <app-icon name="download" [size]="17" /> Save image
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .rp { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .rp__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .rp__title { min-width: 0; text-align: center; }
    .rp__title h1 { margin: 0; }
    .rp__sub { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rp__sp { width: 40px; flex: none; }
    .rp__wait { text-align: center; margin-top: 24px; }
    .rp__card {
      margin-top: 12px; border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-l);
      background: linear-gradient(165deg, #CFE6FF 0%, #EAF3FF 46%, #FFFFFF 100%);
      align-self: center; width: 100%; max-width: 480px;
    }
    .rp__card.is-busy { aspect-ratio: 1080 / 1200; }
    .rp__card img { display: block; width: 100%; height: auto; }
    .rp__fail { padding: 24px 20px; font-size: 13.5px; color: #5B6475; text-align: center; }
    .rp__opts { margin-top: 12px; padding: 2px 14px; }
    .rp__sw {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0;
      border-bottom: 1px solid var(--hair); cursor: pointer; min-height: 44px;
    }
    .rp__sw:last-child { border-bottom: 0; }
    .rp__sw > span { display: grid; gap: 1px; min-width: 0; }
    .rp__sw b { font-size: 14px; font-weight: 650; }
    .rp__muted { font-size: 12.5px; color: var(--ink-2); }
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
    @media (prefers-reduced-motion: reduce) { .switch, .switch::after { transition: none; } }
    .rp__note {
      display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; margin-top: 12px;
      font-size: 12.5px; background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-ink);
    }
    .rp__note app-icon { color: var(--blue); margin-top: 1px; }
    .rp__acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
    .rp__acts .ui-btn { min-height: 48px; padding: 13px 12px; }
    @media (min-width: 720px) { .rp { padding-top: 24px; } }
  `],
})
export class RecapPage {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly render = inject(RECAP_RENDERER);
  private readonly env = inject(SHARE_ENV);

  readonly id = input.required<string>();

  protected readonly arc = signal(DEFAULT_RECAP_OPTIONS.arc);
  /** Off by default: nobody's tries are shared unless they choose. */
  protected readonly record = signal(DEFAULT_RECAP_OPTIONS.standbyRecord);

  protected readonly trip = computed(() => this.trips.trips().find(t => t.id === this.id()) ?? null);
  protected readonly ready = computed(() => {
    const t = this.trip();
    return !!t && returnBoarded(t);
  });
  private readonly summary = computed(() => {
    const t = this.trip();
    return t ? tripRecap(t, this.trips.outcomes()) : null;
  });
  protected readonly hasTries = computed(() => (this.summary()?.tries ?? 0) > 0);
  protected readonly recordText = computed(() => {
    const s = this.summary();
    return s ? `Boarded ${s.boarded} of ${s.tries} ${s.tries === 1 ? 'try' : 'tries'}` : '';
  });
  readonly opts = computed<RecapOptions>(() => ({
    arc: this.arc(), standbyRecord: this.record() && this.hasTries(), outcomes: this.trips.outcomes(),
  }));
  protected readonly alt = computed(() => {
    const s = this.summary();
    return s ? `Trip recap. ${recapLine(s)}` : 'Trip recap';
  });

  protected readonly blob = signal<Blob | null>(null);
  protected readonly url = signal<string | null>(null);
  protected readonly height = signal(1080);
  protected readonly failed = signal(false);
  private drawn = 0;

  constructor() {
    effect(() => {
      const t = this.trip();
      const o = this.opts();
      if (!t || !this.ready()) return;
      untracked(() => void this.draw(t, o));
    });
    inject(DestroyRef).onDestroy(() => {
      this.drawn++;
      this.setUrl(null);
    });
  }

  private async draw(trip: Trip, opts: RecapOptions): Promise<void> {
    const n = ++this.drawn;
    this.blob.set(null);
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

  protected async share(): Promise<void> {
    const t = this.trip();
    const blob = this.blob();
    if (!t || !blob) return;
    const r = await shareImage(blob, recapFilename(t), `${t.goal.name} trip recap`, this.env());
    if (r === 'downloaded') this.state.flash('Image saved');
    else if (r === 'failed') this.state.flash("Couldn't save the image");
  }

  protected save(): void {
    const t = this.trip();
    const blob = this.blob();
    if (!t || !blob) return;
    const r = downloadBlob(blob, recapFilename(t), this.env());
    this.state.flash(r === 'downloaded' ? 'Image saved' : "Couldn't save the image");
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
