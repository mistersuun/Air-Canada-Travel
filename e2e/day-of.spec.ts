import { expect, test, type Page } from '@playwright/test';
import { seedOnboarded, watchErrors } from './helpers';

// Day-of flows on a seeded trip. Dates are relative to "now", and the page clock is pinned to midday in
// Toronto on the day the test runs, so nothing here depends on the time of day (or crosses midnight).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** {dateKey, hhmm} of an instant, local in `tz`. */
function localAt(ms: number, tz: string): { dateKey: string; hhmm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { dateKey: `${p['year']}-${p['month']}-${p['day']}`, hhmm: `${p['hour']}:${p['minute']}` };
}

const SEVILLE = { id: 'gn-2510911', name: 'Seville', country: 'Spain', iso2: 'ES', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid', admin1: 'Andalusia' };

function baseTrip(id: string, homeByMs: number): Record<string, unknown> {
  const homeBy = localAt(homeByMs, 'America/Toronto');
  return {
    v: 1, id, name: 'Seville trip', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    goal: SEVILLE, party: { count: 1, stayTogether: false, splitNote: '' },
    fromHub: 'YUL', homeAirport: 'YUL', outboundDate: '2026-01-01', homeBy,
    legs: [], prep: {}, customPrep: [], changes: [], scheduleGeneratedAt: null, offlineSavedAt: null,
    calendarExportedAt: null, sharedFrom: null, archived: false,
  };
}

function flightLeg(id: string, role: 'outbound' | 'return', status: string, origin: string, dest: string, number: string, depMs: number, tz: string) {
  const dep = localAt(depMs, tz);
  const arr = localAt(depMs + 7 * HOUR, 'Europe/Madrid');
  return {
    kind: 'flight', id, role, status, statusAt: null, note: '', provenance: 'scheduled', alternates: [],
    refs: [{ flightNumber: number, origin, dest, dateKey: dep.dateKey, depLocal: dep.hhmm, arrLocal: arr.hhmm, arrDateKey: arr.dateKey, aircraft: '333' }],
  };
}

/** Pins the page clock to midday at Montréal on today's date there; returns that instant. */
async function pinNoon(page: Page): Promise<number> {
  const noon = Date.parse(`${localAt(Date.now(), 'America/Toronto').dateKey}T16:00:00Z`);
  await page.clock.install({ time: noon });
  return noon;
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

test('Today: a flight leaving in 20 minutes, "I didn\'t board" opens Still reachable with options', async ({ page }) => {
  await seedOnboarded(page);
  const now = await pinNoon(page);
  const trip = baseTrip('e2eflight1', now + 5 * DAY);
  trip['legs'] = [flightLeg('leg-out', 'outbound', 'listed', 'YUL', 'MAD', 'AC834', now + 3 * HOUR, 'America/Toronto')];
  await seedTrip(page, trip);
  const problems = await watchErrors(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Montréal → Madrid');
  await expect(page.getByText('AC834').first()).toBeVisible();
  await page.getByRole('button', { name: "I didn't board" }).click();
  await expect(page).toHaveURL(/\/trips\/e2eflight1\/recover/);
  await expect(page.getByRole('heading', { name: 'Still reachable', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tonight' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tomorrow' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('Today: a train leg planned for today is shown, and "I made it" marks it done', async ({ page }) => {
  await seedOnboarded(page);
  const now = await pinNoon(page);
  const trip = baseTrip('e2eground1', now + 5 * DAY);
  const today = localAt(now, 'Europe/Madrid').dateKey;
  trip['legs'] = [
    flightLeg('leg-out', 'outbound', 'boarded', 'YUL', 'MAD', 'AC834', now - 20 * HOUR, 'America/Toronto'),
    {
      kind: 'ground', id: 'leg-train', status: 'planned', statusAt: null, note: '', mode: 'train',
      from: { name: 'Madrid', code: 'MAD', lat: 40.47, lng: -3.57, tz: 'Europe/Madrid' },
      to: { name: 'Seville', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid' },
      dateKey: today, estMinutes: 250, provenance: 'estimated', userTimes: null,
    },
  ];
  await seedTrip(page, trip);
  const problems = await watchErrors(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Madrid → Seville');
  await expect(page.locator('[data-ground]')).toContainText('Train');
  await expect(page.getByRole('button', { name: 'I made it' })).toBeVisible();
  await expect(page.getByText('Nothing planned today')).toHaveCount(0);
  await page.getByRole('button', { name: 'I made it' }).click();
  await expect(page.locator('[data-final]')).toContainText('marked done');
  // Undo puts it back; marking again survives a reload.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'I made it' })).toBeVisible();
  await page.getByRole('button', { name: 'I made it' }).click();
  await expect(page.locator('[data-final]')).toContainText('marked done');
  await page.reload();
  await expect(page.locator('[data-final]')).toContainText('marked done');
  expect(problems).toEqual([]);
});

test('Today: a trip day with nothing scheduled shows the day, the way home and a link to the trip', async ({ page }) => {
  await seedOnboarded(page);
  const now = await pinNoon(page);
  const trip = baseTrip('e2emid0001', now + 5 * DAY);
  trip['legs'] = [
    flightLeg('leg-out', 'outbound', 'boarded', 'YUL', 'MAD', 'AC834', now - 2 * DAY, 'America/Toronto'),
    flightLeg('leg-ret', 'return', 'planned', 'MAD', 'YUL', 'AC835', now + 4 * DAY, 'Europe/Madrid'),
  ];
  await seedTrip(page, trip);
  const problems = await watchErrors(page);
  await page.goto('/today');
  await expect(page.locator('[data-midtrip]')).toContainText('in Seville');
  await expect(page.locator('[data-next]')).toContainText('AC835 home');
  await expect(page.locator('[data-home-by]')).toContainText('in 5 days');
  await page.locator('[data-open-trip]').click();
  await expect(page).toHaveURL(/\/trips\/e2emid0001/);
  expect(problems).toEqual([]);
});

test('the trip Return tab renders for a seeded trip', async ({ page }) => {
  await seedOnboarded(page);
  const now = await pinNoon(page);
  const trip = baseTrip('e2eret0001', now + 5 * DAY);
  trip['legs'] = [
    flightLeg('leg-out', 'outbound', 'boarded', 'YUL', 'MAD', 'AC834', now - 2 * DAY, 'America/Toronto'),
    flightLeg('leg-ret', 'return', 'planned', 'MAD', 'YUL', 'AC835', now + 4 * DAY, 'Europe/Madrid'),
  ];
  await seedTrip(page, trip);
  const problems = await watchErrors(page);
  await page.goto('/trips/e2eret0001?tab=return');
  await expect(page.getByRole('heading', { name: 'Seville trip', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Getting home' })).toBeVisible();
  await expect(page.getByLabel('Deadline')).toBeVisible();
  expect(problems).toEqual([]);
});
