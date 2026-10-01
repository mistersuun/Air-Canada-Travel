import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Coverage, resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { computeRoutes } from '../../utils/routes';
import { ResultsListComponent } from './results-list.component';

const COVERAGE: Coverage = { from: '2026-09-01', to: '2027-03-31', generatedAt: null, hub: 'YUL' };

async function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(ResultsListComponent);
  const base = {
    entries: [], coverage: COVERAGE, weekStartKey: '2026-10-05', selectedDateKey: null, todayKey: '2026-10-05',
    hubName: 'Montreal', showConnections: true, hasActiveFilters: false, favourites: new Set<string>(),
  };
  for (const [k, v] of Object.entries({ ...base, ...inputs })) fixture.componentRef.setInput(k, v);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, cmp: fixture.componentInstance, text: () => el.textContent!.replace(/\s+/g, ' ') };
}

function routes(home: string, weekStartKey: string, dateKey: string | null) {
  return computeRoutes({ home, weekStartKey, dateKey, region: 'All', showConnections: true });
}

describe('ResultsListComponent (ported from route-list)', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: new MemoryStorage() }],
    });
  });
  afterEach(() => resetScheduleSource());

  it('renders nonstop then one-connection groups with counts, one row per destination', async () => {
    const { el } = await render({ entries: routes('YUL', '2026-10-05', null) });
    const heads = [...el.querySelectorAll('.grp .ui-sec-h')].map(h => `${h.querySelector('h2')!.textContent} ${h.querySelector('.ui-tag')!.textContent}`);
    expect(heads).toEqual(['Nonstop 2', 'One connection 1']);
    const names = [...el.querySelectorAll('app-dest-row .nm')].map(c => c.childNodes[0].textContent!.trim());
    expect(names).toEqual(['Athens', 'London', 'Sydney']);
    // Rows link to the destination page.
    expect(el.querySelector('app-dest-row a.row')!.getAttribute('href')).toContain('/to/ATH');
  });

  it('rows carry the week dots and the compact meta; compact drops the dots', async () => {
    const { el } = await render({ entries: routes('YUL', '2026-10-05', null) });
    const lhr = el.querySelectorAll('app-dest-row')[1];
    expect(lhr.querySelector('.tm')!.textContent).toBe('22:10 → 10:00⁺¹ · 6h50 · AC864');
    expect(lhr.querySelector('app-dot-row')!.getAttribute('aria-label')).toBe('Flies daily');
    const sydney = el.querySelectorAll('app-dest-row')[2];
    expect(sydney.querySelector('.nm small')!.textContent).toContain('via');
    const compact = await render({ entries: routes('YUL', '2026-10-05', null), compact: true });
    expect(compact.el.querySelector('app-dot-row')).toBeNull();
  });

  it('the star toggles a favourite without following the row link', async () => {
    const { el, cmp, fixture } = await render({ entries: routes('YUL', '2026-10-05', null), favourites: new Set(['LHR']) });
    const starred: string[] = [];
    cmp.toggleFavourite.subscribe(c => starred.push(c));
    const stars = el.querySelectorAll<HTMLButtonElement>('button.star');
    expect(stars[1].getAttribute('aria-pressed')).toBe('true');
    expect(stars[0].getAttribute('aria-pressed')).toBe('false');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    stars[0].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(starred).toEqual(['ATH']);
    await fixture.whenStable();
  });

  it('a week after the coverage end shows "aren\'t published yet" with a jump button, not "no flights"', async () => {
    const { el, cmp, text } = await render({ entries: [], weekStartKey: '2027-04-05' });
    expect(text()).toContain("Schedules for this week aren't published yet");
    expect(text()).toContain('published through Mar 31, 2027');
    expect(text()).not.toContain('No flights');
    let jumped: string | null | undefined;
    cmp.jumpToCoverage.subscribe(k => (jumped = k));
    const btn = el.querySelector<HTMLButtonElement>('.empty button')!;
    expect(btn.textContent).toContain('Go to last published week');
    btn.click();
    expect(jumped).toBeNull();
  });

  it('a day after the coverage end uses day wording', async () => {
    const { text } = await render({ entries: [], weekStartKey: '2027-03-29', selectedDateKey: '2027-04-02' });
    expect(text()).toContain("Schedules for this date aren't published yet");
  });

  it('a date before coverage offers the first published week', async () => {
    const { el, cmp, text } = await render({ entries: [], weekStartKey: '2026-08-10' });
    expect(text()).toContain('no longer available');
    let jumped: string | null | undefined;
    cmp.jumpToCoverage.subscribe(k => (jumped = k));
    el.querySelector<HTMLButtonElement>('.empty button')!.click();
    expect(jumped).toBe('2026-09-01');
  });

  it('no published schedules at all', async () => {
    const { text, el } = await render({ entries: [], coverage: { ...COVERAGE, from: null, to: null } });
    expect(text()).toContain('No published schedules yet');
    expect(el.querySelector('.empty button')).toBeNull();
  });

  it('a week straddling the coverage end shows the rows plus a partial-coverage note', async () => {
    const { el, text } = await render({ entries: routes('YUL', '2027-03-29', null), weekStartKey: '2027-03-29' });
    expect(text()).toContain('Published through Mar 31, 2027; later days this week are not yet available.');
    expect(el.querySelectorAll('app-dest-row').length).toBeGreaterThan(0);
  });

  it('a window that starts mid-week: a note only while those days are still ahead', async () => {
    const cov = { ...COVERAGE, from: '2026-10-07' };
    const ahead = await render({ entries: routes('YUL', '2026-10-05', null), coverage: cov, todayKey: '2026-10-01' });
    expect(ahead.text()).toContain('Published from Oct 7, 2026; earlier days this week are not shown.');
    const past = await render({ entries: routes('YUL', '2026-10-05', null), coverage: cov, todayKey: '2026-10-08' });
    expect(past.el.querySelector('.note')).toBeNull();
  });

  it('covered with no results: "No flights on <day>" in day mode, "No flights this week" in week mode', async () => {
    const day = await render({ entries: [], selectedDateKey: '2026-10-07' });
    expect(day.text()).toContain('No flights on Wed, Oct 7');
    expect(day.text()).not.toContain('published yet');
    expect(day.el.querySelector('.empty button')).toBeNull();
    const week = await render({ entries: [] });
    expect(week.text()).toContain('No flights this week');
  });

  it('with filters active, the empty state offers Clear filters', async () => {
    const { el, cmp, text } = await render({ entries: [], hasActiveFilters: true, selectedDateKey: '2026-10-07' });
    expect(text()).toContain('No destinations match');
    let cleared = 0;
    cmp.clearFilters.subscribe(() => cleared++);
    const btn = el.querySelector<HTMLButtonElement>('.empty button')!;
    expect(btn.textContent).toContain('Clear filters');
    btn.click();
    expect(cleared).toBe(1);
  });

  it('suggests turning on connections when they are off', async () => {
    const { text } = await render({ entries: [], showConnections: false });
    expect(text()).toContain('Turn on connections');
  });

  it('marks the selected day (else today) on every dot row', async () => {
    const { el } = await render({ entries: routes('YUL', '2026-10-05', null), todayKey: '2026-10-06' });
    const sel = el.querySelectorAll('app-dest-row')[1].querySelectorAll('app-dot-row i');
    expect(sel[1].classList).toContain('sel');
  });

  it('Places: a group after the AC results, and in place of the empty state', async () => {
    const places = [{ id: 'gn-2510911', name: 'Seville', sub: "Spain · Not on AC's network" }];
    const a = await render({ entries: routes('YUL', '2026-10-05', null), places, placeParams: { dep: '2026-10-08' } });
    const heads = [...a.el.querySelectorAll('.grp h2')].map(h => h.textContent);
    expect(heads).toEqual(['Nonstop', 'One connection', 'Places']);
    expect(a.el.querySelector('.prow')!.getAttribute('href')).toBe('/reach/gn-2510911?dep=2026-10-08');
    const b = await render({ entries: [], places, hasActiveFilters: true });
    expect(b.text()).not.toContain('No destinations match');
    expect(b.el.querySelector('.psub')!.textContent).toBe("Spain · Not on AC's network");
    const c = await render({ entries: [], places: [], hasActiveFilters: true });
    expect(c.text()).toContain('No destinations match');
  });
});
