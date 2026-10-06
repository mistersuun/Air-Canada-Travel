// Tiny static server for the e2e suite: serves dist/ac-explorer/browser the way
// Netlify does (SPA fallback from public/_redirects, [[headers]] from
// netlify.toml) so CSP violations show up in tests. No dependencies.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist/ac-explorer/browser');
const port = Number(process.env.E2E_PORT ?? 4300);

/** Minimal [[headers]] parser (single-line key = "value" pairs only, no multi-line TOML): `for = "..."` plus key = "value" lines under [headers.values]. */
export function parseNetlifyHeaders(toml) {
  const rules = [];
  let cur = null;
  let inValues = false;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '[[headers]]') { cur = { for: '', values: {} }; rules.push(cur); inValues = false; continue; }
    if (line === '[headers.values]') { inValues = true; continue; }
    if (line.startsWith('[')) { cur = null; inValues = false; continue; }
    if (!cur || !line || line.startsWith('#')) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (!m) continue;
    if (inValues) cur.values[m[1]] = m[2]; else if (m[1] === 'for') cur.for = m[2];
  }
  return rules;
}

function matches(pattern, path) {
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(path);
}

const rules = parseNetlifyHeaders(readFileSync(join(root, 'netlify.toml'), 'utf8'));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  // Netlify Functions are not served here: a plain 404, like any host without functions.
  if (path.startsWith('/.netlify/functions/')) { res.writeHead(404).end('Not found'); return; }
  let file = normalize(join(dist, path));
  if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // public/_redirects is `/* /index.html 200`: SPA fallback for extension-less paths.
    // Deliberate difference from Netlify: a missing file WITH an extension is a 404 here,
    // so a broken asset reference fails loudly instead of returning index.html.
    if (extname(path) && path !== '/') { res.writeHead(404).end('Not found'); return; }
    path = '/index.html';
    file = join(dist, 'index.html');
  }
  const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' };
  for (const r of rules) if (matches(r.for, path)) Object.assign(headers, r.values);
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}

createServer((req, res) => {
  try {
    handle(req, res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
    console.error(e);
  }
}).listen(port, () => console.log(`e2e server on http://localhost:${port}`));
