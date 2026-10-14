/** Small helpers shared by the Netlify functions: the JSON response and the plain-object guard. */

export type Rec = Record<string, unknown>;

export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A JSON response, not cached by the browser unless `headers` says otherwise
 * (extra headers win, so a function can set its own Cache-Control and CDN headers).
 */
export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
