import { describe, expect, it, vi } from 'vitest';
import { canShareFiles, copyText, downloadBlob, shareImage, shareText } from './share-out';

const abort = () => Object.assign(new Error('cancel'), { name: 'AbortError' });
const png = () => new Blob(['x'], { type: 'image/png' });

describe('shareText', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn(async () => undefined);
    expect(await shareText('hi', 'Trip', { navigator: { share } })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Trip', text: 'hi' });
  });

  it('reports a dismissed share sheet as cancelled', async () => {
    expect(await shareText('hi', 'Trip', { navigator: { share: vi.fn(async () => { throw abort(); }) } })).toBe('cancelled');
  });

  it('copies when there is no share sheet, or it fails', async () => {
    const writeText = vi.fn(async () => undefined);
    const clipboard = { writeText } as unknown as Clipboard;
    expect(await shareText('hi', 'Trip', { navigator: { clipboard } })).toBe('copied');
    const share = vi.fn(async () => { throw new Error('NotAllowed'); });
    expect(await shareText('hi', 'Trip', { navigator: { share, clipboard } })).toBe('copied');
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('fails when nothing can copy', async () => {
    expect(await shareText('hi', 'Trip', { navigator: null, document: null })).toBe('failed');
  });
});

describe('copyText', () => {
  it('falls back to a hidden textarea and execCommand', async () => {
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText('hi', { navigator: {}, document })).toBe('copied');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('shareImage', () => {
  it('shares the PNG as a file when canShare allows files', async () => {
    const share = vi.fn(async (_: ShareData) => undefined);
    const canShare = vi.fn(() => true);
    expect(await shareImage(png(), 'routes-seville-2026-10-08.png', 'Trip', { navigator: { share, canShare } })).toBe('shared');
    const files = share.mock.calls[0][0].files!;
    expect(files[0].name).toBe('routes-seville-2026-10-08.png');
    expect(files[0].type).toBe('image/png');
  });

  it('downloads when files cannot be shared', async () => {
    const created: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') { created.push(el as HTMLAnchorElement); (el as HTMLAnchorElement).click = vi.fn(); }
      return el;
    });
    URL.createObjectURL ??= () => 'blob:x';
    URL.revokeObjectURL ??= () => undefined;
    const env = { navigator: { share: vi.fn(), canShare: () => false }, document };
    expect(await shareImage(png(), 'routes-seville-2026-10-08.png', 'Trip', env)).toBe('downloaded');
    expect(created[0].download).toBe('routes-seville-2026-10-08.png');
    expect(created[0].click).toHaveBeenCalled();
    expect(env.navigator.share).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports a dismissed share sheet as cancelled', async () => {
    const env = { navigator: { share: vi.fn(async () => { throw abort(); }), canShare: () => true } };
    expect(await shareImage(png(), 'a.png', 'Trip', env)).toBe('cancelled');
  });

  it('downloadBlob fails without a document', () => {
    expect(downloadBlob(png(), 'a.png', { document: null })).toBe('failed');
  });

  it('canShareFiles reflects navigator.canShare', () => {
    expect(canShareFiles({ navigator: { share: vi.fn(), canShare: () => true } })).toBe(true);
    expect(canShareFiles({ navigator: { share: vi.fn() } })).toBe(false);
    expect(canShareFiles({ navigator: null })).toBe(false);
  });
});
