import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BarcodeService } from '../../passes/barcode.service';
import { CAMERA, PassScannerComponent } from './pass-scanner.component';

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

async function render(camera: unknown) {
  const barcode = { warmUp: vi.fn(), decodeImageData: vi.fn(async () => null) };
  TestBed.configureTestingModule({
    providers: [
      { provide: CAMERA, useValue: camera },
      { provide: BarcodeService, useValue: barcode },
    ],
  });
  const fixture = TestBed.createComponent(PassScannerComponent);
  const unavailable = vi.fn();
  fixture.componentInstance.unavailable.subscribe(unavailable);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  await stable();
  return { fixture, el, stable, unavailable, barcode };
}

describe('PassScannerComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for the rear camera, goes live with the hints, and stops the camera when destroyed', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { track, stream } = fakeStream();
    const camera = vi.fn(async () => stream);
    const { fixture, el, stable, barcode } = await render(camera);
    await vi.waitFor(async () => {
      await stable();
      expect(el.querySelector('.vf.is-live')).toBeTruthy();
    });
    expect(camera).toHaveBeenCalledWith({ audio: false, video: { facingMode: 'environment', width: { ideal: 1920 } } });
    expect(barcode.warmUp).toHaveBeenCalled();
    const video = el.querySelector('video')!;
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.muted).toBe(true);
    expect(el.querySelector('.vf__hint')?.textContent?.trim()).toBe('Hold the barcode inside the frame');
    expect(el.querySelector('.vf__tilt')?.textContent?.trim()).toBe("Tilt away from lights if it doesn't read");
    fixture.destroy();
    expect(track.stop).toHaveBeenCalled();
  });

  it('no camera API: reports unavailable', async () => {
    const { unavailable, stable } = await render(null);
    await vi.waitFor(async () => {
      await stable();
      expect(unavailable).toHaveBeenCalled();
    });
  });

  it('permission denied: reports unavailable and holds no tracks', async () => {
    const camera = vi.fn(async () => { throw new DOMException('no', 'NotAllowedError'); });
    const { unavailable, stable } = await render(camera);
    await vi.waitFor(async () => {
      await stable();
      expect(unavailable).toHaveBeenCalled();
    });
  });
});
