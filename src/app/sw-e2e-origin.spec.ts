import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** ngsw's own isLocalhost(scope) test, taken from the worker the build ships. */
function ngswIsLocalhost(): (scope: string) => boolean {
  const src = read('node_modules/@angular/service-worker/ngsw-worker.js');
  const m = /function isLocalhost\(\w+\) \{\s*return (\/.+\/)\.test\(\w+\);/.exec(src);
  if (!m) throw new Error('isLocalhost not found in ngsw-worker.js');
  const body = m[1];
  const re = new RegExp(body.slice(1, body.lastIndexOf('/')), body.slice(body.lastIndexOf('/') + 1));
  return scope => re.test(scope);
}

function e2eHost(): string {
  const m = /export const E2E_HOST = '([^']+)'/.exec(read('e2e/playwright.config.ts'));
  if (!m) throw new Error('no E2E_HOST in e2e/playwright.config.ts');
  return m[1];
}

describe('service worker vs the e2e origin', () => {
  it('ngsw fully prefetches before answering any fetch on a localhost scope (the smoke-test stall)', () => {
    const src = read('node_modules/@angular/service-worker/ngsw-worker.js');
    // On localhost, scheduleInitialization awaits initializeFully(); every fetch waits on that.
    expect(src).toMatch(/if \(isLocalhost\(this\.scope\.registration\.scope\)\) \{\s*return initialize\(\);/);
    const isLocalhost = ngswIsLocalhost();
    for (const scope of ['http://localhost:4300/', 'http://127.0.0.1:4300/', 'http://[::1]:4300/']) {
      expect(isLocalhost(scope), scope).toBe(true);
    }
    expect(isLocalhost('https://routes.example/')).toBe(false);
  });

  it('runs the smoke tests on a host ngsw treats like production, mapped and trusted in Chromium', () => {
    const host = e2eHost();
    expect(ngswIsLocalhost()(`http://${host}:4300/`)).toBe(false);
    const config = read('e2e/playwright.config.ts');
    expect(config).toContain('baseURL: origin');
    expect(config).toContain('--host-resolver-rules=MAP ${E2E_HOST} 127.0.0.1');
    expect(config).toContain('--unsafely-treat-insecure-origin-as-secure=${origin}');
  });
});
