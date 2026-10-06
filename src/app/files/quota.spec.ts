import { describe, expect, it } from 'vitest';
import { fitSize, shouldCompress } from './photo';
import { checkRoom, formatBytes, isQuotaError, quotaText } from './quota';
import { base64Decode, base64Encode, base64Parts, backupWithFilesFilename, readBackupFiles, sanitizeAttachment } from './backup-files';
import { attachment, useNodeBlobs } from './testing/files-testing';

const MB = 1024 * 1024;

describe('quota', () => {
  it('recognises quota errors', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('checks room: 1.2× the file plus 5 MB must be free', () => {
    expect(checkRoom(10 * MB, null)).toBe('ok');
    expect(checkRoom(10 * MB, {})).toBe('ok');
    expect(checkRoom(10 * MB, { quota: 100 * MB, usage: 82 * MB })).toBe('ok');   // 18 MB free ≥ 17 MB
    expect(checkRoom(10 * MB, { quota: 100 * MB, usage: 84 * MB })).toBe('quota'); // 16 MB free
  });

  it('formats sizes and the quota copy', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(820 * 1024)).toBe('820 KB');
    expect(formatBytes(14.2 * MB)).toBe('14.2 MB');
    expect(quotaText(12.4 * MB)).toBe('Not enough space on this phone for this file (12.4 MB). Delete some files or photos, then try again.');
  });
});

describe('photo compression decision', () => {
  it('compresses over 2.5 MB or over 2560 px on the long side', () => {
    expect(shouldCompress(2 * MB, 2000, 1500)).toBe(false);
    expect(shouldCompress(3 * MB, 2000, 1500)).toBe(true);
    expect(shouldCompress(1 * MB, 4032, 3024)).toBe(true);
    expect(shouldCompress(1 * MB, 2560, 1440)).toBe(false);
    // small camera photos are re-encoded too, so their EXIF location is dropped
    expect(shouldCompress(1 * MB, 2000, 1500, 'image/jpeg')).toBe(true);
    expect(shouldCompress(1 * MB, 2000, 1500, 'image/heic')).toBe(true);
    expect(shouldCompress(1 * MB, 2000, 1500, 'image/png')).toBe(false);
    expect(fitSize(4032, 3024)).toEqual({ w: 2560, h: 1920 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});

describe('backup helpers', () => {
  it('base64 round-trips every length', () => {
    for (let n = 0; n < 9; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      const enc = base64Encode(bytes);
      expect(enc).toBe(Buffer.from(bytes).toString('base64'));
      expect([...base64Decode(enc)!]).toEqual([...bytes]);
    }
    expect(base64Decode('abc')).toBeNull();
    expect(base64Decode('ab$=')).toBeNull();
    expect(base64Decode('A===')).toBeNull();
    expect(base64Decode('====')).toBeNull();
    expect(base64Decode('AA=A')).toBeNull();
  });

  it('streams a blob as base64 chunks that concatenate', async () => {
    const restore = useNodeBlobs();
    try {
      const bytes = Uint8Array.from({ length: 3 * 256 * 1024 + 5 }, (_, i) => i & 255);
      const parts = await base64Parts(new Blob([bytes]));
      expect(parts.length).toBe(2);
      expect(parts.join('')).toBe(Buffer.from(bytes).toString('base64'));
    } finally {
      restore();
    }
  });

  it('names the file by date', () => {
    expect(backupWithFilesFilename(Date.parse('2026-10-01T13:00:00Z'))).toBe('routes-backup-with-files-2026-10-01.json');
  });

  it('sanitises attachments from a backup', () => {
    expect(sanitizeAttachment(attachment())).toEqual(attachment());
    expect(sanitizeAttachment({ ...attachment(), scope: { kind: 'leg' } })).toBeNull();
    expect(sanitizeAttachment({ ...attachment(), kind: 'pass' })).toBeNull();
    expect(sanitizeAttachment('x')).toBeNull();
    expect(sanitizeAttachment({ ...attachment(), scope: { kind: 'day', dateKey: '2026-10-09' } })?.scope).toEqual({ kind: 'day', dateKey: '2026-10-09' });
    expect(readBackupFiles({ files: { attachments: [{ meta: attachment(), data: 'aGk=' }, { meta: 1 }] } })).toEqual([{ meta: attachment(), data: 'aGk=' }]);
    expect(readBackupFiles({ trips: [] })).toEqual([]);
  });
});
