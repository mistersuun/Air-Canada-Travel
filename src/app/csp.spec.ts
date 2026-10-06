import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

function csp(): string {
  const m = /Content-Security-Policy = "([^"]+)"/.exec(read('netlify.toml'));
  if (!m) throw new Error('no CSP in netlify.toml');
  return m[1];
}

describe('Content-Security-Policy (netlify.toml)', () => {
  it('allows every inline script in index.html by hash, and nothing inline otherwise', () => {
    const policy = csp();
    const scripts = [...read('src/index.html').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(policy, 'update the hash after editing the inline script').toContain(sha(s));
    // Angular's critical-CSS loader: <link media="print" onload="this.media='all'">
    expect(policy).toContain(sha("this.media='all'"));
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it('lets the page reach the forecast API and nothing else off-site except fonts', () => {
    const connect = /connect-src ([^;]+)/.exec(csp())![1].split(' ');
    expect(connect).toContain('https://api.open-meteo.com');
    expect(connect.filter(s => s.startsWith('https://')).sort()).toEqual([
      'https://api.open-meteo.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com',
    ]);
  });

  it('does not block geolocation (the nearest-hub button asks on tap)', () => {
    const toml = read('netlify.toml');
    expect(toml).not.toMatch(/geolocation=\(\)/);
  });

  it('cannot be framed and loads no plugins', () => {
    const policy = csp();
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });
});

describe('custom service worker (public/sw.js)', () => {
  it('is registered by app.config, wraps ngsw-worker.js and always revalidates', () => {
    expect(read('src/app/app.config.ts')).toContain("provideServiceWorker('sw.js'");
    expect(read('public/sw.js')).toContain("importScripts('./ngsw-worker.js')");
    expect(read('netlify.toml')).toMatch(/for = "\/sw\.js"\s+\[headers\.values\]\s+Cache-Control = "no-cache"/);
    // same-origin script: covered by worker-src 'self'
    expect(csp()).toMatch(/worker-src 'self'/);
  });

  it('declares a share target and file handlers that point at /share-in', () => {
    const m = JSON.parse(read('public/manifest.webmanifest'));
    expect(m.share_target).toMatchObject({ action: '/share-in', method: 'POST', enctype: 'multipart/form-data' });
    expect(m.file_handlers[0].action).toBe('/share-in');
    expect(Object.keys(m.file_handlers[0].accept)).toEqual(expect.arrayContaining(['application/pdf', 'text/calendar']));
  });
});

describe('service worker (ngsw-config.json)', () => {
  it('prefetches the barcode reader wasm and the pdf.js worker, so passes can be added offline', () => {
    const cfg = JSON.parse(read('ngsw-config.json')) as { assetGroups: { name: string; installMode: string; resources: { files: string[] } }[] };
    const vendor = cfg.assetGroups.find(g => g.resources.files.some(f => f.includes('zxing')))!;
    expect(vendor.installMode).toBe('prefetch');
    expect(vendor.resources.files).toEqual(expect.arrayContaining(['/vendor/zxing/*.wasm', '/vendor/pdfjs/*.mjs']));
  });

  it('never caches the live flight-status endpoint, and CSP connect-src self covers it', () => {
    const cfg = JSON.parse(read('ngsw-config.json')) as { dataGroups?: { urls: string[] }[] };
    const urls = (cfg.dataGroups ?? []).flatMap(g => g.urls);
    expect(urls.filter(u => u.includes('netlify') || u === '/**' || u === '/*')).toEqual([]);
    expect(csp()).toMatch(/connect-src 'self'/);
  });

  it('keeps the last forecast for offline: freshness strategy, short maxAge', () => {
    const cfg = JSON.parse(read('ngsw-config.json')) as { dataGroups: { name: string; urls: string[]; cacheConfig: { strategy: string; maxAge: string; timeout: string } }[] };
    const g = cfg.dataGroups.find(d => d.urls.some(u => u.startsWith('https://api.open-meteo.com/')))!;
    expect(g.cacheConfig).toMatchObject({ strategy: 'freshness', maxAge: '3h', timeout: '3s' });
  });
});
