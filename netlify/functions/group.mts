// Group trip links: an end-to-end encrypted shared plan. The server stores only
// ciphertext (AES-GCM, key in the link's URL fragment, never sent here) and a
// sha256 of the write token. No accounts, no logging of bodies or headers.
//   GET    ?id=            -> {ciphertext, iv, version, updatedAt, expiresAt}   (404 / 410)
//   PUT    ?id=  X-Group-Write  {ciphertext, iv, baseVersion, expiresAt?}      (409 on conflict)
//   (creating a group also spends from the GROUP_DAILY_CREATES budget: 503 {error:'budget'})
//   DELETE ?id=  X-Group-Write                                                  ("Stop sharing")
import { getStore } from '@netlify/blobs';
import { makeBudget, makeLimiter } from './lib/flight-status.ts';
import { MAX_CIPHERTEXT, deleteGroup, groupDailyCreates, getGroup, parsePutBody, putGroup, validId, validToken, type GroupStore } from './lib/group.ts';

// Writes only (create, update, delete): 30 per IP per 10 minutes.
const allowWrite = makeLimiter(30, 10 * 60_000);

// New groups: 5 per IP per hour, so one address cannot use up the global daily budget.
const allowCreate = makeLimiter(5, 60 * 60_000);

// Reads: a looser per-IP limit (several companions can share one network; the app polls every 2 minutes).
const allowRead = makeLimiter(300, 10 * 60_000);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req: Request, context: { ip?: string }): Promise<Response> => {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  const method = req.method;
  if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') return json({ error: 'method' }, 405);

  const id = new URL(req.url).searchParams.get('id');
  if (!validId(id)) return json({ error: 'bad-request' }, 400);
  const now = Date.now();

  let token = '';
  if (method === 'GET') {
    if (!allowRead(context.ip || 'unknown', now)) return json({ error: 'rate-limited' }, 429);
  } else {
    const t = req.headers.get('x-group-write');
    if (!validToken(t)) return json({ error: 'forbidden' }, 403);
    token = t;
    if (!allowWrite(context.ip || 'unknown', now)) return json({ error: 'rate-limited' }, 429);
  }

  let store: GroupStore;
  try {
    store = getStore({ name: 'groups', consistency: 'strong' }) as unknown as GroupStore;
  } catch {
    return json({ error: 'unavailable' }, 503);
  }

  try {
    if (method === 'GET') {
      const r = await getGroup(store, id, now);
      return json(r.body, r.status);
    }
    if (method === 'DELETE') {
      const r = await deleteGroup(store, id, token);
      return json(r.body, r.status);
    }
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_CIPHERTEXT + 2048) return json({ error: 'too-large' }, 413);
    const text = await req.text();
    if (text.length > MAX_CIPHERTEXT + 2048) return json({ error: 'too-large' }, 413);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return json({ error: 'bad-request' }, 400); }
    const body = parsePutBody(raw);
    if (!body) return json({ error: 'bad-request' }, 400);
    // Only a genuine create spends: 5 per IP per hour, then the global daily budget (see putGroup).
    const spend = async (): Promise<boolean | 'rate-limited'> => {
      if (!allowCreate(context.ip || 'unknown', now)) return 'rate-limited';
      try {
        return await makeBudget(getStore({ name: 'groups-budget', consistency: 'strong' }), groupDailyCreates(process.env['GROUP_DAILY_CREATES']))(now);
      } catch {
        return false;
      }
    };
    const r = await putGroup(store, id, token, body, now, spend);
    return json(r.body, r.status);
  } catch (e) {
    console.error('group failure:', e instanceof Error ? e.name : 'unknown');
    return json({ error: 'unavailable' }, 503);
  }
};
