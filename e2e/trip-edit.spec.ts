import { expect, test, type Page } from '@playwright/test';
import { seedOnboarded, watchErrors } from './helpers';

// Trip editing and multi-stop trips. Dates are relative to "now" and the page clock is pinned to midday in
// Toronto on the day the test runs (same approach as day-of.spec.ts), so nothing depends on the time of day.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function localAt(ms: number, tz: string): { dateKey: string; hhmm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { dateKey: `${p['year']}-${p['month']}-${p['day']}`, hhmm: `${p['hour']}:${p['minute']}` };
}

const SEVILLE = { id: 'gn-2510911', name: 'Seville', country: 'Spain', iso2: 'ES', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid', admin1: 'Andalusia' };

async function pinNoon(page: Page): Promise<number> {
  const noon = Date.parse(`${localAt(Date.now(), 'America/Toronto').dateKey}T16:00:00Z`);
  await page.clock.install({ time: noon });
  return noon;
}

/** A Seville trip a week out: AC834 into Madrid and the train on to Seville, home by day 12. */
function sevilleTrip(id: string, now: number): Record<string, unknown> {
  const out = localAt(now + 7 * DAY, 'America/Toronto');
  const arr = localAt(now + 7 * DAY + 7 * HOUR, 'Europe/Madrid');
  return {
    v: 1, id, name: 'Seville trip', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    goal: SEVILLE, party: { count: 1, stayTogether: false, splitNote: '' },
    fromHub: 'YUL', homeAirport: 'YUL', outboundDate: out.dateKey,
    homeBy: { dateKey: localAt(now + 12 * DAY, 'America/Toronto').dateKey, hhmm: '22:00' },
    legs: [
      {
        kind: 'flight', id: 'leg-out', role: 'outbound', status: 'planned', statusAt: null, note: '', provenance: 'scheduled', alternates: [],
        refs: [{ flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: out.dateKey, depLocal: out.hhmm, arrLocal: arr.hhmm, arrDateKey: arr.dateKey, aircraft: '333' }],
      },
      {
        kind: 'ground', id: 'leg-train', status: 'planned', statusAt: null, note: '', mode: 'train',
        from: { name: 'Madrid', code: 'MAD', lat: 40.47, lng: -3.57, tz: 'Europe/Madrid' },
        to: { name: 'Seville', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid' },
        dateKey: arr.dateKey, estMinutes: 250, provenance: 'estimated', userTimes: null,
      },
    ],
    prep: {}, customPrep: [], changes: [], scheduleGeneratedAt: null, offlineSavedAt: null,
    calendarExportedAt: null, sharedFrom: null, archived: false,
  };
}

async function seedTrip(page: Page, trip: Record<string, unknown>): Promise<void> {
  await page.addInitScript(t => {
    try {
      // Only the first load: a reload must see what the page itself saved.
      if (!localStorage.getItem('ac.trips.v1')) localStorage.setItem('ac.trips.v1', JSON.stringify({ schema: 1, trips: [t] }));
    } catch {
      // Storage blocked: the test fails on its own assertions.
    }
  }, trip);
}

test('+ New trip: an Air Canada city opens its destination page, any other place goes through Reach, and both start a trip', async ({ page }) => {
  await seedOnboarded(page);
  await pinNoon(page);
  const problems = await watchErrors(page);
  await page.goto('/trips');
  // Always visible, also with no trips; Saved and Logbook are one tap away.
  await expect(page.getByRole('link', { name: 'Saved', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Logbook', exact: true })).toBeVisible();

  // A city Air Canada flies to: its destination page has "Start a trip".
  await page.getByRole('button', { name: '+ New trip' }).click();
  await page.locator('[data-place-search]').fill('Lisbon');
  await page.locator('[data-place="ac-LIS"]').click();
  await expect(page).toHaveURL(/\/to\/LIS/);
  await page.getByRole('button', { name: /^Start a trip to Lisbon/ }).click();
  await page.goto('/trips');
  await expect(page.getByText('No trips yet')).toHaveCount(0);
  await expect(page.locator('.tc__name').first()).toContainText('Lisbon');

  // A city it does not fly to: the Reach flow, then "Start this trip".
  await page.getByRole('button', { name: '+ New trip' }).click();
  await page.locator('[data-place-search]').fill('Seville');
  await page.locator('[data-place="gn-2510911"]').click();
  await expect(page).toHaveURL(/\/reach\/gn-2510911/);
  await page.locator('a[href^="/reach/gn-2510911/"]').first().click();
  await page.getByRole('button', { name: 'Start this trip' }).click();
  await expect(page).toHaveURL(/\/trips\/(?!import)[^/?]+/);
  await page.goto('/trips');
  await expect(page.locator('.tc__name', { hasText: 'Seville' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New trip' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('edit: rename, add a ground leg, remove a leg and Undo it', async ({ page }) => {
  await seedOnboarded(page);
  const now = await pinNoon(page);
  await seedTrip(page, sevilleTrip('e2eedit1', now));
  const problems = await watchErrors(page);
  await page.goto('/trips/e2eedit1');
  await expect(page.getByRole('heading', { name: 'Seville trip', level: 1 })).toBeVisible();
  await page.locator('[data-edit-toggle]').click();

  // Rename.
  await page.locator('[data-name]').fill('Andalusia in spring');
  await page.locator('[data-name-save]').click();
  await expect(page.getByRole('heading', { name: 'Andalusia in spring', level: 1 })).toBeVisible();

  // Add a ground leg Seville -> Madrid by bus, with both times.
  const day = localAt(now + 10 * DAY, 'Europe/Madrid').dateKey;
  await page.locator('[data-leg-open]').click();
  await page.locator('[data-kind-ground]').click();
  await page.locator('[data-from]').selectOption({ label: 'Seville' });
  await page.locator('[data-to]').selectOption({ label: 'Madrid (MAD)' });
  await page.locator('[data-leg-date]').fill(day);
  await page.locator('[data-mode]').selectOption('bus');
  await page.locator('[data-dep-time]').fill('09:00');
  await page.locator('[data-arr-time]').fill('14:00');
  await page.locator('[data-ground-add]').click();
  await expect(page.locator('[data-leg-edit]')).toHaveCount(3);
  await expect(page.locator('app-trip-card .tl__it', { hasText: 'Seville → Madrid' })).toBeVisible();

  // Remove it, then Undo from the toast.
  await page.locator('[data-leg-edit]', { hasText: 'Seville → Madrid' }).locator('[data-leg-remove]').click();
  await expect(page.locator('[data-leg-edit]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-leg-edit]')).toHaveCount(3);

  // It all survives a reload (the seed is only written once).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Andalusia in spring', level: 1 })).toBeVisible();
  await expect(page.locator('app-trip-card .tl__it', { hasText: 'Seville → Madrid' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('add a stop: the Return tab plans home from the last stop', async ({ page }) => {
  await seedOnboarded(page);
  const now = await pinNoon(page);
  await seedTrip(page, sevilleTrip('e2estop1', now));
  const problems = await watchErrors(page);
  await page.goto('/trips/e2estop1?tab=return');
  // One stop: home is planned from the airport you flew into.
  await expect(page.locator('[data-context]')).toContainText('from Madrid');

  await page.goto('/trips/e2estop1');
  await page.locator('[data-edit-toggle]').click();
  await page.locator('[data-stop-open]').click();
  await page.locator('[data-place-search]').fill('Lisbon');
  await page.locator('[data-place="ac-LIS"]').click();
  await page.locator('[data-stop-date]').fill(localAt(now + 10 * DAY, 'Europe/Lisbon').dateKey);
  await page.locator('[data-stop-add]').click();
  await expect(page.locator('[data-stop]')).toHaveCount(2);
  // The way there is offered as a ground leg from Seville; add it.
  await expect(page.locator('[data-from]')).toHaveValue(/^place:gn-2510911$/);
  await page.locator('[data-ground-add]').click();
  await expect(page.locator('[data-stops-line]')).toHaveText('Seville → Lisbon');
  await page.locator('[data-edit-toggle]').click();

  await page.getByRole('group', { name: 'Trip sections' }).getByRole('button', { name: 'Return' }).click();
  await expect(page).toHaveURL(/tab=return/);
  await expect(page.locator('[data-context]')).toContainText('from Lisbon');
  expect(problems).toEqual([]);
});
