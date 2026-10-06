import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const port = Number(process.env['E2E_PORT'] ?? 4300);
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
    baseURL: `http://localhost:${port}`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  // Serves a prior `ng build` (dist/ac-explorer/browser) with Netlify's headers.
  webServer: {
    command: 'node static-server.mjs',
    url: `http://localhost:${port}/manifest.webmanifest`,
    reuseExistingServer: !process.env['CI'],
    env: { E2E_PORT: String(port) },
  },
});
