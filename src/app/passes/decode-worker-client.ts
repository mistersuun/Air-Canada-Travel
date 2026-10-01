/**
 * Main-thread side of the decode worker: request/response by id, image
 * buffers transferred (not copied). The worker says 'ready' as soon as its
 * module runs; if it doesn't within READY_TIMEOUT_MS, or it errors, or zxing
 * fails to load inside it, the client is marked broken and every pending and
 * later call rejects with WorkerUnavailable so the caller decodes on the main
 * thread instead.
 */
import type { DecodeRequest, DecodeResponse, PdfPageResult } from './decode-core';
import type { ImageDataLike } from './decode-ladder';
import type { DecodeStep, DecodedRead } from './model';

/** The parts of a Worker the client uses (a fake in specs). */
export interface WorkerLike {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  addEventListener(type: 'error' | 'messageerror', fn: (e: Event) => void): void;
  terminate(): void;
}

export class WorkerUnavailable extends Error {
  constructor(reason: string) {
    super(`Decode worker unavailable: ${reason}`);
    this.name = 'WorkerUnavailable';
  }
}

/** How long a new worker has to start before decoding falls back to the main thread. */
export const READY_TIMEOUT_MS = 8000;

/** A request without the fields the client fills in (id, wasmUrl), per variant. */
type RequestBody = DecodeRequest extends infer R ? (R extends DecodeRequest ? Omit<R, 'id' | 'wasmUrl'> : never) : never;

type Pending = { resolve: (r: DecodeResponse) => void; reject: (e: Error) => void };

/** `{ data, width, height }` with its own buffer (a plain object survives structured clone; an ImageData's buffer is transferred). */
function payload(img: ImageDataLike): { img: ImageDataLike; transfer: Transferable[] } {
  return { img: { data: img.data, width: img.width, height: img.height }, transfer: [img.data.buffer as ArrayBuffer] };
}

export class DecodeWorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private broken: string | null = null;
  private readonly ready: Promise<void>;
  private onFail: (reason: string) => void = () => undefined;

  constructor(private readonly worker: WorkerLike, private readonly wasmUrl: string, readyTimeoutMs = READY_TIMEOUT_MS) {
    let markReady!: () => void;
    let failReady!: (e: Error) => void;
    this.ready = new Promise<void>((res, rej) => {
      markReady = res;
      failReady = rej;
    });
    this.ready.catch(() => undefined);
    const timer = setTimeout(() => this.fail('did not start'), readyTimeoutMs);
    this.onFail = reason => {
      clearTimeout(timer);
      failReady(new WorkerUnavailable(reason));
    };
    worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as DecodeResponse;
      if ('type' in msg) {
        clearTimeout(timer);
        markReady();
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg);
      else {
        // zxing could not load in the worker: the main thread gets its own try.
        p.reject(new WorkerUnavailable(msg.error));
        this.fail(msg.error);
      }
    });
    worker.addEventListener('error', () => this.fail('worker error'));
    worker.addEventListener('messageerror', () => this.fail('message error'));
  }

  /** True once the worker failed: callers decode on the main thread. */
  get isBroken(): boolean {
    return this.broken !== null;
  }

  private fail(reason: string): void {
    if (this.broken) return;
    this.broken = reason;
    this.onFail(reason);
    for (const p of this.pending.values()) p.reject(new WorkerUnavailable(reason));
    this.pending.clear();
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
  }

  private async send(req: RequestBody, transfer: Transferable[]): Promise<DecodeResponse> {
    if (this.broken) throw new WorkerUnavailable(this.broken);
    await this.ready;
    if (this.broken) throw new WorkerUnavailable(this.broken);
    const id = this.nextId++;
    return new Promise<DecodeResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ ...req, id, wasmUrl: this.wasmUrl }, transfer);
      } catch (e) {
        this.pending.delete(id);
        reject(new WorkerUnavailable(e instanceof Error ? e.message : 'postMessage failed'));
      }
    });
  }

  /** The ladder on a photo or frame. The image's buffer is transferred: don't use `img` afterwards. */
  async decodeImage(img: ImageDataLike, steps: DecodeStep[] | null = null): Promise<DecodedRead | null> {
    const p = payload(img);
    const res = await this.send({ op: 'image', img: p.img, steps }, p.transfer);
    return res && 'op' in res && res.op === 'image' ? res.read : null;
  }

  /** One rendered PDF page. The image's buffer is transferred. */
  async decodePdfPage(img: ImageDataLike, page: number): Promise<PdfPageResult> {
    const p = payload(img);
    const res = await this.send({ op: 'pdfPage', img: p.img, page }, p.transfer);
    return res && 'op' in res && res.op === 'pdfPage' ? res.result : { found: [], rejected: null };
  }

  terminate(): void {
    this.fail('terminated');
  }
}
