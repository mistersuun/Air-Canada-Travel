import { expect, test } from '@playwright/test';
import { seedOnboarded, watchErrors } from './helpers';

test('Settings switches the app to Français, live and after a reload', async ({ page }) => {
  await seedOnboarded(page);
  const problems = await watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nonstop this week' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Settings' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await sheet.locator('app-seg[data-setting="language"] button', { hasText: 'Français' }).click();
  await expect(page.getByRole('dialog', { name: 'Paramètres' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Paramètres' }).getByRole('button', { name: 'Terminé' }).click();

  await expect(page.getByRole('heading', { name: 'Sans escale cette semaine' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Au départ de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  await expect(page.getByRole('link', { name: 'Explorer' }).first()).toBeVisible();
  await expect(page).toHaveTitle('Routes');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sans escale cette semaine' })).toBeVisible();
  await page.goto('/map');
  await expect(page).toHaveTitle('Carte · Routes');
  expect(problems).toEqual([]);
});

test('the tab title follows a language switch on /map without a reload', async ({ page }) => {
  await seedOnboarded(page);
  const problems = await watchErrors(page);
  await page.goto('/map');
  await expect(page).toHaveTitle('Map · Routes');
  // A reload would lose this marker.
  await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__noReload'] = true));

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('dialog', { name: 'Settings' }).locator('app-seg[data-setting="language"] button', { hasText: 'Français' }).click();
  await expect(page).toHaveTitle('Carte · Routes');

  const sheet = page.getByRole('dialog', { name: 'Paramètres' });
  await sheet.locator('app-seg[data-setting="language"] button', { hasText: 'English' }).click();
  await expect(page).toHaveTitle('Map · Routes');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__noReload'])).toBe(true);
  expect(problems).toEqual([]);
});

test.describe('on a French device', () => {
  test.use({ locale: 'fr-CA' });

  test('Automatic follows the device language', async ({ page }) => {
    await seedOnboarded(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sans escale cette semaine' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');

    await page.getByRole('button', { name: 'Paramètres' }).first().click();
    const seg = page.getByRole('dialog', { name: 'Paramètres' }).locator('app-seg[data-setting="language"]');
    await expect(seg.getByRole('button', { name: 'Automatique' })).toHaveAttribute('aria-pressed', 'true');
    await expect(seg.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'false');
  });
});
