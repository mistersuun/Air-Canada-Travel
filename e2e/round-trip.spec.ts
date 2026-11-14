import { expect, test, type Page } from '@playwright/test';
import { seedOnboarded, waitForServiceWorker, watchErrors } from './helpers';

/**
 * Round trip planner end to end (dates-spec §5 "e2e"): Destination → picker →
 * /plan, picks that survive a reload, the Flight page's Change dates, Home's
 * Plan a round trip, 375px layout guards and an offline /plan.
 *
 * Runs on the real published schedules, so days are read from the page
 * (the first nonstop day after tomorrow, a way home at least 5 days later)
 * rather than hard-coded.
 */

const CODE = 'LIS';
const PHONE = { width: 375, height: 812 };

interface Copy {
  locale: string;
  homePick: RegExp;
  waysHome: RegExp;
  barAria: RegExp;
  planRound: RegExp;
}

const LANGS: Copy[] = [
  {
    locale: 'en-US',
    homePick: /^\s*Home · pick one \(\d+\)\s*$/,
    waysHome: /^Ways home · /,
    barAria: /^Your round trip$/,
    planRound: /^\s*Plan a round trip\s*$/,
  },
  {
    locale: 'fr-CA',
    homePick: /^\s*Retour · à choisir \(\d+\)\s*$/,
    waysHome: /^Retours · /,
    barAria: /^Votre aller-retour$/,
    planRound: /^\s*Planifier un aller-retour\s*$/,
  },
];

function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Picker cells that can be tapped (not past, not disabled), with their keys. */
function okCells(page: Page) {
  return page.locator('app-cal-month button.d[data-key]:not([aria-disabled])');
}

/** Taps the first pickable day on or after `min` that satisfies `nonstop`, and returns its key. */
async function tapDay(page: Page, min: string, nonstop = false): Promise<string> {
  await expect(okCells(page).first()).toBeVisible();
  const keys = await okCells(page).evaluateAll((els, ns) =>
    els.filter(e => !ns || !!e.querySelector('.dm--solid')).map(e => e.getAttribute('data-key')!), nonstop);
  const key = keys.find(k => k >= min);
  expect(key, `a pickable day on or after ${min}`).toBeTruthy();
  await page.locator(`app-cal-month button.d[data-key="${key}"]`).click();
  return key!;
}

/** Hub-local tomorrow is never earlier than UTC today + 1 minus a day; +2 keeps clear of "today" in any zone. */
function soon(): string {
  return addDaysKey(new Date().toISOString().slice(0, 10), 2);
}

/**
 * 375px guards (dates-spec §5 e2e 5): no sideways scroll; every visible control in `scope`
 * is at least 44×44 counting its ::after hit area; no ellipsis on flight numbers.
 */
async function guards(page: Page, scope: string): Promise<void> {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth), 'no horizontal page scroll').toBeLessThanOrEqual(PHONE.width);
  const small = await page.locator(scope).first().evaluate(root => {
    const out: string[] = [];
    const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
    for (const el of root.querySelectorAll<HTMLElement>('button, a, [role=radio], [role=option]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"], details:not([open]) > :not(summary)')) continue;
      let w = r.width;
      let h = r.height;
      const after = getComputedStyle(el, '::after');
      if (after.content !== 'none' && after.position === 'absolute') {
        w = Math.max(w, r.width - px(after.left) - px(after.right));
        h = Math.max(h, r.height - px(after.top) - px(after.bottom));
      }
      if (w < 43.5 || h < 43.5) {
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${label}" ${Math.round(w)}×${Math.round(h)}`);
      }
    }
    return out;
  });
  expect(small, `controls under 44×44 in ${scope}`).toEqual([]);
  const cut = await page.evaluate(() => {
    const flight = /\bAC ?\d{1,4}\b/;
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(e => e.childElementCount === 0 && flight.test(e.textContent ?? '') && getComputedStyle(e).textOverflow === 'ellipsis')
      .map(e => e.textContent!.trim());
  });
  expect(cut, 'flight numbers are never cut with an ellipsis').toEqual([]);
}

for (const L of LANGS) {
  test.describe(`round trip (${L.locale})`, () => {
    test.use({ locale: L.locale, viewport: PHONE, isMobile: true, hasTouch: true });

    test('1. Destination → Pick dates → leave → home → See flights, in 4 taps', async ({ page }) => {
      await seedOnboarded(page);
      const problems = await watchErrors(page);
      await page.goto(`/to/${CODE}`);
      await guards(page, '[data-dates-bar]');
      await guards(page, 'app-day-count-strip');

      let taps = 0;
      await page.locator('[data-dates-pick]').click(); taps++;
      await expect(page).toHaveURL(new RegExp(`/calendar/${CODE}`));
      await guards(page, '.pk');
      const dep = await tapDay(page, soon(), true); taps++;
      await expect(page.locator('[data-banner]')).toContainText(`${CODE} → `);
      await guards(page, '.pk');
      const ret = await tapDay(page, addDaysKey(dep, 5)); taps++;
      await page.locator('footer.ft button.ui-btn').click(); taps++;
      expect(taps).toBeLessThanOrEqual(4);

      await expect(page).toHaveURL(new RegExp(`/plan/${CODE}\\?.*dep=${dep}.*ret=${ret}`));
      await expect(page.locator('#pl-home')).toHaveText(L.waysHome);
      await expect(page.locator('#pl-home')).toBeVisible();
      const bar = page.getByRole('region', { name: L.barAria });
      await expect(bar.locator('[data-side="home"]')).toHaveText(L.homePick);
      await guards(page, '.pl');
      expect(problems).toEqual([]);
    });

    test('2. picks survive a reload, and Start a trip makes a 2-leg trip', async ({ page }) => {
      await seedOnboarded(page);
      const problems = await watchErrors(page);
      await page.goto(`/calendar/${CODE}`);
      const dep = await tapDay(page, soon(), true);
      const ret = await tapDay(page, addDaysKey(dep, 5));
      await page.locator('footer.ft button.ui-btn').click();
      await expect(page).toHaveURL(new RegExp(`/plan/${CODE}\\?`));

      await page.locator('[data-list="out"] [role="radio"]').first().click();
      await expect(page).toHaveURL(/[?&]out=/);
      await page.locator('[data-list="home"] [role="radio"]').first().click();
      await expect(page).toHaveURL(/[?&]back=/);
      const url = page.url();

      await page.reload();
      expect(page.url()).toBe(url);
      await expect(page.locator('[data-list="out"] [role="radio"][aria-checked="true"]')).toHaveCount(1);
      await expect(page.locator('[data-list="home"] [role="radio"][aria-checked="true"]')).toHaveCount(1);
      await expect(page.locator('[data-stay]')).toBeVisible();
      expect(new URL(url).searchParams.get('dep')).toBe(dep);
      expect(new URL(url).searchParams.get('ret')).toBe(ret);
      await guards(page, '.pl');

      // The Destination Dates bar with both days (See flights, Clear) and with the day out only (stay chips).
      await page.goto(`/to/${CODE}?dep=${dep}&ret=${ret}`);
      await expect(page.locator('[data-dates-see]')).toBeVisible();
      await guards(page, '[data-dates-bar]');
      await page.goto(`/to/${CODE}?dep=${dep}`);
      await expect(page.locator('[data-dates-bar] app-stay-chips')).toBeVisible();
      await guards(page, '[data-dates-bar]');

      await page.goto(url);
      await page.locator('[data-start]').click();
      await expect(page).toHaveURL(/\/trips\/(?!import)[^/?]+/);
      await expect(page.locator('[data-leg]')).toHaveCount(2);
      expect(problems).toEqual([]);
    });

    test('3. Flight page → Change dates → a new home day → See flights keeps the flight out', async ({ page }) => {
      await seedOnboarded(page);
      const problems = await watchErrors(page);
      await page.goto(`/to/${CODE}`);
      const flight = page.locator('a[href^="/flight/"]:visible').first();
      await expect(flight).toBeVisible();
      await flight.click();
      await expect(page).toHaveURL(/\/flight\//);
      await expect(page.locator('app-return-summary')).toBeVisible();

      await page.locator(`a[href^="/calendar/${CODE}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/calendar/${CODE}\\?.*out=`));
      const out = new URL(page.url()).searchParams.get('out');
      const dep = new URL(page.url()).searchParams.get('dep')!;
      expect(out).toBeTruthy();
      // The departure is set, so the next tap is the day home.
      await expect(page.locator('[data-banner]')).toContainText(`${CODE} → `);
      const ret = await tapDay(page, addDaysKey(dep, 3));
      await page.locator('footer.ft button.ui-btn').click();
      await expect(page).toHaveURL(new RegExp(`/plan/${CODE}\\?`));
      const q = new URL(page.url()).searchParams;
      expect(q.get('out')).toBe(out);
      expect(q.get('ret')).toBe(ret);
      await expect(page.locator('[data-list="out"] [role="radio"][aria-checked="true"]')).toHaveCount(1);
      expect(problems).toEqual([]);
    });

    test('4. Home → Plan a round trip → chooser → the destination keeps the day', async ({ page }) => {
      await seedOnboarded(page);
      const problems = await watchErrors(page);
      await page.goto('/');
      // A selected day on the week strip travels with the button as ?dep.
      const day = page.locator('app-week-strip button.d:not(.is-past):not(.is-out)').last();
      await day.click();
      await expect(day).toHaveAttribute('aria-pressed', 'true');
      const btn = page.locator('[data-plan-round]');
      await expect(btn).toHaveText(L.planRound);
      await expect(btn).toHaveAttribute('href', /[?&]dep=\d{4}-\d{2}-\d{2}/);
      await btn.click();
      await expect(page).toHaveURL(/\/calendar\?.*dep=\d{4}-\d{2}-\d{2}/);
      const dep = new URL(page.url()).searchParams.get('dep')!;
      await page.locator('[data-search-input]').fill('Lisbon');
      await page.locator(`a[href^="/calendar/${CODE}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/calendar/${CODE}\\?.*dep=${dep}`));
      expect(problems).toEqual([]);
    });
  });
}

test.describe('round trip offline', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('6. /plan renders its counts with the network off once the service worker is in control', async ({ page, context }) => {
    await seedOnboarded(page);
    await page.goto(`/calendar/${CODE}`);
    await waitForServiceWorker(page);
    const dep = await tapDay(page, soon(), true);
    const ret = await tapDay(page, addDaysKey(dep, 5));
    // The prefetch groups (app shell incl. the lazy plan chunk, schedules, vendor) must be cached first.
    await expect.poll(() => page.evaluate(async () => {
      const sizes: Record<string, number> = {};
      for (const k of await caches.keys()) {
        const m = /:assets:(app|schedules|vendor):cache$/.exec(k);
        if (m) sizes[m[1]] = (await (await caches.open(k)).keys()).length;
      }
      return !!sizes['app'] && sizes['schedules'] >= 3 && !!sizes['vendor'];
    }), { timeout: 45_000 }).toBe(true);

    await context.setOffline(true);
    try {
      await page.goto(`/plan/${CODE}?dep=${dep}&ret=${ret}`);
      await expect(page.locator('#pl-out')).toBeVisible();
      await expect(page.locator('[data-strip="out"] [data-key]').first()).toBeVisible();
      await expect(page.locator('[data-list="out"] [role="radio"]').first()).toBeVisible();
      await expect(page.locator('[data-list="home"] [role="radio"]').first()).toBeVisible();
      await expect(page.locator('[data-side="home"]')).toHaveText(/\(\d+\)/);
    } finally {
      await context.setOffline(false);
    }
  });
});
