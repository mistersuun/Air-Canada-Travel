// @vitest-environment node
/**
 * Real barcodes, end to end: bwip-js draws each sample (with the options the
 * pass view uses) as PDF417, Aztec and QR, and zxing-wasm 3.1.4 (the wasm
 * from node_modules) reads them back to the identical text. The ladder and
 * its pure transforms are checked against the real reader too.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bwip from 'bwip-js';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { barcodeOptions, renderBarcodeSvg } from './barcode-render';
import { isBcbp, normalizeFormat } from './barcode.service';
import { parseBcbp } from './bcbp';
import { ImageDataLike, decodeWithLadder, invertImage, rotateImage, transformImage } from './decode-ladder';
import type { BarcodeFormat } from './model';
import { BCBP_SAMPLES } from './testing/bcbp-fixtures';

const FORMATS: BarcodeFormat[] = ['PDF417', 'Aztec', 'QRCode'];
const OPTS = { formats: ['PDF417', 'Aztec', 'QRCode'] as ('PDF417' | 'Aztec' | 'QRCode')[], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 };

beforeAll(async () => {
  const wasm = readFileSync(join(__dirname, '../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));
  await prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true });
});

async function read(input: Uint8Array | ImageDataLike): Promise<{ text: string; format: BarcodeFormat }[]> {
  const rs = await readBarcodes(input as Uint8Array, OPTS);
  return rs.flatMap(r => {
    const format = normalizeFormat(r.format);
    return format && r.text ? [{ text: r.text, format }] : [];
  });
}

/** The symbol's module matrix as black-on-white RGBA, `px` pixels per module with a quiet zone. */
function rasterize(text: string, format: BarcodeFormat, px = 3, quiet = 8): ImageDataLike {
  const { bcid } = barcodeOptions(text, format);
  const [sym] = bwip.raw(bcid, text, {}) as { pixs: number[]; pixx: number; pixy: number }[];
  const rows = sym.pixs.length / sym.pixx;
  const rowH = Math.max(1, Math.round(sym.pixy / rows)); // PDF417 rows are several modules tall
  const w = (sym.pixx + quiet * 2) * px, h = (rows * rowH + quiet * 2) * px;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < sym.pixx; c++) {
      if (!sym.pixs[r * sym.pixx + c]) continue;
      for (let y = (quiet + r * rowH) * px; y < (quiet + (r + 1) * rowH) * px; y++) {
        for (let x = (quiet + c) * px; x < (quiet + c + 1) * px; x++) data.set([0, 0, 0, 255], (y * w + x) * 4);
      }
    }
  }
  return { data, width: w, height: h };
}

describe('barcode round trip (bwip-js → zxing-wasm)', () => {
  for (const [name, text] of Object.entries(BCBP_SAMPLES)) {
    for (const format of FORMATS) {
      it(`${name} as ${format}`, async () => {
        const png = await bwip.toBuffer(barcodeOptions(text, format));
        const [r] = await read(new Uint8Array(png));
        expect(r?.format).toBe(format);
        expect(r?.text).toBe(text);
        expect(parseBcbp(r!.text).ok).toBe(true);
      });
    }
  }

  it('renderBarcodeSvg draws an SVG on white', async () => {
    const svg = await renderBarcodeSvg(BCBP_SAMPLES.minimal, 'PDF417');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/fill="#FFFFFF"/i);
  });

  it('the ladder reads real images: plain, inverted and rotated', async () => {
    for (const format of FORMATS) {
      const plain = rasterize(BCBP_SAMPLES.full, format);
      expect((await decodeWithLadder(plain, read, transformImage, isBcbp))?.text, format).toBe(BCBP_SAMPLES.full);
      const inverted = invertImage(plain);
      expect((await decodeWithLadder(inverted, read, transformImage, isBcbp))?.text, `${format} inverted`).toBe(BCBP_SAMPLES.full);
      const tilted = rotateImage(rasterize(BCBP_SAMPLES.minimal, format), 7);
      const back = await decodeWithLadder(tilted, read, transformImage, isBcbp);
      expect(back?.text, `${format} tilted`).toBe(BCBP_SAMPLES.minimal);
    }
  });

  it('a QR code with a link is read but is not a boarding pass', async () => {
    const png = await bwip.toBuffer(barcodeOptions('https://example.com/trip', 'QRCode'));
    const [r] = await read(new Uint8Array(png));
    expect(r.text).toBe('https://example.com/trip');
    expect(isBcbp(r.text)).toBe(false);
  });
});
