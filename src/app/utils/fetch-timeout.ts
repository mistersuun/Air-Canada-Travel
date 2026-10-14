/** How long the response headers may take, for small JSON files and API calls. */
export const FETCH_TIMEOUT_MS = 10_000;
/** The same for the big data files (schedules, route network, cities). */
export const FETCH_TIMEOUT_BIG_MS = 20_000;
/** The body may take as long as it likes, as long as a chunk arrives at least this often. */
export const FETCH_STALL_MS = 15_000;

function timeoutError(): DOMException {
  return new DOMException('The operation timed out.', 'TimeoutError');
}

/**
 * fetch() that gives up when the headers take longer than `headersMs`, and
 * when the body then goes `FETCH_STALL_MS` without a single chunk. A slow but
 * moving download (a 216 KB schedule file on a poor link) is never cut off by
 * a total deadline. A timeout rejects like a network error, from fetch() itself or
 * from reading the body (res.json() etc.), so callers treat it as retryable.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL, init: RequestInit = {}, headersMs: number = FETCH_TIMEOUT_MS, stallMs: number = FETCH_STALL_MS,
): Promise<Response> {
  const ctl = new AbortController();
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) ctl.abort(outer.reason);
    else outer.addEventListener('abort', () => ctl.abort(outer.reason), { once: true });
  }
  const headerTimer = setTimeout(() => ctl.abort(timeoutError()), headersMs);
  let res: Response;
  try {
    res = await fetch(input, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(headerTimer);
  }
  if (!res.body) return res;

  const reader = res.body.getReader();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const guarded = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // The watchdog runs only while we wait on the network, not while the consumer is busy.
      stallTimer = setTimeout(() => ctl.abort(timeoutError()), stallMs);
      try {
        const { done, value } = await reader.read();
        clearTimeout(stallTimer);
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        clearTimeout(stallTimer);
        controller.error(e);
      }
    },
    cancel(reason) {
      clearTimeout(stallTimer);
      return reader.cancel(reason);
    },
  });
  return new Response(guarded, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** True for an abort or timeout rejection (a body read cut off by the watchdog looks like bad JSON otherwise). */
export function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
