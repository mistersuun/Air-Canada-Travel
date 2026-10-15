import { describe, expect, it } from 'vitest';
import { makeLimiter } from './limits';
import {
  DAY_MS, MAX_CIPHERTEXT, computeExpiry, deleteGroup, getGroup, hashToken, parsePutBody, putGroup, SWEEP_CONCURRENCY, sweepGroups, validId, validToken, type GroupStore,
} from './group';

const NOW = Date.parse('2026-10-06T15:00:00Z');
const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const TOKEN = 'tokentokentokentokentoken';
const OWNER = 'ownerownerownerownerowner';
const body = (over: Record<string, unknown> = {}) => parsePutBody({ ciphertext: 'c'.repeat(40), iv: 'i'.repeat(16), baseVersion: 0, ...over })!;

/** A fake Blobs store: strong consistency, ETag per write, conditional writes. */
function memory(): GroupStore & { m: Map<string, { v: string; e: number }> } {
  const m = new Map<string, { v: string; e: number }>();
  let seq = 0;
  return {
    m,
    getWithMetadata: async k => { await Promise.resolve(); const x = m.get(k); return x ? { data: x.v, etag: String(x.e) } : null; },
    set: async (k, v, o) => {
      await Promise.resolve();
      const x = m.get(k);
      if ('onlyIfNew' in o && x) return { modified: false };
      if ('onlyIfMatch' in o && (!x || String(x.e) !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { v, e: ++seq });
      return { modified: true };
    },
    delete: async k => { m.delete(k); },
    list: async () => ({ blobs: [...m.keys()].map(key => ({ key })) }),
  };
}

describe('validation', () => {
  it('ids are 22 url-safe chars (128 bit); tokens 22-64', () => {
    expect(validId(ID)).toBe(true);
    for (const bad of [null, '', 'short', ID + 'x', 'AAAAAAAAAAAAAAAAAAAA/A', '../etc/passwd0000000000', 5]) expect(validId(bad)).toBe(false);
    expect(validToken(TOKEN)).toBe(true);
    for (const bad of [null, 'short', 'x'.repeat(65), 'a b'.repeat(10)]) expect(validToken(bad)).toBe(false);
  });
  it('body: ciphertext <= 96 KB, 16-char iv, integer baseVersion', () => {
    expect(parsePutBody({ ciphertext: 'c'.repeat(MAX_CIPHERTEXT), iv: 'i'.repeat(16), baseVersion: 0 })).not.toBeNull();
    for (const bad of [
      null, [], {}, { ciphertext: 'c'.repeat(MAX_CIPHERTEXT + 1), iv: 'i'.repeat(16), baseVersion: 0 },
      { ciphertext: 'c'.repeat(40), iv: 'short', baseVersion: 0 }, { ciphertext: 'c'.repeat(40), iv: 'i'.repeat(16), baseVersion: 1.5 },
      { ciphertext: 'c'.repeat(40), iv: 'i'.repeat(16), baseVersion: -1 }, { ciphertext: 'not base64!!!!!!!!!!', iv: 'i'.repeat(16), baseVersion: 0 },
    ]) expect(parsePutBody(bad)).toBeNull();
  });
  it('expiry defaults to 30 days and is clamped to 1..90 days', () => {
    expect(Date.parse(computeExpiry(undefined, NOW))).toBe(NOW + 30 * DAY_MS);
    expect(Date.parse(computeExpiry('junk', NOW))).toBe(NOW + 30 * DAY_MS);
    expect(Date.parse(computeExpiry(new Date(NOW + 400 * DAY_MS).toISOString(), NOW))).toBe(NOW + 90 * DAY_MS);
    expect(Date.parse(computeExpiry(new Date(NOW - DAY_MS).toISOString(), NOW))).toBe(NOW + DAY_MS);
    expect(Date.parse(computeExpiry(new Date(NOW + 10 * DAY_MS).toISOString(), NOW))).toBe(NOW + 10 * DAY_MS);
  });
});

describe('create / read / update', () => {
  it('creates, reads back ciphertext only, and stores only the token hash', async () => {
    const s = memory();
    expect((await putGroup(s, ID, TOKEN, body(), NOW)).status).toBe(200);
    const g = await getGroup(s, ID, NOW + 1000);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ ciphertext: 'c'.repeat(40), iv: 'i'.repeat(16), version: 1 });
    const raw = s.m.get(ID)!.v;
    expect(raw).not.toContain(TOKEN);
    expect(raw).toContain(hashToken(TOKEN));
    expect(JSON.stringify(g.body)).not.toContain('writeHash');
  });
  it('404 for unknown, create with a nonzero base is refused, a second create conflicts', async () => {
    const s = memory();
    expect((await getGroup(s, ID, NOW)).status).toBe(404);
    expect((await putGroup(s, ID, TOKEN, body({ baseVersion: 3 }), NOW)).status).toBe(404);
    await putGroup(s, ID, TOKEN, body(), NOW);
    expect((await putGroup(s, ID, TOKEN, body(), NOW)).status).toBe(409);
  });
  it('updates with the right token and version; wrong token is 403', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW);
    expect((await putGroup(s, ID, 'wrongwrongwrongwrongwrong', body({ baseVersion: 1 }), NOW)).status).toBe(403);
    const r = await putGroup(s, ID, TOKEN, body({ baseVersion: 1, ciphertext: 'd'.repeat(40) }), NOW + 5000);
    expect(r).toMatchObject({ status: 200, body: { version: 2 } });
    expect((await getGroup(s, ID, NOW)).body).toMatchObject({ version: 2, ciphertext: 'd'.repeat(40) });
  });
  it('a stale baseVersion is 409', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW);
    await putGroup(s, ID, TOKEN, body({ baseVersion: 1 }), NOW);
    expect(await putGroup(s, ID, TOKEN, body({ baseVersion: 1 }), NOW)).toMatchObject({ status: 409, body: { version: 2 } });
  });
  it('concurrent writers on the same version: exactly one wins (ETag conditional write)', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW);
    const rs = await Promise.all([1, 2, 3, 4].map(n => putGroup(s, ID, TOKEN, body({ baseVersion: 1, ciphertext: String(n).repeat(40) }), NOW)));
    expect(rs.filter(r => r.status === 200)).toHaveLength(1);
    expect(rs.filter(r => r.status === 409)).toHaveLength(3);
    expect(JSON.parse(s.m.get(ID)!.v).version).toBe(2);
  });
  it('concurrent creates: exactly one wins', async () => {
    const s = memory();
    const rs = await Promise.all([1, 2, 3].map(() => putGroup(s, ID, TOKEN, body(), NOW)));
    expect(rs.filter(r => r.status === 200)).toHaveLength(1);
  });
  it('an update without expiresAt keeps the original expiry', async () => {
    const s = memory();
    const first = await putGroup(s, ID, TOKEN, body({ expiresAt: new Date(NOW + 10 * DAY_MS).toISOString() }), NOW, undefined, OWNER);
    const second = await putGroup(s, ID, TOKEN, body({ baseVersion: 1 }), NOW, undefined, OWNER);
    expect((second.body as { expiresAt: string }).expiresAt).toBe((first.body as { expiresAt: string }).expiresAt);
  });
  it('the owner can lengthen the expiry (clamped to 90 days) but never shorten it', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body({ expiresAt: new Date(NOW + 10 * DAY_MS).toISOString() }), NOW, undefined, OWNER);
    const longer = await putGroup(s, ID, TOKEN, body({ baseVersion: 1, expiresAt: new Date(NOW + 40 * DAY_MS).toISOString() }), NOW, undefined, OWNER);
    expect((longer.body as { expiresAt: string }).expiresAt).toBe(new Date(NOW + 40 * DAY_MS).toISOString());
    const shorter = await putGroup(s, ID, TOKEN, body({ baseVersion: 2, expiresAt: new Date(NOW + 20 * DAY_MS).toISOString() }), NOW, undefined, OWNER);
    expect((shorter.body as { expiresAt: string }).expiresAt).toBe(new Date(NOW + 40 * DAY_MS).toISOString());
    const huge = await putGroup(s, ID, TOKEN, body({ baseVersion: 3, expiresAt: new Date(NOW + 400 * DAY_MS).toISOString() }), NOW, undefined, OWNER);
    expect((huge.body as { expiresAt: string }).expiresAt).toBe(new Date(NOW + 90 * DAY_MS).toISOString());
    expect((await getGroup(s, ID, NOW)).body).toMatchObject({ expiresAt: new Date(NOW + 90 * DAY_MS).toISOString() });
  });
  it('a write-token holder without the owner token cannot lengthen a group that has an owner', async () => {
    const s = memory();
    const first = await putGroup(s, ID, TOKEN, body({ expiresAt: new Date(NOW + 10 * DAY_MS).toISOString() }), NOW, undefined, OWNER);
    for (const who of [undefined, 'otherotherotherotherother']) {
      const r = await putGroup(s, ID, TOKEN, body({ baseVersion: JSON.parse(s.m.get(ID)!.v).version as number, expiresAt: new Date(NOW + 80 * DAY_MS).toISOString() }), NOW, undefined, who);
      expect(r.status).toBe(200);
      expect((r.body as { expiresAt: string }).expiresAt).toBe((first.body as { expiresAt: string }).expiresAt);
    }
  });
  it('a group made before owner tokens lets the write token lengthen it', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body({ expiresAt: new Date(NOW + 10 * DAY_MS).toISOString() }), NOW);
    const r = await putGroup(s, ID, TOKEN, body({ baseVersion: 1, expiresAt: new Date(NOW + 50 * DAY_MS).toISOString() }), NOW);
    expect((r.body as { expiresAt: string }).expiresAt).toBe(new Date(NOW + 50 * DAY_MS).toISOString());
  });
  it('stores only the owner token hash', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW, undefined, OWNER);
    expect(s.m.get(ID)!.v).not.toContain(OWNER);
    expect(JSON.parse(s.m.get(ID)!.v).ownerHash).toBe(hashToken(OWNER));
    expect(JSON.stringify((await getGroup(s, ID, NOW)).body)).not.toContain('ownerHash');
  });
});

describe('expiry and deletion', () => {
  it('GET after expiry is 410 and deletes the blob; PUT after expiry is 410 too', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body({ expiresAt: new Date(NOW + 2 * DAY_MS).toISOString() }), NOW);
    expect((await getGroup(s, ID, NOW + DAY_MS)).status).toBe(200);
    expect((await getGroup(s, ID, NOW + 3 * DAY_MS)).status).toBe(410);
    expect(s.m.has(ID)).toBe(false);
    expect((await getGroup(s, ID, NOW + 3 * DAY_MS)).status).toBe(404);
    await putGroup(s, ID, TOKEN, body(), NOW);
    expect((await putGroup(s, ID, TOKEN, body({ baseVersion: 1 }), NOW + 40 * DAY_MS)).status).toBe(410);
  });
  it('DELETE needs the write token', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW);
    expect((await deleteGroup(s, ID, 'wrongwrongwrongwrongwrong')).status).toBe(403);
    expect(s.m.has(ID)).toBe(true);
    expect((await deleteGroup(s, ID, TOKEN)).status).toBe(200);
    expect(s.m.has(ID)).toBe(false);
    expect((await deleteGroup(s, ID, TOKEN)).status).toBe(404);
  });
  it('DELETE on a group with an owner token needs it as well as the write token', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW, undefined, OWNER);
    expect((await deleteGroup(s, ID, TOKEN)).status).toBe(403);
    expect((await deleteGroup(s, ID, TOKEN, 'otherotherotherotherother')).status).toBe(403);
    expect((await deleteGroup(s, ID, 'wrongwrongwrongwrongwrong', OWNER)).status).toBe(403);
    expect(s.m.has(ID)).toBe(true);
    expect((await deleteGroup(s, ID, TOKEN, OWNER)).status).toBe(200);
    expect(s.m.has(ID)).toBe(false);
  });
  it('DELETE on a group made before owner tokens still works with the write token alone', async () => {
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW);
    expect((await deleteGroup(s, ID, TOKEN)).status).toBe(200);
  });
  it('the sweep removes expired and unreadable records, keeps live ones', async () => {
    const s = memory();
    const A = 'BBBBBBBBBBBBBBBBBBBBBB';
    await putGroup(s, ID, TOKEN, body({ expiresAt: new Date(NOW + 2 * DAY_MS).toISOString() }), NOW);
    await putGroup(s, A, TOKEN, body({ expiresAt: new Date(NOW + 60 * DAY_MS).toISOString() }), NOW);
    await s.set('junk', 'not json', { onlyIfNew: true });
    expect(await sweepGroups(s, NOW + 5 * DAY_MS)).toBe(2);
    expect([...s.m.keys()]).toEqual([A]);
  });
  it('the sweep reads at most 8 blobs at once and still visits every one', async () => {
    const s = memory();
    for (let i = 0; i < 30; i++) await s.set(`junk-${i}`, 'not json', { onlyIfNew: true });
    let inFlight = 0;
    let peak = 0;
    const get = s.getWithMetadata;
    s.getWithMetadata = async k => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      try { return await get(k); } finally { inFlight--; }
    };
    expect(await sweepGroups(s, NOW)).toBe(30);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(SWEEP_CONCURRENCY);
    expect(s.m.size).toBe(0);
  });
});

describe('create budget (spend callback)', () => {
  it('is charged once per genuine create, after validation, and not for existing ids', async () => {
    const s = memory();
    let spent = 0;
    const spend = async () => { spent++; return true as const; };
    await putGroup(s, ID, TOKEN, body(), NOW, spend);
    expect(spent).toBe(1);
    // baseVersion 0 against an existing id: conflict, no charge.
    expect((await putGroup(s, ID, TOKEN, body(), NOW, spend)).status).toBe(409);
    // updates and wrong-token attempts: no charge.
    await putGroup(s, ID, TOKEN, body({ baseVersion: 1 }), NOW, spend);
    await putGroup(s, ID, 'wrongwrongwrongwrongwrong', body({ baseVersion: 2 }), NOW, spend);
    // nonzero base for an unknown id: 404, no charge.
    expect((await putGroup(s, 'BBBBBBBBBBBBBBBBBBBBBB', TOKEN, body({ baseVersion: 4 }), NOW, spend)).status).toBe(404);
    expect(spent).toBe(1);
  });
  it('an oversized body is rejected by validation, so nothing is spent (a retry is charged once)', async () => {
    let spent = 0;
    const spend = async () => { spent++; return true as const; };
    expect(parsePutBody({ ciphertext: 'c'.repeat(MAX_CIPHERTEXT + 1), iv: 'i'.repeat(16), baseVersion: 0 })).toBeNull();
    const s = memory();
    await putGroup(s, ID, TOKEN, body(), NOW, spend);
    expect(spent).toBe(1);
  });
  it('over budget is 503 and nothing is stored; a rate-limited caller gets 429', async () => {
    const s = memory();
    expect(await putGroup(s, ID, TOKEN, body(), NOW, async () => false)).toMatchObject({ status: 503, body: { error: 'budget' } });
    expect(s.m.size).toBe(0);
    expect((await putGroup(s, ID, TOKEN, body(), NOW, async () => 'rate-limited')).status).toBe(429);
    expect(s.m.size).toBe(0);
  });
  it('the per-IP create limiter (5 per hour) stops a sixth', () => {
    const allow = makeLimiter(5, 60 * 60_000);
    expect([1, 2, 3, 4, 5, 6].map(() => allow('1.2.3.4', NOW))).toEqual([true, true, true, true, true, false]);
    expect(allow('5.6.7.8', NOW)).toBe(true);
    expect(allow('1.2.3.4', NOW + 61 * 60_000)).toBe(true);
  });
});
