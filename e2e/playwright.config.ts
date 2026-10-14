import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const port = Number(process.env['E2E_PORT'] ?? 4300);
// Not localhost: on a localhost scope Angular's service worker prefetches every
// asset group (all lazy chunks, schedules, vendor) BEFORE it answers any fetch,
// so the first lazy route after a fresh load waited 2-5 s for the install and
// raced the 5 s expect timeout. Any other host gets production behaviour
// (prefetch when idle, fetches served meanwhile). The browser maps this name to
// 127.0.0.1 and treats it as a secure origin so the worker still registers.
export const E2E_HOST = 'routes.test';
const origin = `http://${E2E_HOST}:${port}`;
const args = [`--host-resolver-rules=MAP ${E2E_HOST} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${origin}`];
// Locally the preinstalled Chromium may not match this Playwright's build.
const local = '/opt/pw-browsers/chromium';
const executablePath = process.env['CI'] || !existsSync(local) ? undefined : local;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: origin,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args } } }],
  // Serves a prior `ng build` (dist/ac-explorer/browser) with Netlify's headers.
  webServer: {
    command: 'node static-server.mjs',
    url: `http://localhost:${port}/manifest.webmanifest`,
    reuseExistingServer: !process.env['CI'],
    env: { E2E_PORT: String(port) },
  },
});
