/**
 * A canvas stand-in for jsdom (which has no 2D context): records every
 * fillText and returns a tiny PNG (signature + IHDR with the canvas size).
 * jsdom's Blob cannot hold bytes, so specs pass Node's Blob as `makeBlob`
 * (import { Blob } from 'node:buffer').
 */
export interface StubCanvas {
  width: number;
  height: number;
  texts: string[];
  getContext(kind: '2d'): CanvasRenderingContext2D;
  toBlob(cb: (b: Blob | null) => void, type?: string): void;
}

/** 24 bytes: the PNG signature, the IHDR length and type, width and height. */
export function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}

export function stubCanvas(
  texts: string[] = [],
  makeBlob: (bytes: Uint8Array) => Blob = bytes => new Blob([bytes as BlobPart], { type: 'image/png' }),
): (w: number, h: number) => HTMLCanvasElement {
  return (w, h) => {
    const noop = () => undefined;
    const target: Record<string, unknown> = {
      fillText: (t: string) => { texts.push(t); },
      measureText: (t: string) => ({ width: t.length * 20 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
    };
    const ctx = new Proxy(target, {
      get: (o, k: string) => (k in o ? o[k] : noop),
      set: (o, k: string, v) => { o[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const c: StubCanvas = {
      width: w,
      height: h,
      texts,
      getContext: () => ctx,
      toBlob(cb) { cb(makeBlob(pngHeader(this.width, this.height))); },
    };
    return c as unknown as HTMLCanvasElement;
  };
}
