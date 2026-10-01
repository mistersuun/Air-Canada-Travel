import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, InjectionToken, afterNextRender, inject, output, signal, viewChild,
} from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { BarcodeService } from '../../passes/barcode.service';
import { parseBcbp } from '../../passes/bcbp';
import type { DecodedRead } from '../../passes/model';

/** getUserMedia, or null when this browser has no camera API (tests provide a fake). */
export const CAMERA = new InjectionToken<((c: MediaStreamConstraints) => Promise<MediaStream>) | null>('CAMERA', {
  providedIn: 'root',
  factory: () => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    return md?.getUserMedia ? (c: MediaStreamConstraints) => md.getUserMedia(c) : null;
  },
});

/** Time between decoded frames. The decoder runs on the main thread (no worker), so frames are spaced out. */
export const SCAN_INTERVAL_MS = 400;
/** Camera frames are scaled to this longest side before decoding. */
const FRAME_MAX_SIDE = 1600;

/** What the scanner hands back on the first boarding-pass read: the read and the frame it came from (JPEG). */
export interface ScanResult { read: DecodedRead; frame: Blob | null }

/**
 * Live camera scanner for the add-pass page (extras spec §3 "Camera").
 * Rear camera, playsinline + muted; grabs a frame every 400 ms and decodes it
 * on the phone. Stops the camera on the first boarding-pass read and when
 * the component goes away. Nothing leaves the device.
 */
@Component({
  selector: 'app-pass-scanner',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vf" [class.is-live]="state() === 'live'" data-scanner>
      <video #video class="vf__video" playsinline muted autoplay aria-hidden="true"></video>
      <p class="vf__hint" aria-live="polite">
        @switch (state()) {
          @case ('starting') { Starting the camera… }
          @case ('found') { Got it }
          @default { Hold the barcode inside the frame }
        }
      </p>
      <div class="vf__corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      @if (found(); as f) {
        <div class="vf__found" role="status" data-found><app-icon name="check" [size]="14" [strokeWidth]="3" />{{ f }} read</div>
      } @else if (notPass()) {
        <div class="vf__found vf__found--warn" role="status" data-not-pass>Not a boarding pass barcode</div>
      } @else {
        <p class="vf__tilt">Tilt away from lights if it doesn't read</p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    /* The viewfinder is a camera surface: dark in both themes (mock x9). */
    .vf {
      position: relative; height: 300px; border-radius: 22px; overflow: hidden;
      background: radial-gradient(120% 90% at 50% 40%, #2A3445 0, #0B1220 70%);
    }
    .vf__video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
    .vf.is-live .vf__video { opacity: 1; }
    .vf__hint {
      position: absolute; left: 0; right: 0; top: 14px; margin: 0; text-align: center;
      color: #FFFFFF; font-size: 13px; font-weight: 600; text-shadow: 0 1px 4px rgba(0, 0, 0, .5);
    }
    .vf__corners { position: absolute; left: 50%; top: 50%; width: min(268px, 80%); height: 112px; transform: translate(-50%, -50%); }
    .vf__corners i { position: absolute; width: 26px; height: 26px; border: 0 solid #FFFFFF; }
    .vf__corners i:nth-child(1) { left: 0; top: 0; border-left-width: 3px; border-top-width: 3px; border-top-left-radius: 10px; }
    .vf__corners i:nth-child(2) { right: 0; top: 0; border-right-width: 3px; border-top-width: 3px; border-top-right-radius: 10px; }
    .vf__corners i:nth-child(3) { left: 0; bottom: 0; border-left-width: 3px; border-bottom-width: 3px; border-bottom-left-radius: 10px; }
    .vf__corners i:nth-child(4) { right: 0; bottom: 0; border-right-width: 3px; border-bottom-width: 3px; border-bottom-right-radius: 10px; }
    .vf__found, .vf__tilt {
      position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); white-space: nowrap; margin: 0;
    }
    .vf__found {
      display: flex; gap: 6px; align-items: center; padding: 6px 12px; border-radius: 999px;
      background: rgba(255, 255, 255, .92); color: #0B1220; font-size: 12.5px; font-weight: 650;
    }
    .vf__found app-icon { color: #1F8A7A; }
    .vf__found--warn { color: #7A5418; }
    .vf__tilt { color: rgba(255, 255, 255, .8); font-size: 12px; }
  `],
})
export class PassScannerComponent {
  private readonly camera = inject(CAMERA);
  private readonly barcode = inject(BarcodeService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  /** The first frame that reads as a boarding pass. */
  readonly scanned = output<ScanResult>();
  /** No camera, or permission denied. */
  readonly unavailable = output<void>();

  protected readonly state = signal<'starting' | 'live' | 'found' | 'off'>('starting');
  protected readonly found = signal<string | null>(null);
  protected readonly notPass = signal(false);

  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private canvas: HTMLCanvasElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    afterNextRender(() => void this.start());
  }

  private async start(): Promise<void> {
    this.barcode.warmUp();
    if (!this.camera) return this.fail();
    try {
      this.stream = await this.camera({ audio: false, video: { facingMode: 'environment', width: { ideal: 1920 } } });
    } catch {
      return this.fail();
    }
    if (this.stopped) {
      this.stopTracks();
      return;
    }
    const v = this.video().nativeElement;
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.srcObject = this.stream;
    try {
      await v.play();
    } catch {
      // autoplay of a muted inline video is allowed; frames are still read below
    }
    this.state.set('live');
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), SCAN_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const frame = this.grab();
    if (frame) {
      try {
        const read = await this.barcode.decodeImageData(frame);
        if (read && parseBcbp(read.text).ok) return this.done(read);
        this.notPass.set(!!read);
      } catch {
        // decoder not ready or a bad frame: try the next one
      }
    }
    this.schedule();
  }

  private grab(): ImageData | null {
    const v = this.video().nativeElement;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return null;
    const k = Math.min(1, FRAME_MAX_SIDE / Math.max(w, h));
    const c = (this.canvas ??= document.createElement('canvas'));
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  private async done(read: DecodedRead): Promise<void> {
    const c = this.canvas;
    this.found.set(read.format);
    this.state.set('found');
    this.stop();
    const frame = c ? await new Promise<Blob | null>(res => c.toBlob(b => res(b), 'image/jpeg', 0.9)) : null;
    this.scanned.emit({ read, frame });
  }

  private fail(): void {
    this.state.set('off');
    this.stop();
    this.unavailable.emit();
  }

  /** Stops the camera and the frame loop (idempotent). */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopTracks();
  }

  private stopTracks(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    try {
      const v = this.video().nativeElement;
      v.srcObject = null;
    } catch {
      // view already gone
    }
  }
}
