import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTripShare, toBase64Url } from './share-codec';

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw' as CompressionFormat);
  const writer = cs.writable.getWriter();
  void writer.write(new Uint8Array(bytes)).then(() => writer.close());
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

describe('decodeTripShare inflation guard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a payload that inflates past the limit and cancels the stream instead of leaving it open', async () => {
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const bomb = await deflate(new Uint8Array(2_000_000));
    expect(bomb.length).toBeLessThan(10_000);
    expect(await decodeTripShare('z' + toBase64Url(bomb))).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
});
