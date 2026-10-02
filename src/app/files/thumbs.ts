/**
 * Small previews for trip files: a JPEG of at most 160 px on its longest
 * side for photos and for page 1 of a PDF, plus the PDF's page count. Made
 * on this phone (canvas; pdf.js loads lazily through passes/pdf-pages) and
 * kept next to the file in the files store. Shown through blob: URLs, which
 * the CSP allows (img-src 'self' blob: data:).
 */
import { InjectionToken } from '@angular/core';
import { canvasJpeg, forEachPdfPage, makeCanvas } from '../passes/pdf-pages';
import type { AttachmentKind } from './model';
import { fitSize } from './photo';

export const THUMB_MAX_SIDE = 160;
export const THUMB_QUALITY = 0.72;

/** What a thumbnail run found: the preview (null when it couldn't be drawn) and, for PDFs, the page count. */
export interface ThumbResult { thumb: Blob | null; pages: number | null }

export type ThumbMaker = (content: Blob, kind: AttachmentKind) => Promise<ThumbResult>;

/** Kinds that get a preview. */
export function wantsThumb(kind: AttachmentKind): boolean {
  return kind === 'pdf' || kind === 'image';
}

/** Scale that fits a w×h page into THUMB_MAX_SIDE (pdf.js renders straight at that size). */
export function thumbScale(w: number, h: number, max = THUMB_MAX_SIDE): number {
  const side = Math.max(w, h);
  return side > 0 ? max / side : 1;
}

async function imageThumb(content: Blob): Promise<Blob | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(content);
  } catch {
    return null; // HEIC outside Safari, a broken file
  }
  try {
    const { w, h } = fitSize(bmp.width, bmp.height, THUMB_MAX_SIDE);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.fillStyle = '#fff'; // transparent PNGs on white, as JPEG has no alpha
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return await canvasJpeg(c, THUMB_QUALITY);
  } catch {
    return null;
  } finally {
    bmp.close();
  }
}

async function pdfThumb(content: Blob): Promise<ThumbResult> {
  let thumb: Blob | null = null;
  try {
    const pages = await forEachPdfPage(content, 1, (w, h) => thumbScale(w, h), async p => {
      try {
        thumb = await p.jpeg(THUMB_QUALITY);
      } catch {
        thumb = null;
      }
    });
    return { thumb, pages };
  } catch {
    return { thumb: null, pages: null }; // not a PDF pdf.js can open (damaged, password)
  }
}

/** The real maker. Without createImageBitmap (old browsers, jsdom) there are no previews. */
export async function makeThumb(content: Blob, kind: AttachmentKind): Promise<ThumbResult> {
  if (!wantsThumb(kind) || typeof createImageBitmap !== 'function') return { thumb: null, pages: null };
  if (kind === 'image') return { thumb: await imageThumb(content), pages: null };
  return pdfThumb(content);
}

export const THUMB_MAKER = new InjectionToken<ThumbMaker>('THUMB_MAKER', {
  providedIn: 'root',
  factory: () => makeThumb,
});
