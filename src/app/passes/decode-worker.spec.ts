/**
 * The decode worker protocol and its main-thread fallback. A fake Worker
 * answers in-process through the same handler the real worker runs
 * (handleDecodeRequest), with a fake zxing reader, so the specs check the
 * message flow, the transferred buffers and every fallback path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BarcodeService, DECODE_WORKER, workerDecodingSupported } from './barcode.service';
import { type DecodeRequest, type ReaderFactory, decodePdfPageCore, handleDecodeRequest } from './decode-core';
import { DecodeWorkerClient, WorkerUnavailable, type WorkerLike } from './decode-worker-client';
import type { ImageDataLike } from './decode-ladder';
import { BCBP_SAMPLES } from './testing/bcbp-fixtures';

const PASS = BCBP_SAMPLES.full;

/** The main-thread path's zxing, faked: counts its reads and sees the sample pass. */
const main = vi.hoisted(() => ({ reads: 0, text: '' }));
vi.mock('./decode-core', async orig => {
  const real = await orig<typeof import('./decode-core')>();
  return {
    ...real,
    zxingReaders: (): ReaderFactory => async () => async () => {
      main.reads++;
      return [{ text: main.text, format: 'Aztec' as const }];
    },
  };
});

function image(w = 4, h = 2): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(255);
  return { data, width: w, height: h };
}

/** A reader that "sees" `text` on every image, recording the sizes it was given. */
function readers(text: string | null, seen: number[] = []): ReaderFactory {
  return async () => async img => {
    seen.push(img.width);
    return text ? [{ text, format: 'PDF417' as const }] : [];
  };
}

type Listener = (e: { data: unknown }) => void;

/** A Worker stand-in: posts 'ready' (unless told not to) and answers with handleDecodeRequest. */
class FakeWorker implements WorkerLike {
  readonly sent: { msg: DecodeRequest; transfer: Transferable[] }[] = [];
  private readonly on: Record<string, Listener[]> = {};
  terminated = false;

  constructor(private readonly reader: ReaderFactory, opts: { ready?: boolean; failLoad?: boolean } = {}) {
    if (opts.ready !== false) queueMicrotask(() => this.emit('message', { type: 'ready' }));
    if (opts.failLoad) this.reader = async () => { throw new Error('wasm blocked'); };
  }

  addEventListener(type: string, fn: Listener): void {
    (this.on[type] ??= []).push(fn);
  }

  emit(type: string, data: unknown): void {
    for (const fn of this.on[type] ?? []) fn({ data });
  }

  postMessage(msg: unknown, transfer: Transferable[]): void {
    const req = msg as DecodeRequest;
    this.sent.push({ msg: req, transfer });
    // Structured clone with transfer: the sender's buffer is detached.
    const copy = { ...req, img: { ...req.img, data: new Uint8ClampedArray(req.img.data) } };
    for (const t of transfer) structuredClone(t, { transfer: [t as ArrayBuffer] });
    void handleDecodeRequest(copy as DecodeRequest, () => this.reader).then(res => this.emit('message', res));
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('decode worker', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('only moves decoding to a worker where Worker and OffscreenCanvas both exist', () => {
    const F = function () { /* constructor */ };
    expect(workerDecodingSupported({ Worker: F, OffscreenCanvas: F })).toBe(true);
    expect(workerDecodingSupported({ Worker: F })).toBe(false);
    expect(workerDecodingSupported({ OffscreenCanvas: F })).toBe(false);
  });

  it('answers an image request with the ladder and a PDF page with its BCBP reads', async () => {
    const img = await handleDecodeRequest({ id: 1, op: 'image', img: image(), steps: null, wasmUrl: 'x' }, () => readers(PASS));
    expect(img).toEqual({ id: 1, ok: true, op: 'image', read: { text: PASS, format: 'PDF417', step: 'as-is', page: null } });
    const page = await handleDecodeRequest({ id: 2, op: 'pdfPage', img: image(), page: 2, wasmUrl: 'x' }, () => readers(PASS));
    expect(page).toMatchObject({ id: 2, ok: true, result: { found: [{ text: PASS, page: 2 }], rejected: null } });
    const url = await decodePdfPageCore(image(), 1, readers('https://example.com'));
    expect(url).toEqual({ found: [], rejected: { text: 'https://example.com', format: 'PDF417', step: 'invert', page: 1 } });
  });

  it('reports a zxing load failure instead of throwing', async () => {
    const bad: ReaderFactory = async () => { throw new Error('wasm blocked'); };
    expect(await handleDecodeRequest({ id: 3, op: 'image', img: image(), steps: ['as-is'], wasmUrl: 'x' }, () => bad))
      .toEqual({ id: 3, ok: false, error: 'wasm blocked' });
  });

  it('client: transfers the pixels with the self-hosted wasm URL and resolves by id', async () => {
    const w = new FakeWorker(readers(PASS));
    const client = new DecodeWorkerClient(w, 'https://routes.test/vendor/zxing/zxing_reader.wasm');
    const img = image();
    const [a, b] = await Promise.all([client.decodeImage(img, ['as-is']), client.decodePdfPage(image(), 1)]);
    expect(a?.text).toBe(PASS);
    expect(b.found[0]).toMatchObject({ text: PASS, page: 1 });
    expect(w.sent.map(s => [s.msg.id, s.msg.op, s.msg.wasmUrl])).toEqual([
      [1, 'image', 'https://routes.test/vendor/zxing/zxing_reader.wasm'],
      [2, 'pdfPage', 'https://routes.test/vendor/zxing/zxing_reader.wasm'],
    ]);
    expect(w.sent[0].transfer).toHaveLength(1);
    expect(img.data.byteLength).toBe(0); // transferred, not copied
  });

  it('client: a worker that never starts, errors or cannot load zxing becomes unavailable', async () => {
    vi.useFakeTimers();
    const silent = new FakeWorker(readers(PASS), { ready: false });
    const slow = new DecodeWorkerClient(silent, 'u', 1000);
    const p = slow.decodeImage(image());
    vi.advanceTimersByTime(1000);
    await expect(p).rejects.toBeInstanceOf(WorkerUnavailable);
    expect(slow.isBroken).toBe(true);
    expect(silent.terminated).toBe(true);
    vi.useRealTimers();

    const crashing = new FakeWorker(readers(PASS));
    const c2 = new DecodeWorkerClient(crashing, 'u');
    crashing.emit('error', null);
    await expect(c2.decodeImage(image())).rejects.toBeInstanceOf(WorkerUnavailable);

    const blocked = new DecodeWorkerClient(new FakeWorker(readers(PASS), { failLoad: true }), 'u');
    await expect(blocked.decodeImage(image())).rejects.toBeInstanceOf(WorkerUnavailable);
    expect(blocked.isBroken).toBe(true);
  });

  it('service: camera frames go through the worker', async () => {
    const w = new FakeWorker(readers(PASS));
    TestBed.configureTestingModule({ providers: [{ provide: DECODE_WORKER, useValue: () => w }] });
    const svc = TestBed.inject(BarcodeService);
    const read = await svc.decodeImageData(image() as ImageData);
    expect(read).toMatchObject({ text: PASS, step: 'as-is' });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].msg).toMatchObject({ op: 'image', steps: ['as-is'] });
  });

  it('service: falls back to the main thread when the worker is unavailable', async () => {
    main.reads = 0;
    main.text = PASS;
    const w = new FakeWorker(readers(PASS), { failLoad: true });
    TestBed.configureTestingModule({ providers: [{ provide: DECODE_WORKER, useValue: () => w }] });
    const svc = TestBed.inject(BarcodeService);
    // The frame was handed over, so it is dropped; the scanner tries the next one.
    expect(await svc.decodeImageData(image() as ImageData)).toBeNull();
    expect(w.terminated).toBe(true);
    expect(main.reads).toBe(0);
    // From now on the main thread decodes.
    w.sent.length = 0;
    expect(await svc.decodeImageData(image() as ImageData)).toMatchObject({ text: PASS, format: 'Aztec' });
    expect(w.sent).toHaveLength(0);
    expect(main.reads).toBe(1);
  });

  it('service: no worker factory (older iOS) means the main thread from the start', async () => {
    main.reads = 0;
    main.text = PASS;
    TestBed.configureTestingModule({ providers: [{ provide: DECODE_WORKER, useValue: null }] });
    const svc = TestBed.inject(BarcodeService);
    expect(await svc.decodeImageData(image() as ImageData)).toMatchObject({ text: PASS });
    expect(main.reads).toBe(1);
  });
});
