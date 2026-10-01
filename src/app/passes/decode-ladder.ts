/**
 * The barcode retry ladder (extras spec §3, §4.7). Pure: the reader and the
 * image transforms are injected, so specs drive it with fakes and the app
 * with zxing-wasm. The transforms here work on raw RGBA, with no canvas, so
 * they run the same in a browser, a worker and node.
 */
import type { BarcodeFormat, DecodeStep, DecodedRead } from './model';

export interface ImageDataLike { data: Uint8ClampedArray; width: number; height: number }
export type BarcodeReader = (img: ImageDataLike) => Promise<{ text: string; format: BarcodeFormat }[]>;
export type ImageTransform = (img: ImageDataLike, step: DecodeStep) => ImageDataLike;

export const LADDER: DecodeStep[] = ['as-is', 'invert', 'up2x', 'rot+7', 'rot-7'];
/** Longest side before the first step (larger images are scaled down first). */
export const MAX_DECODE_SIDE = 2400;
/** Longest side an 'up2x' step may produce. */
const MAX_UPSCALED_SIDE = 3200;

/**
 * Runs the steps in order and stops at the first read that `accept`s (a BCBP
 * M-format text). When something was read but nothing was accepted (a QR code
 * holding a link, say), returns that first read so the UI can say "Not a
 * boarding pass barcode"; null means no barcode at all. A reader that throws
 * counts as no read for that step.
 */
export async function decodeWithLadder(
  img: ImageDataLike,
  read: BarcodeReader,
  transform: ImageTransform,
  accept: (text: string) => boolean,
  steps: readonly DecodeStep[] = LADDER,
): Promise<DecodedRead | null> {
  let rejected: DecodedRead | null = null;
  for (const step of steps) {
    let reads: { text: string; format: BarcodeFormat }[] = [];
    try {
      reads = await read(step === 'as-is' ? img : transform(img, step));
    } catch {
      reads = [];
    }
    for (const r of reads) {
      if (accept(r.text)) return { text: r.text, format: r.format, step, page: null };
      rejected ??= { text: r.text, format: r.format, step, page: null };
    }
  }
  return rejected;
}

// ── Pure RGBA transforms ────────────────────────────────────────────────────

function blank(width: number, height: number): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255); // white, opaque
  return { data, width, height };
}

/** Bilinear sample of channel `c` at (x, y); outside the image reads white. */
function sample(img: ImageDataLike, x: number, y: number, c: number): number {
  const { data, width, height } = img;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const px = (xx: number, yy: number): number =>
    xx < 0 || yy < 0 || xx >= width || yy >= height ? 255 : data[(yy * width + xx) * 4 + c];
  const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
  const bot = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Light on dark → dark on light. Transparent pixels count as black first, then invert (to white). */
export function invertImage(img: ImageDataLike): ImageDataLike {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = 255 - img.data[i] * a;
    out[i + 1] = 255 - img.data[i + 1] * a;
    out[i + 2] = 255 - img.data[i + 2] * a;
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

/** Scales by `k` (bilinear). */
export function scaleImage(img: ImageDataLike, k: number): ImageDataLike {
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / k - 0.5;
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / k - 0.5;
      const o = (y * w + x) * 4;
      out.data[o] = sample(img, sx, sy, 0);
      out.data[o + 1] = sample(img, sx, sy, 1);
      out.data[o + 2] = sample(img, sx, sy, 2);
    }
  }
  return out;
}

/** Rotates by `deg` around the centre on a white canvas big enough for the whole image. */
export function rotateImage(img: ImageDataLike, deg: number): ImageDataLike {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const w = Math.ceil(Math.abs(img.width * cos) + Math.abs(img.height * sin));
  const h = Math.ceil(Math.abs(img.width * sin) + Math.abs(img.height * cos));
  const out = blank(w, h);
  const cx = img.width / 2, cy = img.height / 2, ox = w / 2, oy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - ox, dy = y - oy;
      const sx = cos * dx + sin * dy + cx, sy = -sin * dx + cos * dy + cy;
      if (sx < -1 || sy < -1 || sx > img.width || sy > img.height) continue;
      const o = (y * w + x) * 4;
      out.data[o] = sample(img, sx, sy, 0);
      out.data[o + 1] = sample(img, sx, sy, 1);
      out.data[o + 2] = sample(img, sx, sy, 2);
    }
  }
  return out;
}

/** Scales down so the longest side is at most `max` (returns the same image when it already fits). */
export function capImage(img: ImageDataLike, max = MAX_DECODE_SIDE): ImageDataLike {
  const long = Math.max(img.width, img.height);
  return long <= max ? img : scaleImage(img, max / long);
}

/** The transform for each ladder step ('as-is' and 'native' return the image unchanged). */
export function transformImage(img: ImageDataLike, step: DecodeStep): ImageDataLike {
  switch (step) {
    case 'invert': return invertImage(img);
    case 'up2x': return scaleImage(img, Math.min(2, MAX_UPSCALED_SIDE / Math.max(img.width, img.height)));
    case 'rot+7': return rotateImage(img, 7);
    case 'rot-7': return rotateImage(img, -7);
    default: return img;
  }
}
