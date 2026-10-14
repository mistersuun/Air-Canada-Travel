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

test.describe('on a French device', () => {
  test.use({ locale: 'fr-CA' });

  test('Automatic follows the device language', async ({ page }) => {
    await seedOnboarded(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sans escale cette semaine' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  });
});
