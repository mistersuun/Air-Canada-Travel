import {
  ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, InjectionToken, Injector, afterNextRender, computed, effect, inject, input, signal, untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { FILES_ERROR_TEXT, safeMime } from '../../files/model';
import { IconComponent } from '../../components/shared/icons.component';
import { passPath } from '../../extras/links';
import { renderBarcodeSvg } from '../../passes/barcode-render';
import type { PassRecord } from '../../passes/model';
import { PassSwapService, swapOfferFor } from '../../passes/pass-swap.service';
import { PassesService } from '../../passes/passes.service';
import { AppStateService } from '../../state/app-state.service';
import type { FlightRef, Trip } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { tripPath } from '../../ui/links';
import { airportName } from '../../utils/airports';
import { formatClock } from '../../utils/time';
import { dayLabel, legById } from '../trips/trips-model';
import { flightLegs, legOptionLabel, passName } from './add-pass-model';

/** navigator.wakeLock, or null where the browser has none (tests provide a fake). */
export interface WakeLockLike { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener?(t: 'release', f: () => void): void }> }
export const WAKE_LOCK = new InjectionToken<WakeLockLike | null>('WAKE_LOCK', {
  providedIn: 'root',
  factory: () => (typeof navigator !== 'undefined' ? (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock ?? null : null),
});

interface Slide {
  pass: PassRecord;
  ref: FlightRef | null;           // the matched segment (Scheduled departure)
  fromName: string;
  toName: string;
  date: string;                    // 'Thu Oct 8'
  departs: string;                 // '17:55' or '–'
}

/**
 * bwip-js output, made to fill its box: the SVG scales to the CSS size
 * (preserveAspectRatio none) so PDF417 rows can be drawn taller. Square
 * codes keep a 1:1 box, so they never distort.
 */
export function fitSvg(svg: string): string {
  // The wrapper is the labelled role=img; the SVG itself is hidden from assistive tech.
  return svg.replace(/<svg\b/, '<svg preserveAspectRatio="none" aria-hidden="true" focusable="false"');
}

/** 'Montréal' style names for the route header (the code when unknown). */
function cityOf(code: string): string {
  const n = airportName(code);
  return n === code ? '' : n;
}

/**
 * The pass, full screen (/trips/:id/pass/:passId), mock x10. A fixed layer
 * over the shell that is always white with dark ink, in both themes, so gate
 * scanners read it at night too. Keeps the screen on with the Wake Lock API
 * where there is one. Works offline: the pass and the barcode renderer are on
 * the phone. The booking code is shown here and in the add step only.
 */
@Component({
  selector: 'app-pass-view-page',
  standalone: true,
  imports: [IconComponent, GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pv-host' },
  template: `
    <div class="pv" role="dialog" aria-modal="true" aria-label="Boarding pass" data-pass-view>
      <div class="pv__col">
        <div class="pv__top">
          <button #closeBtn type="button" class="pv__x" aria-label="Close" data-close (click)="close()"><app-icon name="close" [size]="18" [strokeWidth]="2.2" /></button>
          @if (awake()) {
            <span class="pv__awake" data-awake><app-icon name="sun" [size]="14" [strokeWidth]="2.2" />Screen stays on</span>
          } @else if (wakeTried()) {
            <span class="pv__noawake" data-no-awake>Keep the screen on yourself; this browser can't.</span>
          } @else { <span></span> }
          @if (current()) {
            <button type="button" class="pv__x" aria-label="Pass options" data-more (click)="menuOpen.set(true)"><app-icon name="more" [size]="18" [strokeWidth]="2.2" /></button>
          }
        </div>

        @if (!ready()) {
          <p class="pv__msg" role="status">Opening the pass…</p>
        } @else if (!slides().length) {
          <div class="pv__msg" data-missing>
            <b>This pass isn't on this phone.</b>
            <span>It may have been deleted, or saved in another browser.</span>
            <button type="button" class="pv__btn" (click)="close()">Back to the trip</button>
          </div>
        } @else {
          <div #track class="pv__track" (scroll)="onScroll()"
               [attr.role]="slides().length > 1 ? 'group' : null" [attr.aria-label]="slides().length > 1 ? 'Passes on this leg' : null">
            @for (s of slides(); track s.pass.id; let i = $index) {
              <article class="pv__slide" [attr.aria-hidden]="i !== index()" [attr.data-slide]="s.pass.id">
                <div class="pv__route tn">
                  <div><span class="pv__code">{{ s.pass.from }}</span><small>{{ s.fromName }}</small></div>
                  <div class="pv__mid" aria-hidden="true"><i></i><app-icon name="plane" [size]="22" [strokeWidth]="2" /><i></i></div>
                  <div class="pv__r"><span class="pv__code">{{ s.pass.to }}</span><small>{{ s.toName }}</small></div>
                </div>
                <dl class="pv__grid tn">
                  <div><dt>Flight</dt><dd>{{ s.pass.flightNumber }}</dd></div>
                  <div><dt>Departs<span class="ui-visually-hidden"> (scheduled)</span></dt><dd [attr.title]="s.ref ? 'Scheduled' : null">{{ s.departs }}</dd></div>
                  <div><dt>Seat</dt><dd>{{ s.pass.seat ?? '–' }}</dd></div>
                  <div><dt>Seq</dt><dd>{{ s.pass.sequence ?? '–' }}</dd></div>
                </dl>
                <p class="pv__who"><span><b>{{ name(s.pass) }}</b> · {{ s.pass.cabin }}</span><span class="tn">{{ s.date }}@if (s.date) { · }<b data-pnr>{{ s.pass.pnr }}</b></span></p>

                <div class="pv__bc" [class.is-square]="s.pass.format !== 'PDF417'">
                  @if (mode() === 'image' && i === index() && imageUrl()) {
                    <img class="pv__img" [src]="imageUrl()" alt="Your original boarding pass image" data-original>
                  } @else if (svgs()[s.pass.id]; as svg) {
                    <div class="pv__svg" role="img" [attr.aria-label]="s.pass.format + ' barcode for ' + s.pass.flightNumber" [innerHTML]="svg" data-barcode></div>
                  } @else if (failed().has(s.pass.id)) {
                    <p class="pv__bcmsg" data-render-failed>The barcode can't be drawn here. Use your original image.</p>
                  } @else {
                    <p class="pv__bcmsg">Drawing the barcode…</p>
                  }
                </div>
              </article>
            }
          </div>

          <div class="pv__seg" role="group" aria-label="Show">
            <button type="button" [class.on]="mode() === 'barcode'" [attr.aria-pressed]="mode() === 'barcode'" data-mode="barcode" (click)="mode.set('barcode')">Barcode</button>
            <button type="button" [class.on]="mode() === 'image'" [attr.aria-pressed]="mode() === 'image'" data-mode="image"
                    [disabled]="!current()?.imageBlobId" (click)="showImage()">Original image</button>
          </div>
          <p class="pv__bright">Turn your screen brightness up at the gate.</p>

          <div class="pv__foot">
            @if (offer(); as o) {
              <div class="pv__swap" data-swap-offer>
                <p>{{ o.text }}</p>
                <button type="button" class="pv__btn" data-swap [disabled]="swapping()" (click)="swap()">Swap to {{ o.flightNumber }}</button>
              </div>
            }
            @if (slides().length > 1) {
              <div class="pv__nav">
                <button type="button" class="pv__btn pv__btn--ghost" data-prev [disabled]="index() === 0" (click)="go(index() - 1)">Previous pass</button>
                <button type="button" class="pv__btn pv__btn--ghost" data-next [disabled]="index() === slides().length - 1" (click)="go(index() + 1)">Next pass</button>
              </div>
              <p data-count aria-live="polite">{{ index() + 1 }} of {{ slides().length }} passes on this leg · swipe for the next</p>
            }
          </div>
        }
      </div>
    </div>

    @if (menuOpen() && current(); as p) {
      <app-glass-sheet title="Pass options" [open]="true" (closed)="closeMenu()">
        <div class="pm">
          <label class="pm__row">
            <span class="pm__tx"><b>Delete after the trip</b><small>Removed the day after you're home</small></span>
            <input type="checkbox" role="switch" class="switch" [checked]="p.deleteAfterTrip" data-delete-after
                   (change)="setDeleteAfter(p, $any($event.target).checked)">
          </label>
          @if (moving()) {
            <fieldset class="pm__pick" data-move-list>
              <legend class="ui-label">Move to another leg</legend>
              @for (o of moveOptions(); track o.id) {
                <label class="pm__opt">
                  <input type="radio" name="pv-move" [value]="o.id" [checked]="(p.legId ?? '') === o.id" (change)="move(p, o.id)" [attr.data-move]="o.id">
                  <span>{{ o.label }}</span>
                </label>
              }
            </fieldset>
          } @else {
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--block" data-move-open (click)="moving.set(true)">Move to another leg</button>
          }
          @if (confirming()) {
            <div class="pm__confirm" role="alert">
              <p>Delete this boarding pass from this phone?</p>
              <div class="pm__acts">
                <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="confirming.set(false)">Keep it</button>
                <button type="button" class="ui-btn ui-btn--sm" data-delete-confirm (click)="remove(p)">Delete pass</button>
              </div>
            </div>
          } @else {
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--block pm__del" data-delete (click)="confirming.set(true)">
              <app-icon name="trash" [size]="16" />Delete pass
            </button>
          }
        </div>
      </app-glass-sheet>
    }
  `,
  styles: [`
    /*
     * The one documented exception to Clear Sky tokens: a boarding pass must be
     * dark ink on white in both themes, so literal #fff / #0b1220 (and the
     * mock's light greys) are used inside .pv only.
     */
    .pv {
      position: fixed; inset: 0; z-index: 40; overflow: hidden auto; overscroll-behavior: contain;
      background: #FFFFFF; color: #0B1220; color-scheme: light;
      padding: calc(env(safe-area-inset-top) + 8px) 0 calc(env(safe-area-inset-bottom) + 16px);
    }
    .pv__col { max-width: 480px; min-height: 100%; margin: 0 auto; padding: 4px 18px 8px; display: flex; flex-direction: column; }
    .pv__top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .pv__x {
      width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none;
      background: #EEF2F7; color: #0B1220; cursor: pointer;
    }
    .pv__x:focus-visible, .pv button:focus-visible { outline: 2px solid #0A84FF; outline-offset: 2px; }
    .pv__awake {
      display: inline-flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 650;
      color: #165E55; background: #E3F2EF; padding: 5px 10px; border-radius: 999px;
    }
    .pv__awake app-icon { color: #1F8A7A; }
    .pv__noawake { flex: 1; font-size: 12px; color: #5B6475; text-align: center; }

    .pv__track {
      display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
      overscroll-behavior-x: contain; margin: 0 -18px;
    }
    .pv__track::-webkit-scrollbar { display: none; }
    .pv__slide { position: relative; flex: 0 0 100%; min-width: 0; scroll-snap-align: center; padding: 0 18px 2px; }
    .pv__route { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 18px; }
    .pv__route > div { min-width: 0; }
    .pv__code { display: block; font-family: var(--cond); font-size: 58px; font-weight: 700; line-height: .9; letter-spacing: -.01em; }
    .pv__route small { display: block; font-size: 12.5px; color: #5B6475; font-weight: 550; min-height: 1.3em; }
    .pv__r { text-align: right; }
    .pv__mid { flex: 1; display: flex; align-items: center; gap: 6px; padding: 0 10px 18px; color: #0B1220; }
    .pv__mid i { flex: 1; height: 0; border-top: 2px dashed #CBD2DD; }
    .pv__mid app-icon { transform: rotate(45deg); }
    .pv__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 16px 0 0; padding-top: 14px; border-top: 1px solid #E4E8EF; }
    .pv__grid dt { font-size: 10.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: #5B6475; }
    .pv__grid dd { margin: 0; font-family: var(--cond); font-size: 26px; font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
    .pv__who { margin: 12px 0 0; font-size: 14px; color: #5B6475; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .pv__who b { color: #0B1220; font-weight: 650; }

    .pv__bc {
      margin-top: 18px; background: #FFFFFF; border-radius: 16px; box-shadow: 0 0 0 1px #E4E8EF;
      padding: 14px 6px; min-height: 160px; display: flex; align-items: center; justify-content: center; min-width: 0;
    }
    .pv__svg { width: 100%; min-width: 0; }
    /* PDF417: full width, rows drawn taller (row height is free in PDF417; module widths stay even). */
    .pv__svg ::ng-deep svg { display: block; width: 100%; height: auto; aspect-ratio: 2.4 / 1; }
    .pv__bc.is-square .pv__svg { width: min(80vw, 320px); }
    .pv__bc.is-square .pv__svg ::ng-deep svg { aspect-ratio: 1 / 1; }
    .pv__img { display: block; max-width: 100%; min-width: 0; max-height: 60vh; margin: 0 auto; object-fit: contain; }
    .pv__bcmsg { margin: 0; font-size: 13.5px; color: #5B6475; text-align: center; }

    .pv__seg { display: flex; gap: 3px; margin-top: 12px; padding: 3px; border-radius: 11px; background: #EEF2F7; }
    .pv__seg button {
      flex: 1; min-height: 40px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #5B6475; cursor: pointer;
    }
    .pv__seg button.on { background: #FFFFFF; color: #0B1220; box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
    .pv__seg button:disabled { opacity: .45; cursor: default; }
    .pv__bright { margin: 12px 0 0; font-size: 12.5px; color: #5B6475; text-align: center; }
    .pv__foot { margin-top: auto; padding-top: 14px; font-size: 12px; color: #5B6475; text-align: center; }
    .pv__foot p { margin: 8px 0 0; }
    .pv__nav { display: flex; gap: 8px; }
    .pv__swap { display: grid; gap: 8px; margin-bottom: 10px; font-size: 13.5px; color: #0B1220; }
    .pv__swap p { margin: 0; }
    .pv__btn {
      flex: 1; min-height: 44px; padding: 10px 14px; border-radius: 14px; font-size: 14px; font-weight: 600; cursor: pointer;
      background: #0B1220; color: #FFFFFF;
    }
    .pv__btn--ghost { background: #EEF2F7; color: #0B1220; }
    .pv__btn:disabled { opacity: .45; cursor: default; }
    .pv__msg { margin: 40px 0 0; display: grid; gap: 6px; justify-items: center; text-align: center; font-size: 14px; color: #5B6475; }
    .pv__msg b { color: #0B1220; font-size: 16px; }
    .pv__msg .pv__btn { flex: none; margin-top: 10px; }

    .pm { display: grid; gap: 12px; padding: 0 16px 16px; }
    .pm__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; cursor: pointer; }
    .pm__tx { display: grid; gap: 2px; }
    .pm__tx b { font-size: 15px; font-weight: 650; }
    .pm__tx small { font-size: 13px; color: var(--ink-2); }
    .pm__pick { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; }
    .pm__opt { display: flex; align-items: center; gap: 12px; min-height: 48px; border-bottom: 1px solid var(--hair); cursor: pointer; font-size: 14.5px; font-weight: 600; }
    .pm__opt:last-child { border-bottom: 0; }
    .pm__opt input { width: 20px; height: 20px; flex: none; accent-color: var(--blue); }
    .pm__del { color: var(--red-ink); }
    .pm__confirm { background: var(--fill); border-radius: 16px; padding: 12px 14px; }
    .pm__confirm p { margin: 0; font-size: 14.5px; font-weight: 600; }
    .pm__acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    .pm__acts .ui-btn { min-height: 44px; }
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
    @media (min-width: 720px) {
      .pv { padding-top: 24px; }
      .pv__code { font-size: 64px; }
    }
  `],
})
export class PassViewPage {
  private readonly passes = inject(PassesService);
  private readonly tripsSvc = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly wakeLock = inject(WAKE_LOCK);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  readonly id = input.required<string>();
  readonly passId = input.required<string>();

  protected readonly ready = signal(false);
  protected readonly mode = signal<'barcode' | 'image'>('barcode');
  protected readonly index = signal(0);
  protected readonly svgs = signal<Record<string, SafeHtml>>({});
  protected readonly failed = signal<ReadonlySet<string>>(new Set());
  protected readonly imageUrl = signal<string | null>(null);
  protected readonly awake = signal(false);
  protected readonly wakeTried = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly moving = signal(false);
  protected readonly confirming = signal(false);

  protected readonly trip = computed<Trip | null>(() => this.tripsSvc.trip(this.id()));

  /** The pass and the other passes on the same leg (companions), in the order they were added. */
  protected readonly slides = computed<Slide[]>(() => {
    if (!this.ready()) return [];
    const all = this.passes.passes();
    const p = all.find(x => x.id === this.passId() && x.tripId === this.id());
    if (!p) return [];
    const group = p.legId ? this.passes.forLeg(p.tripId, p.legId) : [p];
    const t = this.trip();
    return group.map(pass => this.slide(pass, t));
  });
  protected readonly current = computed<PassRecord | null>(() => this.slides()[this.index()]?.pass ?? null);
  /** "This pass is for AC812 (your backup). Swap this leg to AC812?" for a pass on a backup flight. */
  protected readonly offer = computed(() => {
    const p = this.current();
    return p ? swapOfferFor(p, this.trip()) : null;
  });
  protected readonly swapping = signal(false);
  private readonly swapper = inject(PassSwapService);

  protected readonly moveOptions = computed(() => {
    const t = this.trip();
    if (!t) return [];
    return [...flightLegs(t).map(l => ({ id: l.id, label: legOptionLabel(l) })), { id: '', label: 'No leg, keep it with the trip' }];
  });

  private lock: { release(): Promise<void> } | null = null;
  private destroyed = false;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.passes.ensureReady().then(() => this.ready.set(true));
    // A modal dialog: focus starts inside it, on Close.
    afterNextRender(() => this.closeBtn()?.nativeElement.focus({ preventScroll: true }));

    // Start on the pass in the URL.
    effect(() => {
      const s = this.slides();
      const id = this.passId();
      untracked(() => {
        const i = Math.max(0, s.findIndex(x => x.pass.id === id));
        if (i !== this.index()) this.index.set(i);
        afterNextRender(() => this.scrollTo(i, 'instant'), { injector: this.injector });
      });
    });

    // Draw every slide's barcode (bwip-js, lazy, offline).
    effect(() => {
      for (const s of this.slides()) {
        const id = s.pass.id;
        if (untracked(() => this.svgs()[id] || this.failed().has(id))) continue;
        renderBarcodeSvg(s.pass.raw, s.pass.format)
          .then(svg => this.svgs.update(m => ({ ...m, [id]: this.sanitizer.bypassSecurityTrustHtml(fitSvg(svg)) })))
          .catch(() => this.failed.update(f => new Set(f).add(id)));
      }
    });

    // The original image follows the current slide while "Original image" is on.
    effect(() => {
      const p = this.current();
      const mode = this.mode();
      untracked(() => void this.loadImage(mode === 'image' ? p : null));
    });

    void this.acquire();
    const onVis = () => {
      if (this.doc.visibilityState === 'visible') void this.acquire();
    };
    this.doc.addEventListener('visibilitychange', onVis);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.doc.removeEventListener('visibilitychange', onVis);
      void this.lock?.release().catch(() => undefined);
      this.lock = null;
      this.revoke();
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
    });
  }

  private slide(pass: PassRecord, t: Trip | null): Slide {
    const leg = t ? legById(t, pass.legId) : null;
    const ref = leg?.kind === 'flight' ? leg.refs[pass.refIndex ?? 0] ?? leg.refs[0] ?? null : null;
    return {
      pass,
      ref,
      fromName: cityOf(pass.from),
      toName: cityOf(pass.to),
      date: pass.dateKey ? dayLabel(pass.dateKey) : '',
      departs: ref ? formatClock(ref.depLocal, this.state.timeFormat()) : '–',
    };
  }

  private async acquire(): Promise<void> {
    if (this.destroyed) return;
    if (!this.wakeLock) {
      this.wakeTried.set(true);
      return;
    }
    if (this.lock && this.awake()) return;
    try {
      const l = await this.wakeLock.request('screen');
      if (this.destroyed) {
        void l.release().catch(() => undefined);
        return;
      }
      this.lock = l;
      this.awake.set(true);
      // The browser drops the lock when the page is hidden; visibilitychange asks again.
      l.addEventListener?.('release', () => {
        this.awake.set(false);
        this.lock = null;
      });
    } catch {
      this.awake.set(false);
    }
    this.wakeTried.set(true);
  }

  private async loadImage(p: PassRecord | null): Promise<void> {
    this.revoke();
    if (!p?.imageBlobId) return;
    const blob = await this.passes.image(p.id);
    if (!blob || this.destroyed || this.current()?.id !== p.id || this.mode() !== 'image') return;
    this.imageUrl.set(URL.createObjectURL(new Blob([blob], { type: safeMime(blob.type) })));
  }

  private revoke(): void {
    const u = this.imageUrl();
    if (u) URL.revokeObjectURL(u);
    this.imageUrl.set(null);
  }

  protected showImage(): void {
    if (this.current()?.imageBlobId) this.mode.set('image');
  }

  protected name(p: PassRecord): string {
    return passName(p);
  }

  protected onScroll(): void {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      const el = this.track()?.nativeElement;
      if (!el || !el.clientWidth) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      if (i !== this.index() && i >= 0 && i < this.slides().length) this.select(i);
    }, 80);
  }

  protected go(i: number): void {
    if (i < 0 || i >= this.slides().length) return;
    this.select(i);
    this.scrollTo(i, 'smooth');
  }

  private select(i: number): void {
    this.index.set(i);
    const p = this.slides()[i]?.pass;
    // Keep the URL on the pass on screen, so a reload or Back returns to it.
    if (p && p.id !== this.passId()) {
      void this.router.navigate(passPath(p.tripId, p.id), { replaceUrl: true, queryParams: this.state.globalParams() });
    }
  }

  private scrollTo(i: number, behavior: ScrollBehavior): void {
    const el = this.track()?.nativeElement;
    if (el?.clientWidth) el.scrollTo?.({ left: i * el.clientWidth, behavior });
  }

  protected close(): void {
    this.state.goBack(tripPath(this.id()));
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
    this.moving.set(false);
    this.confirming.set(false);
  }

  protected async setDeleteAfter(p: PassRecord, on: boolean): Promise<void> {
    const err = await this.passes.setDeleteAfterTrip(p.id, on);
    if (err) this.state.flash(FILES_ERROR_TEXT[err]);
  }

  protected async move(p: PassRecord, legId: string): Promise<void> {
    const t = this.trip();
    const leg = t ? legById(t, legId || null) : null;
    const refs = leg?.kind === 'flight' ? leg.refs : [];
    const ri = refs.findIndex(r => r.origin === p.from && r.dest === p.to);
    const err = await this.passes.relink(p.id, leg ? leg.id : null, leg ? Math.max(0, ri) : null, leg ? 'manual' : 'none');
    this.closeMenu();
    if (err) return this.state.flash(FILES_ERROR_TEXT[err]);
    this.state.flash(leg && leg.kind === 'flight' ? `Pass moved to ${leg.refs.map(r => r.flightNumber).join(' + ')}` : 'Pass kept with the trip');
  }

  /** Swaps the leg to the pass's backup (with Undo) and links the pass to the new leg. */
  protected async swap(): Promise<void> {
    const p = this.current();
    if (!p || this.swapping()) return;
    this.swapping.set(true);
    try {
      await this.swapper.swapForPass(p);
    } finally {
      this.swapping.set(false);
    }
  }

  protected async remove(p: PassRecord): Promise<void> {
    this.closeMenu();
    const rest = this.slides().filter(x => x.pass.id !== p.id);
    // Leave first, so the screen never flashes "not on this phone"; the service flashes Undo.
    if (rest.length) {
      const next = rest[Math.min(this.index(), rest.length - 1)].pass;
      await this.router.navigate(passPath(p.tripId, next.id), { replaceUrl: true, queryParams: this.state.globalParams() });
    } else {
      this.state.goBack(tripPath(this.id()));
    }
    await this.passes.remove(p.id);
  }
}
