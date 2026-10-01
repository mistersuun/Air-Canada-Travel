/**
 * The zxing side of barcode decoding, with no Angular and no DOM, so the same
 * code runs in the decode worker (decode.worker.ts) and, where module workers
 * or OffscreenCanvas are missing (older iOS), on the main thread. zxing-wasm
 * loads lazily; its wasm comes from the URL the caller passes (the app's own
 * /vendor/zxing, never the default CDN).
 */
import { parseBcbp } from './bcbp';
import {
  BarcodeReader, ImageDataLike, LADDER, capImage, decodeWithLadder, transformImage,
} from './decode-ladder';
import type { BarcodeFormat, DecodeStep, DecodedRead } from './model';

const FORMATS = ['PDF417', 'Aztec', 'QRCode'] as const;
const READER_OPTIONS = { formats: [...FORMATS], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true };
/** Longest side of a PDF page image before decoding. */
export const PDF_PAGE_MAX_SIDE = 3200;

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

/** A reader returning at most `maxNumberOfSymbols` reads per image. */
export type ReaderFactory = (maxNumberOfSymbols: number) => Promise<BarcodeReader>;

type ZxingModule = typeof import('zxing-wasm/reader');

/**
 * zxing-wasm readers with the wasm at `wasmUrl`. The module loads once on
 * first use; a failed load is retried on the next call.
 */
export function zxingReaders(wasmUrl: string): ReaderFactory {
  let zx: Promise<ZxingModule> | null = null;
  const load = (): Promise<ZxingModule> => {
    zx ??= import('zxing-wasm/reader').then(async m => {
      await m.prepareZXingModule({
        overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) },
        fireImmediately: true,
      });
      return m;
    }).catch(e => {
      zx = null;
      throw e;
    });
    return zx;
  };
  return async maxNumberOfSymbols => {
    const m = await load();
    return async (img: ImageDataLike) => {
      const rs = await m.readBarcodes(img as ImageData, { ...READER_OPTIONS, maxNumberOfSymbols });
      const out: { text: string; format: BarcodeFormat }[] = [];
      for (const r of rs) {
        const format = normalizeFormat(r.format);
        if (format && r.text && r.isValid !== false) out.push({ text: r.text, format });
      }
      return out;
    };
  };
}

/** A photo, screenshot or camera frame: capped, then the ladder (or only `steps`). */
export async function decodeImageCore(img: ImageDataLike, readers: ReaderFactory, steps: readonly DecodeStep[] = LADDER): Promise<DecodedRead | null> {
  return decodeWithLadder(capImage(img), await readers(1), transformImage, isBcbp, steps);
}

/** One PDF page's result: its BCBP reads, or the first non-BCBP read when there were none. */
export interface PdfPageResult { found: DecodedRead[]; rejected: DecodedRead | null }

/**
 * One rendered PDF page: up to 4 symbols as-is, then the rest of the ladder
 * for a single one when none of those was a boarding pass.
 */
export async function decodePdfPageCore(img: ImageDataLike, page: number, readers: ReaderFactory): Promise<PdfPageResult> {
  const capped = capImage(img, PDF_PAGE_MAX_SIDE);
  const multi = await readers(4);
  const found = (await multi(capped).catch(() => [])).filter(r => isBcbp(r.text))
    .map(r => ({ text: r.text, format: r.format, step: 'as-is' as DecodeStep, page }));
  if (found.length) return { found, rejected: null };
  const one = await decodeWithLadder(capped, await readers(1), transformImage, isBcbp, LADDER.slice(1));
  if (one && isBcbp(one.text)) return { found: [{ ...one, page }], rejected: null };
  return { found: [], rejected: one ? { ...one, page } : null };
}

// ── Worker protocol ─────────────────────────────────────────────────────────

export type DecodeRequest =
  | { id: number; op: 'image'; img: ImageDataLike; steps: DecodeStep[] | null; wasmUrl: string }
  | { id: number; op: 'pdfPage'; img: ImageDataLike; page: number; wasmUrl: string };

export type DecodeResponse =
  | { type: 'ready' }
  | { id: number; ok: true; op: 'image'; read: DecodedRead | null }
  | { id: number; ok: true; op: 'pdfPage'; result: PdfPageResult }
  | { id: number; ok: false; error: string };

/**
 * Answers one worker request. `readersFor` caches readers per wasm URL. Any
 * failure (zxing failing to load, say) comes back as `ok: false`.
 */
export async function handleDecodeRequest(req: DecodeRequest, readersFor: (wasmUrl: string) => ReaderFactory): Promise<DecodeResponse> {
  try {
    const readers = readersFor(req.wasmUrl);
    if (req.op === 'image') return { id: req.id, ok: true, op: 'image', read: await decodeImageCore(req.img, readers, req.steps ?? LADDER) };
    return { id: req.id, ok: true, op: 'pdfPage', result: await decodePdfPageCore(req.img, req.page, readers) };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
