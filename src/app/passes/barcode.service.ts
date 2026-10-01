/**
 * Decodes boarding-pass barcodes on the device (extras spec §3, §4.7).
 * zxing-wasm loads lazily, only on the passes screens, with its wasm served
 * from /vendor/zxing (never the default CDN). Images and PDFs never leave
 * the phone.
 */
import { Injectable } from '@angular/core';
import { parseBcbp } from './bcbp';
import {
  BarcodeReader, ImageDataLike, LADDER, capImage, decodeWithLadder, transformImage,
} from './decode-ladder';
import type { BarcodeFormat, DecodeStep, DecodedRead } from './model';
import { context2d, forEachPdfPage, makeCanvas, selfHosted } from './pdf-pages';

export const ZXING_WASM_PATH = 'vendor/zxing/zxing_reader.wasm';
const FORMATS = ['PDF417', 'Aztec', 'QRCode'] as const;
const READER_OPTIONS = { formats: [...FORMATS], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true };

/** zxing's format name → ours ('AztecCode' → 'Aztec', 'QRCodeModel2' → 'QRCode'); null for others. */
export function normalizeFormat(f: string | null | undefined): BarcodeFormat | null {
  if (!f) return null;
  if (f.includes('PDF417')) return 'PDF417';
  if (f.startsWith('Aztec')) return 'Aztec';
  if (f.startsWith('QRCode') || f === 'QR Code') return 'QRCode';
  return null;
}

/** BCBP M-format text (the ladder's `accept`). */
export function isBcbp(text: string): boolean {
  return parseBcbp(text).ok;
}

type ZxingModule = typeof import('zxing-wasm/reader');

interface NativeDetector { detect(src: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]> }

@Injectable({ providedIn: 'root' })
export class BarcodeService {
  private zx: Promise<ZxingModule> | null = null;
  private native: Promise<NativeDetector | null> | null = null;

  /** Starts loading the decoder (idempotent; failures are retried on the next call). */
  warmUp(): void {
    this.module().catch(() => undefined);
  }

  /** A photo or screenshot: native detector when it handles PDF417 and Aztec, then the zxing ladder. */
  async decodeImage(file: Blob): Promise<DecodedRead | null> {
    const img = await blobToImageData(file);
    if (!img) return null;
    const nat = await this.nativeRead(img);
    if (nat) return nat;
    return decodeWithLadder(capImage(img), await this.reader(1), transformImage, isBcbp);
  }

  /** A camera frame: one quick read (zxing already tries inverted and rotated); the scanner retries with the next frame. */
  async decodeImageData(img: ImageData): Promise<DecodedRead | null> {
    return decodeWithLadder(capImage(img), await this.reader(1), transformImage, isBcbp, ['as-is']);
  }

  /**
   * Pages 1..min(n, maxPages) at scale 2, then at scale 3 when nothing was
   * found. Every BCBP read (up to 4 per page) is returned with its page, plus
   * a PNG of each page that had one (to keep as the pass's original image).
   */
  async decodePdf(file: Blob, maxPages = 3): Promise<{ reads: DecodedRead[]; pageImages: Blob[] }> {
    const multi = await this.reader(4);
    const single = await this.reader(1);
    for (const scale of [2, 3]) {
      const reads: DecodedRead[] = [];
      const pageImages: Blob[] = [];
      let rejected: DecodedRead | null = null;
      await forEachPdfPage(file, maxPages, scale, async ({ page, image, png }) => {
        const img = capImage(image, 3200);
        let found = (await multi(img).catch(() => [])).filter(r => isBcbp(r.text))
          .map(r => ({ text: r.text, format: r.format, step: 'as-is' as DecodeStep, page }));
        if (!found.length) {
          const one = await decodeWithLadder(img, single, transformImage, isBcbp, LADDER.slice(1));
          if (one && isBcbp(one.text)) found = [{ ...one, page }];
          else if (one) rejected ??= { ...one, page };
        }
        const seen = new Set(reads.map(r => r.text));
        const fresh = found.filter(r => !seen.has(r.text));
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

  private module(): Promise<ZxingModule> {
    this.zx ??= import('zxing-wasm/reader').then(async m => {
      await m.prepareZXingModule({
        overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? selfHosted(ZXING_WASM_PATH) : prefix + p) },
        fireImmediately: true,
      });
      return m;
    }).catch(e => {
      this.zx = null;
      throw e;
    });
    return this.zx;
  }

  private async reader(maxNumberOfSymbols: number): Promise<BarcodeReader> {
    const m = await this.module();
    return async (img: ImageDataLike) => {
      const rs = await m.readBarcodes(img as ImageData, { ...READER_OPTIONS, maxNumberOfSymbols });
      const out: { text: string; format: BarcodeFormat }[] = [];
      for (const r of rs) {
        const format = normalizeFormat(r.format);
        if (format && r.text && r.isValid !== false) out.push({ text: r.text, format });
      }
      return out;
    };
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
