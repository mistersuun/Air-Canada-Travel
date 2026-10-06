import { describe, expect, it } from 'vitest';
import {
  buildGroupLink, decryptText, encryptText, generateGroupKey, newGroupId, newWriteToken, parseGroupFragment, viewOnlyLink,
} from './group-crypto';

describe('group crypto', () => {
  it('round-trips text, with a fresh IV each time', async () => {
    const key = await generateGroupKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const a = await encryptText('plan: AC834 ✈ Ana', key);
    const b = await encryptText('plan: AC834 ✈ Ana', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.ciphertext).not.toContain('AC834');
    expect(await decryptText(a, key)).toBe('plan: AC834 ✈ Ana');
  });
  it('fails (null) with the wrong key or tampered data', async () => {
    const key = await generateGroupKey();
    const sealed = await encryptText('secret', key);
    expect(await decryptText(sealed, await generateGroupKey())).toBeNull();
    const flipped = { ...sealed, ciphertext: (sealed.ciphertext[0] === 'A' ? 'B' : 'A') + sealed.ciphertext.slice(1) };
    expect(await decryptText(flipped, key)).toBeNull();
    expect(await decryptText({ ciphertext: '!!', iv: '??' }, key)).toBeNull();
    expect(await decryptText(sealed, 'short')).toBeNull();
  });
  it('ids are 128-bit and tokens 256-bit url-safe strings, all different', () => {
    const ids = new Set([newGroupId(), newGroupId(), newGroupId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newWriteToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('group links', () => {
  const id = 'AAAAAAAAAAAAAAAAAAAAAA';
  const key = 'k'.repeat(43);
  const write = 'w'.repeat(43);
  it('builds with the key and token in the fragment only', () => {
    const url = buildGroupLink('https://x.test/', { id, key, write });
    expect(url).toBe(`https://x.test/g/${id}#k=${key}&w=${write}`);
    expect(url.split('#')[0]).not.toContain(key);
    expect(buildGroupLink('https://x.test', viewOnlyLink({ id, key, write }))).toBe(`https://x.test/g/${id}#k=${key}`);
  });
  it('parses what it builds, with or without the # and the token', () => {
    expect(parseGroupFragment(id, `k=${key}&w=${write}`)).toEqual({ id, key, write });
    expect(parseGroupFragment(id, `#k=${key}`)).toEqual({ id, key, write: null });
    expect(parseGroupFragment(id, `w=${write}&k=${key}`)).toEqual({ id, key, write });
  });
  it('rejects malformed ids, keys and tokens', () => {
    expect(parseGroupFragment('short', `k=${key}`)).toBeNull();
    expect(parseGroupFragment(id, null)).toBeNull();
    expect(parseGroupFragment(id, '')).toBeNull();
    expect(parseGroupFragment(id, 'k=tooshort')).toBeNull();
    expect(parseGroupFragment(id, `k=${key}&w=bad`)).toBeNull();
    expect(parseGroupFragment(id, `w=${write}`)).toBeNull();
  });
});
