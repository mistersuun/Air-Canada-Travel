/**
 * Decodes boarding-pass barcodes on the device (extras spec §3, §4.7).
 * zxing-wasm loads lazily, only on the passes screens, with its wasm served
 * from /vendor/zxing (never the default CDN). Images and PDFs never leave
 * the phone.
 *
 * The zxing ladder runs in a module worker (decode.worker.ts) so the camera
 * preview and the UI keep moving. Where Worker or OffscreenCanvas is missing
 * (older iOS), or the worker fails to start or to load zxing, the same code
 * (decode-core.ts) runs on the main thread instead.
 */
import { Injectable, InjectionToken, inject } from '@angular/core';
import { type ReaderFactory, decodeImageCore, decodePdfPageCore, isBcbp, normalizeFormat, zxingReaders } from './decode-core';
import { DecodeWorkerClient, WorkerUnavailable, type WorkerLike } from './decode-worker-client';
import type { ImageDataLike } from './decode-ladder';
import type { DecodedRead } from './model';
import { context2d, forEachPdfPage, makeCanvas, selfHosted } from './pdf-pages';

export { isBcbp, normalizeFormat };

export const ZXING_WASM_PATH = 'vendor/zxing/zxing_reader.wasm';

/** True when decoding can move to a worker: module Worker and OffscreenCanvas are both there. */
export function workerDecodingSupported(g: { Worker?: unknown; OffscreenCanvas?: unknown } = globalThis): boolean {
  return typeof g.Worker === 'function' && typeof g.OffscreenCanvas === 'function';
}

/**
 * Starts the decode worker, or null to decode on the main thread. The
 * builder bundles decode.worker.ts as a same-origin worker-<hash>.js.
 */
export const DECODE_WORKER = new InjectionToken<(() => WorkerLike) | null>('DECODE_WORKER', {
  providedIn: 'root',
  factory: () => (workerDecodingSupported()
    ? () => new Worker(new URL('./decode.worker', import.meta.url), { type: 'module', name: 'barcode-decode' })
    : null),
});

interface NativeDetector { detect(src: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]> }

/** False once the buffer was transferred to the worker (a detached buffer has no bytes). */
function usable(img: ImageDataLike): boolean {
  return img.data.byteLength > 0;
}

@Injectable({ providedIn: 'root' })
export class BarcodeService {
  private readonly startWorker = inject(DECODE_WORKER);
  private worker: DecodeWorkerClient | null = null;
  private workerFailed = false;
  private mainReaders: ReaderFactory | null = null;
  private native: Promise<NativeDetector | null> | null = null;

  /** Starts the worker (or loads zxing on the main thread) ahead of the first decode. Idempotent. */
  warmUp(): void {
    const w = this.client();
    if (w) {
      // A 1×1 white image makes the worker load zxing now.
      w.decodeImage({ data: new Uint8ClampedArray([255, 255, 255, 255]), width: 1, height: 1 }, ['as-is']).catch(() => undefined);
      return;
    }
    this.readers()(1).catch(() => undefined);
  }

  /** A photo or screenshot: native detector when it handles PDF417 and Aztec, then the zxing ladder. */
  async decodeImage(file: Blob): Promise<DecodedRead | null> {
    const img = await blobToImageData(file);
    if (!img) return null;
    const nat = await this.nativeRead(img);
    if (nat) return nat;
    const w = this.client();
    if (w) {
      try {
        return await w.decodeImage(img);
      } catch (e) {
        if (!(e instanceof WorkerUnavailable)) throw e;
        if (!usable(img)) {
          const again = await blobToImageData(file);
          return again ? decodeImageCore(again, this.readers()) : null;
        }
      }
    }
    return decodeImageCore(img, this.readers());
  }

  /**
   * A camera frame: one quick read (zxing already tries inverted and rotated);
   * the scanner retries with the next frame. The frame's pixels are handed
   * to the worker, so the frame is not usable afterwards.
   */
  async decodeImageData(img: ImageData): Promise<DecodedRead | null> {
    const w = this.client();
    if (w) {
      try {
        return await w.decodeImage(img, ['as-is']);
      } catch (e) {
        if (!(e instanceof WorkerUnavailable)) throw e;
        if (!usable(img)) return null;
      }
    }
    return decodeImageCore(img, this.readers(), ['as-is']);
  }

  /**
   * Pages 1..min(n, maxPages) at scale 2, then at scale 3 when nothing was
   * found. Every BCBP read (up to 4 per page) is returned with its page, plus
   * a PNG of each page that had one (to keep as the pass's original image).
   * Pages render on the main thread (pdf.js parses in its own worker); the
   * barcode reading happens in the decode worker when there is one.
   */
  async decodePdf(file: Blob, maxPages = 3): Promise<{ reads: DecodedRead[]; pageImages: Blob[] }> {
    const w = this.client();
    if (w) {
      try {
        return await this.pdfWith(file, maxPages, (img, page) => w.decodePdfPage(img, page));
      } catch (e) {
        if (!(e instanceof WorkerUnavailable)) throw e;
      }
    }
    const readers = this.readers();
    return this.pdfWith(file, maxPages, (img, page) => decodePdfPageCore(img, page, readers));
  }

  private async pdfWith(
    file: Blob, maxPages: number,
    decodePage: (img: ImageDataLike, page: number) => Promise<{ found: DecodedRead[]; rejected: DecodedRead | null }>,
  ): Promise<{ reads: DecodedRead[]; pageImages: Blob[] }> {
    for (const scale of [2, 3]) {
      const reads: DecodedRead[] = [];
      const pageImages: Blob[] = [];
      let rejected: DecodedRead | null = null;
      await forEachPdfPage(file, maxPages, scale, async ({ page, image, png }) => {
        const r = await decodePage(image, page);
        if (!r.found.length && r.rejected) rejected ??= r.rejected;
        const seen = new Set(reads.map(x => x.text));
        const fresh = r.found.filter(x => !seen.has(x.text));
        if (fresh.length) {
          reads.push(...fresh);
          pageImages.push(await png());
        }
      });
      if (reads.length) return { reads, pageImages };
      if (scale === 3 && rejected) return { reads: [rejected], pageImages: [] };
    }
    return { reads: [], pageImages: [] };
  }

  /** The worker client, started on first use; null on the main-thread path. */
  private client(): DecodeWorkerClient | null {
    if (this.worker?.isBroken) {
      this.worker = null;
      this.workerFailed = true;
    }
    if (this.workerFailed || !this.startWorker) return null;
    if (!this.worker) {
      try {
        this.worker = new DecodeWorkerClient(this.startWorker(), selfHosted(ZXING_WASM_PATH));
      } catch {
        this.workerFailed = true;
        return null;
      }
    }
    return this.worker;
  }

  private readers(): ReaderFactory {
    return (this.mainReaders ??= zxingReaders(selfHosted(ZXING_WASM_PATH)));
  }

  /** Step 0: BarcodeDetector, only where it supports both PDF417 and Aztec (Chrome on Android, Safari). */
  private async nativeRead(img: ImageData): Promise<DecodedRead | null> {
    this.native ??= (async () => {
      const BD = (globalThis as unknown as { BarcodeDetector?: {
        new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]>;
      } }).BarcodeDetector;
      if (!BD) return null;
      try {
        const f = await BD.getSupportedFormats();
        return f.includes('pdf417') && f.includes('aztec') ? new BD({ formats: ['pdf417', 'aztec', 'qr_code'] }) : null;
      } catch {
        return null;
      }
    })();
    const det = await this.native;
    if (!det) return null;
    try {
      for (const r of await det.detect(img)) {
        const format = r.format === 'pdf417' ? 'PDF417' : r.format === 'aztec' ? 'Aztec' : r.format === 'qr_code' ? 'QRCode' : null;
        if (format && isBcbp(r.rawValue)) return { text: r.rawValue, format, step: 'native', page: null };
      }
    } catch {
      // fall through to zxing
    }
    return null;
  }
}

/**
 * Blob → ImageData on white, longest side ≤ 2400. Goes through
 * createImageBitmap (the browser decodes JPEG/PNG/WebP, and HEIC on Safari);
 * a Blob is never handed to zxing directly. Null when the image can't be read.
 */
export async function blobToImageData(file: Blob, maxSide = 2400): Promise<ImageData | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = makeCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
    const ctx = context2d(c);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  } catch {
    return null;
  } finally {
    bmp.close();
  }
}
