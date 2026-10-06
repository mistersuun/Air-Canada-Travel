import { expect, type Page } from '@playwright/test';

/** Collects console errors, page errors and CSP violations for the lifetime of a page. */
export async function watchErrors(page: Page): Promise<string[]> {
  const problems: string[] = [];
  // The forecast API is off-site: answer it locally so a missing network cannot log a failed load.
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  page.on('console', m => {
    // The static server has no Netlify Functions, so the optional live-status request 404s and the browser
    // itself logs "Failed to load resource"; and with no network the service worker answers the forecast
    // request with a 504. The app hides both without a word, so only those expected load failures are ignored.
    const url = m.location().url;
    if (m.type() === 'error' && !url.includes('/.netlify/functions/') && !url.startsWith('https://api.open-meteo.com/')) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return problems;
}

/** Marks first-run setup as done before the first navigation, so its modal sheet stays out of the way. */
export async function seedOnboarded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ac.onboarded.v1', '1');
    } catch {
      // Storage blocked: the sheet does not show then either.
    }
  });
}

/** Opens the first destination in the home list and returns its path (e.g. /to/AMS). */
export async function openFirstDestination(page: Page): Promise<string> {
  await page.goto('/');
  const link = page.locator('a[href^="/to/"]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!.split('?')[0];
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`));
  return href;
}

/** Opens a destination, picks its first flight and starts a trip from it. Returns the trip path. */
export async function startTripFromFlight(page: Page): Promise<string> {
  await openFirstDestination(page);
  const flight = page.locator('a[href^="/flight/"]').first();
  await expect(flight).toBeVisible();
  await flight.click();
  await expect(page).toHaveURL(/\/flight\//);
  await page.getByRole('button', { name: /^Start a trip$/ }).click();
  await expect(page).toHaveURL(/\/trips\/(?!import)[^/?]+/);
  return new URL(page.url()).pathname;
}

/** Waits until the service worker controls the page (needed before going offline). */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
}
