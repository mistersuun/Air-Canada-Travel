import {
  ChangeDetectionStrategy, Component, DestroyRef, InjectionToken, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { t } from '../../i18n/t';
import { IconComponent } from '../../components/shared/icons.component';
import { SHARE_ENV, type ShareEnv, copyText, downloadBlob, shareImage, shareText } from '../../share/share-out';
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

export { SHARE_ENV };

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
      @if (trip(); as tr) {
        <header class="ts__head">
          <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('common.close')" data-close (click)="back()">
            <app-icon name="close" [size]="18" />
          </button>
          <div class="ts__title">
            <h1 class="ui-h3">{{ t('share.trip.title') }}</h1>
            <p class="ts__sub">{{ tr.name }}</p>
          </div>
          <span class="ts__sp" aria-hidden="true"></span>
        </header>

        <app-seg class="ts__seg" stretch [options]="tabs()" [value]="tab()" (valueChange)="setTab($event)" [ariaLabel]="t('share.trip.as')" />

        @if (tab() === 'image') {
          <div class="ts__card" [class.is-busy]="!url()" data-preview>
            @if (url(); as src) {
              <img [src]="src" [alt]="t('share.trip.alt', { text: text() })" width="1080" [attr.height]="height()">
            } @else if (failed()) {
              <p class="ts__fail" role="status">{{ t('share.trip.fail') }}</p>
            } @else {
              <span class="ui-visually-hidden" role="status">{{ t('share.drawing') }}</span>
            }
          </div>
        } @else {
          <pre class="ts__txt tn" tabindex="0" role="textbox" aria-readonly="true" aria-multiline="true"
               [attr.aria-label]="t('share.trip.textAria')" data-text>{{ text() }}</pre>
        }

        @if (hasNote() || backups()) {
          <section class="ui-card ts__opts" [attr.aria-label]="t('share.include')">
            @if (hasNote()) {
              <label class="ts__sw" for="ts-split">
                <span><b>{{ t('share.trip.split') }}</b><span class="ts__muted">{{ t('share.trip.splitHint') }}</span></span>
                <input id="ts-split" type="checkbox" role="switch" class="switch" data-split
                       [checked]="includeSplit()" (change)="includeSplit.set($any($event.target).checked)">
              </label>
            }
            @if (backups(); as b) {
              <label class="ts__sw" for="ts-backups">
                <span><b>{{ t('share.trip.backups') }}</b><span class="ts__muted tn">{{ b }}</span></span>
                <input id="ts-backups" type="checkbox" role="switch" class="switch" data-backups
                       [checked]="includeBackups()" (change)="includeBackups.set($any($event.target).checked)">
              </label>
            }
          </section>
        }

        @if (tab() === 'image') {
          <section class="ui-card ts__incl" [attr.aria-label]="t('share.trip.imageHas')" data-checklist>
            <ul>
              <li class="y"><app-icon name="check" [size]="15" [strokeWidth]="2.4" />
                <span>{{ opts().includeSplitNote ? t('share.trip.legsSplit') : t('share.trip.legs') }}</span></li>
              <li class="n"><app-icon name="close" [size]="15" [strokeWidth]="2.4" />
                <span><span class="ui-visually-hidden">{{ t('share.trip.never') }} </span>{{ t('share.trip.neverPasses') }}</span></li>
              <li class="n"><app-icon name="close" [size]="15" [strokeWidth]="2.4" />
                <span><span class="ui-visually-hidden">{{ t('share.trip.never') }} </span>{{ t('share.trip.neverFiles') }}</span></li>
            </ul>
          </section>
        } @else {
          <p class="ts__note" data-never>
            <app-icon name="lock" [size]="16" [strokeWidth]="2" />
            <span>{{ t('share.trip.note') }}</span>
          </p>
        }

        <div class="ts__acts">
          <button type="button" class="ui-btn ui-btn--dark" data-share (click)="share()"
                  [disabled]="tab() === 'image' && !blob()">
            <app-icon name="share" [size]="17" /> {{ t('share.shareDots') }}
          </button>
          @if (tab() === 'image') {
            <button type="button" class="ui-btn ui-btn--ghost" data-save (click)="save()" [disabled]="!blob()">
              <app-icon name="download" [size]="17" /> {{ t('share.saveImage') }}
            </button>
          } @else {
            <button type="button" class="ui-btn ui-btn--ghost" data-copy (click)="copy()">
              <app-icon name="copy" [size]="17" /> {{ t('share.trip.copy') }}
            </button>
          }
        </div>
        <p class="ts__foot">{{ t('share.trip.foot') }}</p>
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
  protected readonly t = t;
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly render = inject(CARD_RENDERER);
  private readonly env = inject(SHARE_ENV);

  readonly id = input.required<string>();

  protected readonly tabs = computed<SegOption[]>(() => [
    { value: 'image', label: t('share.trip.tabImage') },
    { value: 'text', label: t('share.trip.tabText') },
  ]);
  protected readonly tab = signal<Tab>('image');
  protected readonly includeSplit = signal(true);
  protected readonly includeBackups = signal(false);

  protected readonly trip = computed(() => this.trips.trips().find(tr => tr.id === this.id()) ?? null);
  protected readonly hasNote = computed(() => {
    const tr = this.trip();
    return !!tr && splitNote(tr) !== null;
  });
  protected readonly backups = computed(() => {
    const tr = this.trip();
    return tr && hasBackups(tr) ? backupsSummary(tr) : '';
  });
  readonly opts = computed<ShareOptions>(() => ({
    includeSplitNote: this.includeSplit() && this.hasNote(),
    includeBackups: this.includeBackups() && !!this.backups(),
    fmt: this.state.timeFormat(),
  }));
  readonly text = computed(() => {
    const tr = this.trip();
    return tr ? tripShareText(tr, this.opts()) : '';
  });

  protected readonly blob = signal<Blob | null>(null);
  protected readonly url = signal<string | null>(null);
  protected readonly height = signal(1080);
  protected readonly failed = signal(false);
  private drawn = 0;

  constructor() {
    // Re-draw the card whenever the trip or an option changes; the newest draw wins.
    effect(() => {
      const tr = this.trip();
      const o = this.opts();
      if (!tr) return;
      untracked(() => void this.draw(tr, o));
    });
    inject(DestroyRef).onDestroy(() => {
      this.drawn++;
      this.setUrl(null);
    });
  }

  private async draw(trip: Trip, opts: ShareOptions): Promise<void> {
    const n = ++this.drawn;
    // The old image no longer matches the options: Share and Save wait for this draw.
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

  protected setTab(v: string | undefined): void {
    this.tab.set(v === 'text' ? 'text' : 'image');
  }

  private title(): string {
    const tr = this.trip();
    return tr ? t('share.trip.planOf', { goal: tr.goal.name }) : t('share.trip.plan');
  }

  protected async share(): Promise<void> {
    const tr = this.trip();
    if (!tr) return;
    if (this.tab() === 'text') {
      this.flashText(await shareText(this.text(), this.title(), this.env()));
      return;
    }
    const blob = this.blob();
    if (!blob) return;
    this.flashImage(await shareImage(blob, shareFilename(tr), this.title(), this.env()));
  }

  protected save(): void {
    const tr = this.trip();
    const blob = this.blob();
    if (!tr || !blob) return;
    this.flashImage(downloadBlob(blob, shareFilename(tr), this.env()));
  }

  protected async copy(): Promise<void> {
    this.flashText(await copyText(this.text(), this.env()));
  }

  private flashText(r: 'shared' | 'copied' | 'cancelled' | 'failed'): void {
    if (r === 'copied') this.state.flash(t('common.copied'));
    else if (r === 'failed') this.state.flash(t('share.trip.copyFailed'));
  }

  private flashImage(r: 'shared' | 'downloaded' | 'cancelled' | 'failed'): void {
    if (r === 'downloaded') this.state.flash(t('share.imageSaved'));
    else if (r === 'failed') this.state.flash(t('share.imageFailed'));
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
