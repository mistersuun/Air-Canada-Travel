/**
 * Module worker running the zxing retry ladder off the main thread, so the
 * camera preview and the UI don't stutter while a pass is decoded. Bundled by
 * the Angular builder as worker-<hash>.js on this origin (CSP worker-src
 * 'self'); zxing's wasm is fetched from the self-hosted /vendor/zxing URL sent
 * with each request. Images arrive as raw RGBA (transferred, not copied).
 */
import { type DecodeRequest, type ReaderFactory, handleDecodeRequest, zxingReaders } from './decode-core';

const scope = self as unknown as {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<DecodeRequest>) => void): void;
};

const readers = new Map<string, ReaderFactory>();
const readersFor = (url: string): ReaderFactory => {
  let r = readers.get(url);
  if (!r) readers.set(url, (r = zxingReaders(url)));
  return r;
};

scope.addEventListener('message', e => {
  void handleDecodeRequest(e.data, readersFor).then(res => scope.postMessage(res));
});
scope.postMessage({ type: 'ready' });
