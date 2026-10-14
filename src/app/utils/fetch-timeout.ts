/** Timeout for small JSON files and API calls. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Timeout for the big data files (schedules, route network, cities). */
export const FETCH_TIMEOUT_BIG_MS = 20_000;

/**
 * fetch() that gives up after `ms`. The signal covers reading the body too, so
 * a stalled connection rejects (like a network error) instead of hanging.
 */
export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const t = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, t]) : t;
  return fetch(input, { ...init, signal });
}

/** True for an abort or timeout rejection (a body read cut off by the signal looks like bad JSON otherwise). */
export function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
