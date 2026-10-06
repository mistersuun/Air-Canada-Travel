/**
 * Photo compression (extras spec §4.4): re-encode to JPEG q0.85 with the
 * longest side at 2560. Re-encoding drops EXIF (including location), so
 * every JPEG and HEIC photo is re-encoded, whatever its size: those are the
 * camera formats that carry GPS. When the browser can't decode the photo
 * (HEIC outside Safari), the original is kept as it is.
 */
import { PHOTO_MAX_SIDE } from './model';

export const PHOTO_COMPRESS_BYTES = 2.5 * 1024 * 1024;
export const PHOTO_QUALITY = 0.85;

/** Camera formats that usually carry EXIF location. */
const EXIF_MIMES = ['image/jpeg', 'image/heic', 'image/heif'];

/** Re-encode when the photo is over 2.5 MB, its longest side is over 2560 px, or it is a JPEG/HEIC (to drop EXIF). */
export function shouldCompress(bytes: number, w: number, h: number, mime = ''): boolean {
  return bytes > PHOTO_COMPRESS_BYTES || Math.max(w, h) > PHOTO_MAX_SIDE || EXIF_MIMES.includes(mime.toLowerCase());
}

/** Target size for a re-encode: longest side at most 2560, aspect kept. */
export function fitSize(w: number, h: number, max = PHOTO_MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * The re-encoded JPEG, or the original when it doesn't need it or when
 * re-encoding is not possible here (HEIC outside Safari, no canvas).
 */
export async function compressPhoto(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    if (!shouldCompress(file.size, bmp.width, bmp.height, file.type)) return file;
    const { w, h } = fitSize(bmp.width, bmp.height);
    let out: Blob | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      if (!ctx) return file;
      ctx.fillStyle = '#fff'; // transparent PNGs on white, as JPEG has no alpha
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      out = await c.convertToBlob({ type: 'image/jpeg', quality: PHOTO_QUALITY });
    } else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return file;
      ctx.fillStyle = '#fff'; // transparent PNGs on white, as JPEG has no alpha
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      out = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', PHOTO_QUALITY));
    }
    return out ?? file;
  } catch {
    return file;
  } finally {
    bmp.close();
  }
}
