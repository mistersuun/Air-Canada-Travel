/**
 * Renders the first pages of a PDF to pixels for barcode decoding (extras
 * spec §3). pdf.js (legacy build) loads lazily and its worker is self-hosted
 * under /vendor/pdfjs, so nothing is fetched from another origin.
 */
import type { ImageDataLike } from './decode-ladder';

export const PDF_WORKER_PATH = 'vendor/pdfjs/pdf.worker.min.mjs';

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** An OffscreenCanvas where there is one, else a detached <canvas>. */
export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function context2d(c: AnyCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2d canvas unavailable');
  return ctx;
}

/** PNG of a canvas. */
export async function canvasPng(c: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

function baseUrl(): string {
  try {
    return document.baseURI;
  } catch {
    return globalThis.location?.href ?? '/';
  }
}

/** Absolute URL of a file the app serves itself ('vendor/…'), honouring <base href>. */
export function selfHosted(path: string): string {
  return new URL(path, baseUrl()).href;
}

/** How long opening a PDF may take before giving up (a worker that fails to load would otherwise hang). */
export const PDF_OPEN_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('PDF took too long to open')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export interface PdfPageVisit {
  page: number;
  image: ImageDataLike;
  png: () => Promise<Blob>;
  /** The page as JPEG (thumbnails). */
  jpeg: (quality: number) => Promise<Blob>;
}

/** JPEG of a canvas. */
export async function canvasJpeg(c: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality));
}

/**
 * Calls `visit` for pages 1..min(n, maxPages), rendered at `scale` on white
 * (or the scale `scale(width, height)` picks from the page's size at 1x).
 * Pages are rendered one at a time; the document is destroyed at the end
 * (also on error or a 20 s open timeout). Resolves to the document's page count.
 */
export async function forEachPdfPage(
  file: Blob, maxPages: number, scale: number | ((w: number, h: number) => number), visit: (p: PdfPageVisit) => Promise<void>,
): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = selfHosted(PDF_WORKER_PATH);
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  try {
    const doc = await withTimeout(task.promise, PDF_OPEN_TIMEOUT_MS);
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = typeof scale === 'number' ? null : page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: typeof scale === 'number' ? scale : scale(base!.width, base!.height) });
      const canvas = makeCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = context2d(canvas);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      page.cleanup();
      await visit({ page: i, image, png: () => canvasPng(canvas), jpeg: q => canvasJpeg(canvas, q) });
    }
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}
