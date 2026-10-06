import { expect, test } from '@playwright/test';
import { openFirstDestination, seedOnboarded, startTripFromFlight, waitForServiceWorker, watchErrors } from './helpers';

test('app boots with no console errors or CSP violations', async ({ page }) => {
  await seedOnboarded(page);
  const problems = await watchErrors(page);
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy'], 'CSP header served').toContain("default-src 'self'");
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('a[href^="/to/"]').first()).toBeVisible();
  for (const path of ['/map', '/trips', '/calendar', '/profile']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('home lists destinations and a destination shows flights', async ({ page }) => {
  await seedOnboarded(page);
  const problems = await watchErrors(page);
  const dest = await openFirstDestination(page);
  expect(dest).toMatch(/^\/to\/[A-Z]{3}$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('a[href^="/flight/"]').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('a trip created from a flight survives a reload', async ({ page }) => {
  await seedOnboarded(page);
  const problems = await watchErrors(page);
  const tripPath = await startTripFromFlight(page);
  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: 'Trips', level: 1 })).toBeVisible();
  await expect(page.locator(`a[href^="${tripPath}"]`).first()).toBeVisible();
  await page.reload();
  await expect(page.locator(`a[href^="${tripPath}"]`).first()).toBeVisible();
  await expect(page.getByText('No trips yet')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('first run shows the setup sheet once; Skip closes it and a reload does not bring it back', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Welcome' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Skip' }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome' })).toHaveCount(0);
});

test('works offline after the service worker takes control', async ({ page, context }) => {
  await seedOnboarded(page);
  await page.goto('/');
  await waitForServiceWorker(page);
  // The prefetch groups (app shell, schedules, vendor) must be fully cached before going offline.
  await expect.poll(() => page.evaluate(async () => {
    const sizes: Record<string, number> = {};
    for (const k of await caches.keys()) {
      const m = /:assets:(app|schedules|vendor):cache$/.exec(k);
      if (m) sizes[m[1]] = (await (await caches.open(k)).keys()).length;
    }
    return !!sizes['app'] && sizes['schedules'] >= 3 && !!sizes['vendor'];
  }), { timeout: 45_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  // Schedules still render: destinations are listed from the cached schedules.json.
  await expect(page.locator('a[href^="/to/"]').first()).toBeVisible();
  await page.locator('a[href^="/to/"]').first().click();
  await expect(page.locator('a[href^="/flight/"]').first()).toBeVisible();
  await context.setOffline(false);
});

test('share link round trip: copy link, open in a fresh browser, save', async ({ page, browser, context }) => {
  await seedOnboarded(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const tripPath = await startTripFromFlight(page);
  await expect(page).toHaveURL(new RegExp(tripPath));
  await page.getByRole('button', { name: 'Share and offline' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('/trips/import#t=');

  // A different person: new context, empty storage.
  const other = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const p2 = await other.newPage();
    await seedOnboarded(p2);
    const problems = await watchErrors(p2);
    const url = new URL(link);
    await p2.goto(url.pathname + url.hash);
    await expect(p2.getByRole('heading', { name: 'Shared plan' })).toBeVisible();
    await p2.getByRole('button', { name: 'Save to my trips' }).click();
    await expect(p2).toHaveURL(/\/trips\/(?!import)[^/?]+/);
    await expect(p2.getByText(/copy of a shared plan/i)).toBeVisible();
    expect(problems).toEqual([]);
  } finally {
    await other.close();
  }
});

test('a share POST is caught by the service worker and lands on /share-in', async ({ page }) => {
  await seedOnboarded(page);
  await page.goto('/');
  await waitForServiceWorker(page);
  await page.evaluate(() => {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = '/share-in';
    f.enctype = 'multipart/form-data';
    for (const [k, v] of [['title', 'Hotel'], ['text', 'Room 12, late check-in']]) {
      const i = document.createElement('input');
      i.name = k;
      i.value = v;
      f.appendChild(i);
    }
    document.body.appendChild(f);
    f.submit();
  });
  await expect(page).toHaveURL(/\/share-in\?id=[a-z0-9]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add to a trip' })).toBeVisible();
  // No trips yet: the page says so, and the temporary copy is already deleted.
  await expect(page.locator('[data-no-trips]')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('ac-share-in')).keys()).length)).toBe(0);
});
