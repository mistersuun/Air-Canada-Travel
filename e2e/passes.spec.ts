import { expect, test } from '@playwright/test';
import bwip from 'bwip-js';
import { seedOnboarded, watchErrors } from './helpers';

// Boarding pass from a file: a PDF417 barcode is drawn here with bwip-js (a made-up BCBP string, not a real pass),
// set on the Add pass file input, read on the page, saved and shown full-screen. The page clock is pinned to
// midday in Toronto so the flight date and the pass date stay in step whatever time the test runs.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function localAt(ms: number, tz: string): { dateKey: string; hhmm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { dateKey: `${p['year']}-${p['month']}-${p['day']}`, hhmm: `${p['hour']}:${p['minute']}` };
}

const SEVILLE = { id: 'gn-2510911', name: 'Seville', country: 'Spain', iso2: 'ES', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid', admin1: 'Andalusia' };

/** Day of the year (1-366) of a yyyy-mm-dd key. */
function julian(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / DAY);
}

test('Passes: a barcode picture from a file is read, saved and shown full-screen', async ({ page }) => {
  await seedOnboarded(page);
  const noon = Date.parse(`${localAt(Date.now(), 'America/Toronto').dateKey}T16:00:00Z`);
  await page.clock.install({ time: noon });
  const problems = await watchErrors(page);

  // A flight two days out, so "Add boarding pass" has a leg for the pass to match.
  const depMs = noon + 2 * DAY + 5 * HOUR;
  const dep = localAt(depMs, 'America/Toronto');
  const arr = localAt(depMs + 7 * HOUR, 'Europe/Madrid');
  const homeBy = localAt(noon + 6 * DAY, 'America/Toronto');
  const trip = {
    v: 1, id: 'e2e-pass-trip', name: 'Seville trip', createdAt: new Date(noon).toISOString(), updatedAt: new Date(noon).toISOString(),
    goal: SEVILLE, party: { count: 1, stayTogether: false, splitNote: '' },
    fromHub: 'YUL', homeAirport: 'YUL', outboundDate: dep.dateKey, homeBy,
    legs: [{
      kind: 'flight', id: 'out1', role: 'outbound', status: 'planned', statusAt: null, note: '', provenance: 'scheduled', alternates: [],
      refs: [{ flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: dep.dateKey, depLocal: dep.hhmm, arrLocal: arr.hhmm, arrDateKey: arr.dateKey, aircraft: '333' }],
    }],
    prep: {}, customPrep: [], changes: [], scheduleGeneratedAt: null, offlineSavedAt: null,
    calendarExportedAt: null, sharedFrom: null, archived: false,
  };
  await page.addInitScript(t => {
    try {
      if (!localStorage.getItem('ac.trips.v1')) localStorage.setItem('ac.trips.v1', JSON.stringify({ schema: 1, trips: [t] }));
    } catch {
      // Storage blocked: the test fails on its own assertions.
    }
  }, trip);

  // BCBP, one leg, exact field widths: the same shape as the unit-test samples.
  const text = `M1DOE/JOHN            EABC123 YULMADAC 0834 ${String(julian(dep.dateKey)).padStart(3, '0')}Y012A0045 100`;
  const png = await bwip.toBuffer({ bcid: 'pdf417', text, scale: 3, columns: 6, backgroundcolor: 'FFFFFF', paddingwidth: 12, paddingheight: 12 });

  await page.goto('/trips/e2e-pass-trip/passes/add');
  await expect(page.getByRole('heading', { name: /Add boarding pass/ })).toBeVisible();
  await page.locator('[data-input="image"]').setInputFiles({ name: 'pass.png', mimeType: 'image/png', buffer: png });

  await expect(page.locator('[data-check-title]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-pnr]')).toHaveText('ABC123');
  await expect(page.locator('[data-match]')).toContainText('AC834');
  await page.locator('[data-save]').click();

  // Full-screen pass view.
  await expect(page).toHaveURL(/\/trips\/e2e-pass-trip\/pass\/[^/?]+/);
  const view = page.locator('[data-pass-view]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-barcode] svg')).toBeVisible();
  await expect(view.locator('[data-pnr]')).toHaveText('ABC123');
  const box = await view.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(vp.height - 1);

  await view.locator('[data-close]').click();
  await expect(view).toBeHidden();
  expect(problems).toEqual([]);
});
