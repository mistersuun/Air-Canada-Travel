/**
 * Redraws a pass barcode from its decoded text (extras spec §4.7). bwip-js
 * loads lazily, only when a pass is shown, and stays in the offline cache
 * (the ngsw "app" group prefetches every chunk).
 */
import type { BarcodeFormat } from './model';

/** bwip-js symbology per decoded format. */
export const BWIP_ID: Record<BarcodeFormat, string> = { PDF417: 'pdf417', Aztec: 'azteccode', QRCode: 'qrcode' };

/**
 * The bwip-js options the pass view renders with: white background, dark
 * bars and a quiet zone. Shared with the round-trip spec, so what the spec
 * decodes is what the app draws.
 */
export function barcodeOptions(text: string, format: BarcodeFormat): {
  bcid: string; text: string; scale: number; paddingwidth: number; paddingheight: number; backgroundcolor: string; barcolor: string;
} {
  // PDF417 needs a wide quiet zone left and right; square codes need it all round.
  const pad = format === 'PDF417' ? 10 : 6;
  return { bcid: BWIP_ID[format], text, scale: 3, paddingwidth: pad, paddingheight: pad, backgroundcolor: 'FFFFFF', barcolor: '000000' };
}

/** SVG markup of the barcode on a white background with a quiet zone. */
export async function renderBarcodeSvg(text: string, format: BarcodeFormat): Promise<string> {
  const bwip = await import('bwip-js/browser');
  return bwip.toSVG(barcodeOptions(text, format));
}
