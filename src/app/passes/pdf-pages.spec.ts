import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdf = vi.hoisted(() => ({
  state: { numPages: 3, openMs: 0, failRender: false, destroyed: 0 },
  opts: { workerSrc: '' },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.min.mjs', () => ({
  GlobalWorkerOptions: pdf.opts,
  getDocument: () => ({
    promise: new Promise(resolve => setTimeout(() => resolve({
      numPages: pdf.state.numPages,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
        render: () => ({ promise: pdf.state.failRender ? Promise.reject(new Error('render')) : Promise.resolve() }),
        cleanup: () => undefined,
      }),
    }), pdf.state.openMs)),
    destroy: async () => { pdf.state.destroyed++; },
  }),
}));

import { PDF_OPEN_TIMEOUT_MS, PDF_WORKER_PATH, canvasJpeg, canvasPng, context2d, forEachPdfPage, makeCanvas, selfHosted } from './pdf-pages';

/** A canvas whose 2d context records what is drawn (jsdom has no canvas). */
function fakeCanvas() {
  const ctx = {
    fillStyle: '', fillRect: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(4) }),
  };
  const c = { width: 0, height: 0, getContext: vi.fn(() => ctx), toBlob: vi.fn((cb: (b: Blob | null) => void, type: string) => cb(new Blob(['x'], { type }))) };
  return { c, ctx };
}

beforeEach(() => {
  pdf.state.numPages = 3;
  pdf.state.openMs = 0;
  pdf.state.failRender = false;
  pdf.state.destroyed = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('canvas helpers', () => {
  it('makeCanvas uses an OffscreenCanvas when there is one, else a detached <canvas>', () => {
    const made: unknown[] = [];
    vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) { made.push(this); } });
    const off = makeCanvas(10, 20);
    expect(made).toEqual([off]);
    vi.stubGlobal('OffscreenCanvas', undefined);
    const el = makeCanvas(30, 40) as HTMLCanvasElement;
    expect(el.tagName).toBe('CANVAS');
    expect([el.width, el.height]).toEqual([30, 40]);
  });

  it('context2d returns the 2d context or throws', () => {
    const { c, ctx } = fakeCanvas();
    expect(context2d(c as unknown as HTMLCanvasElement)).toBe(ctx);
    expect(c.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(() => context2d({ getContext: () => null } as unknown as HTMLCanvasElement)).toThrow('2d canvas unavailable');
  });

  it('canvasPng / canvasJpeg use convertToBlob when present, else toBlob', async () => {
    const convertToBlob = vi.fn(async (o: { type: string }) => new Blob(['x'], { type: o.type }));
    const off = { convertToBlob } as unknown as OffscreenCanvas;
    expect((await canvasPng(off)).type).toBe('image/png');
    expect((await canvasJpeg(off, 0.7)).type).toBe('image/jpeg');
    expect(convertToBlob).toHaveBeenLastCalledWith({ type: 'image/jpeg', quality: 0.7 });

    const { c } = fakeCanvas();
    expect((await canvasPng(c as unknown as HTMLCanvasElement)).type).toBe('image/png');
    expect((await canvasJpeg(c as unknown as HTMLCanvasElement, 0.5)).type).toBe('image/jpeg');
    c.toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null));
    await expect(canvasPng(c as unknown as HTMLCanvasElement)).rejects.toThrow('toBlob failed');
    await expect(canvasJpeg(c as unknown as HTMLCanvasElement, 0.5)).rejects.toThrow('toBlob failed');
  });

  it('selfHosted resolves against the document base', () => {
    expect(selfHosted(PDF_WORKER_PATH)).toBe(new URL(PDF_WORKER_PATH, document.baseURI).href);
  });
});

describe('forEachPdfPage', () => {
  function stubCanvas() {
    const { c, ctx } = fakeCanvas();
    vi.stubGlobal('OffscreenCanvas', class { constructor(w: number, h: number) { Object.assign(c, { width: w, height: h }); return c; } });
    return { c, ctx };
  }
  const file = () => ({ arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer }) as unknown as Blob;

  it('visits pages 1..min(n, max) at the given scale on white and reports the page count', async () => {
    const { c, ctx } = stubCanvas();
    const seen: number[] = [];
    const total = await forEachPdfPage(file(), 2, 1.5, async p => {
      seen.push(p.page);
      expect(p.image.width).toBe(150);
      expect(p.image.height).toBe(300);
      expect((await p.png()).type).toBe('image/png');
      expect((await p.jpeg(0.8)).type).toBe('image/jpeg');
    });
    expect(seen).toEqual([1, 2]);
    expect(total).toBe(3);
    expect(ctx.fillStyle).toBe('#fff');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, c.width, c.height);
    expect(pdf.opts.workerSrc).toBe(selfHosted(PDF_WORKER_PATH));
    expect(pdf.state.destroyed).toBe(1);
  });

  it('lets the scale depend on the page size at 1x', async () => {
    stubCanvas();
    const sizes: [number, number][] = [];
    await forEachPdfPage(file(), 1, (w, h) => { sizes.push([w, h]); return 0.5; }, async p => {
      expect([p.image.width, p.image.height]).toEqual([50, 100]);
    });
    expect(sizes).toEqual([[100, 200]]);
  });

  it('destroys the document when rendering or the visitor throws', async () => {
    stubCanvas();
    pdf.state.failRender = true;
    await expect(forEachPdfPage(file(), 1, 1, async () => undefined)).rejects.toThrow('render');
    expect(pdf.state.destroyed).toBe(1);
    pdf.state.failRender = false;
    await expect(forEachPdfPage(file(), 1, 1, async () => { throw new Error('visit'); })).rejects.toThrow('visit');
    expect(pdf.state.destroyed).toBe(2);
  });

  it('gives up when the document takes too long to open, and still cleans up', async () => {
    stubCanvas();
    vi.useFakeTimers();
    pdf.state.openMs = PDF_OPEN_TIMEOUT_MS + 5_000;
    const p = forEachPdfPage(file(), 1, 1, async () => undefined);
    const assertion = expect(p).rejects.toThrow('PDF took too long to open');
    await vi.advanceTimersByTimeAsync(PDF_OPEN_TIMEOUT_MS + 1);
    await assertion;
    expect(pdf.state.destroyed).toBe(1);
  });
});
