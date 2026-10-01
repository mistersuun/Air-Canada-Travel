import { describe, expect, it } from 'vitest';
import { isBcbp } from './barcode.service';
import {
  ImageDataLike, LADDER, capImage, decodeWithLadder, invertImage, rotateImage, scaleImage, transformImage,
} from './decode-ladder';
import type { DecodeStep } from './model';
import { BCBP_MINIMAL } from './testing/bcbp-fixtures';

function img(w = 4, h = 2, v = 0): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([v, v, v, 255], i);
  return { data, width: w, height: h };
}

/** Tags each transformed image with its step, so a fake reader knows which step it sees. */
const tagging = (base: ImageDataLike) => {
  const tags = new WeakMap<ImageDataLike, DecodeStep>([[base, 'as-is']]);
  const transform = (i: ImageDataLike, step: DecodeStep): ImageDataLike => {
    const out = { ...i };
    tags.set(out, step);
    return out;
  };
  return { tags, transform };
};

describe('decodeWithLadder', () => {
  it('tries the steps in order and stops at the first BCBP read', async () => {
    const base = img();
    const { tags, transform } = tagging(base);
    const seen: DecodeStep[] = [];
    const read = async (i: ImageDataLike) => {
      const step = tags.get(i)!;
      seen.push(step);
      return step === 'up2x' ? [{ text: BCBP_MINIMAL, format: 'PDF417' as const }] : [];
    };
    const r = await decodeWithLadder(base, read, transform, isBcbp);
    expect(r).toEqual({ text: BCBP_MINIMAL, format: 'PDF417', step: 'up2x', page: null });
    expect(seen).toEqual(['as-is', 'invert', 'up2x']);
  });

  it('skips non-BCBP reads and keeps going', async () => {
    const base = img();
    const { tags, transform } = tagging(base);
    const read = async (i: ImageDataLike) => tags.get(i) === 'as-is'
      ? [{ text: 'https://example.com', format: 'QRCode' as const }]
      : tags.get(i) === 'invert' ? [{ text: BCBP_MINIMAL, format: 'Aztec' as const }] : [];
    expect(await decodeWithLadder(base, read, transform, isBcbp)).toMatchObject({ step: 'invert', format: 'Aztec' });
  });

  it('returns the first rejected read when nothing is a boarding pass, and null when nothing was read', async () => {
    const base = img();
    const { transform } = tagging(base);
    const url = await decodeWithLadder(base, async () => [{ text: 'https://example.com', format: 'QRCode' }], transform, isBcbp);
    expect(url).toEqual({ text: 'https://example.com', format: 'QRCode', step: 'as-is', page: null });
    expect(isBcbp(url!.text)).toBe(false);
    let calls = 0;
    expect(await decodeWithLadder(base, async () => { calls++; return []; }, transform, isBcbp)).toBeNull();
    expect(calls).toBe(LADDER.length);
  });

  it('treats a reader error as no read', async () => {
    const base = img();
    const { tags, transform } = tagging(base);
    const read = async (i: ImageDataLike) => {
      if (tags.get(i) === 'as-is') throw new Error('wasm');
      return [{ text: BCBP_MINIMAL, format: 'PDF417' as const }];
    };
    expect((await decodeWithLadder(base, read, transform, isBcbp))?.step).toBe('invert');
  });

  it('can run a subset of steps', async () => {
    const base = img();
    const { transform } = tagging(base);
    let calls = 0;
    await decodeWithLadder(base, async () => { calls++; return []; }, transform, isBcbp, ['as-is']);
    expect(calls).toBe(1);
  });
});

describe('pure transforms', () => {
  it('inverts to opaque, treating transparent as black first', () => {
    const i = img(1, 1, 0);
    i.data[3] = 0;
    expect([...invertImage(i).data]).toEqual([255, 255, 255, 255]);
    expect([...invertImage(img(1, 1, 200)).data]).toEqual([55, 55, 55, 255]);
  });

  it('scales, rotates on white and caps the size', () => {
    const s = scaleImage(img(10, 4), 2);
    expect([s.width, s.height]).toEqual([20, 8]);
    const r = rotateImage(img(100, 20), 7);
    expect(r.width).toBeGreaterThan(100);
    expect(r.height).toBeGreaterThan(20);
    expect([...r.data.slice(0, 4)]).toEqual([255, 255, 255, 255]); // corner outside the image is white
    const c = capImage(img(4800, 100), 2400);
    expect([c.width, c.height]).toEqual([2400, 50]);
    const same = img(10, 10);
    expect(capImage(same)).toBe(same);
    expect(transformImage(same, 'as-is')).toBe(same);
    expect(transformImage(img(10, 10), 'up2x').width).toBe(20);
    expect(transformImage(img(3000, 10), 'up2x').width).toBe(3200);
  });
});
