/**
 * Spend and abuse limits shared by the Netlify functions: the per-IP limiter, the
 * daily call budget over a Blobs store, and the env-var parser for the daily limit.
 * No I/O of its own (the store is injected), so it is unit-tested (limits.spec.ts).
 */

const DAY_MS = 86_400_000;

/** Best-effort fixed-window limiter (memory is per function instance). */
export function makeLimiter(max: number, windowMs: number): (key: string, nowMs: number) => boolean {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key, nowMs) => {
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= nowMs) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset <= nowMs) { hits.set(key, { n: 1, reset: nowMs + windowMs }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}

/** A daily limit from an env var: a whole number >= 0; anything else (unset, blank, junk, negative) falls back to `fallback`. */
export function dailyLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Key of the per-day call counter (UTC date). */
export function budgetKey(nowMs: number): string {
  return `calls-${new Date(nowMs).toISOString().slice(0, 10)}`;
}

/** The slice of a Netlify Blobs store the budget needs (conditional writes on an ETag). */
export interface CounterStore {
  getWithMetadata(key: string): Promise<{ data: string; etag?: string } | null>;
  set(key: string, value: string, options: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<{ modified: boolean }>;
}

/**
 * Daily call budget over a key/value store (Netlify Blobs, strong
 * consistency, in production). Race-free: every write is conditional (create
 * only if new, or update only if the ETag read is still current) and retried a
 * few times, so concurrent misses cannot over-spend. A store failure or lost
 * race refuses the call (fails closed).
 */
export function makeBudget(store: CounterStore, limit: number) {
  return async (nowMs: number, calls = 1): Promise<boolean> => {
    try {
      const key = budgetKey(nowMs);
      for (let attempt = 0; attempt < 4; attempt++) {
        const cur = await store.getWithMetadata(key);
        const used = cur ? Number(cur.data) : 0;
        const n = Number.isFinite(used) ? used : 0;
        if (n + calls > limit) return false;
        const r = cur
          ? await store.set(key, String(n + calls), { onlyIfMatch: cur.etag ?? '' })
          : await store.set(key, String(calls), { onlyIfNew: true });
        if (r.modified) return true;
      }
      return false;
    } catch {
      return false;
    }
  };
}

/** How long a finished day's counter is kept before the sweep removes it. */
export const BUDGET_KEEP_DAYS = 7;

/** The slice of a Blobs store the counter cleanup needs. */
export interface CounterSweepStore {
  list(): Promise<{ blobs: { key: string }[] }>;
  delete(key: string): Promise<void>;
}

/** Deletes `calls-YYYY-MM-DD` counters older than 7 days (other keys are left alone). Returns how many were removed. */
export async function sweepBudgetKeys(store: CounterSweepStore, nowMs: number): Promise<number> {
  const { blobs } = await store.list();
  let removed = 0;
  for (const { key } of blobs) {
    const m = /^calls-(\d{4}-\d{2}-\d{2})$/.exec(key);
    const day = m ? Date.parse(`${m[1]}T00:00:00Z`) : NaN;
    if (!Number.isFinite(day) || nowMs - day <= BUDGET_KEEP_DAYS * DAY_MS) continue;
    try { await store.delete(key); removed++; } catch { /* next run */ }
  }
  return removed;
}
