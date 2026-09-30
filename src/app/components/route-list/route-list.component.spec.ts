import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { COUNTDOWN_TICK_MS, RouteListComponent } from './route-list.component';
import { RouteCardComponent } from '../route-card/route-card.component';
import { NOW } from '../../state/app-state.service';
import { Coverage, resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { HubStats, computeRoutes } from '../../utils/routes';

const COVERAGE: Coverage = { from: '2026-09-01', to: '2027-03-31', generatedAt: null, hub: 'YUL' };
const STATS: HubStats = {
  directDestinations: 2, connectingDestinations: 1, countries: 3, flightsThisWeek: 13,
  departuresByWeekday: [3, 1, 3, 1, 3, 1, 1],
};

let clock = Date.parse('2026-10-05T16:00:00Z');

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(RouteListComponent);
  const base = {
    entries: [], coverage: COVERAGE, stats: STATS, favourites: [], timeFormat: '24h',
    weekStartKey: '2026-10-05', selectedDateKey: null, todayKey: '2026-10-05',
    hubCode: 'YUL', hubName: 'Montreal', showConnections: true, hasActiveFilters: false,
  };
  for (const [k, v] of Object.entries({ ...base, ...inputs })) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, cmp: fixture.componentInstance, text: () => el.textContent!.replace(/\s+/g, ' ') };
}

function routes(home: string, weekStartKey: string, dateKey: string | null) {
  return computeRoutes({ home, weekStartKey, dateKey, region: 'All', showConnections: true });
}

describe('RouteListComponent', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    clock = Date.parse('2026-10-05T16:00:00Z');
    TestBed.configureTestingModule({ providers: [{ provide: NOW, useValue: () => clock }] });
  });
  afterEach(() => {
    resetScheduleSource();
    vi.useRealTimers();
  });

  it('renders direct then connecting sections with counts, one card per destination', () => {
    const { el } = render({ entries: routes('YUL', '2026-10-05', null) });
    const secs = [...el.querySelectorAll('h2.sec')].map(h => h.textContent!.replace(/\s+/g, ' ').trim());
    expect(secs).toEqual(['Direct 2', 'One connection 1']);
    const cards = [...el.querySelectorAll('app-route-card .card__city')].map(c => c.textContent);
    expect(cards).toEqual(['Athens', 'London', 'Sydney']);
    expect(el.querySelector('app-route-card')!.classList).toContain('ui-enter');
  });

  it('passport stats: four tiles and a seven-bar weekday chart', () => {
    const { el } = render({ entries: routes('YUL', '2026-10-05', null) });
    const values = [...el.querySelectorAll('.tile__v')].map(v => v.textContent);
    expect(values).toEqual(['2', '1', '3', '13']);
    const bars = el.querySelectorAll('.bar');
    expect(bars.length).toBe(7);
    expect(bars[0].classList).toContain('is-today');
    expect(el.querySelector('.bars')!.getAttribute('aria-label')).toBe('Departures per day: Mon 3, Tue 1, Wed 3, Thu 1, Fri 3, Sat 1, Sun 1');
  });

  it('forwards card outputs with the destination code and marks favourites', () => {
    const { el, fixture, cmp } = render({ entries: routes('YUL', '2026-10-05', null), favourites: ['LHR'] });
    const opened: string[] = [];
    const starred: string[] = [];
    cmp.open.subscribe(c => opened.push(c));
    cmp.toggleFavourite.subscribe(c => starred.push(c));
    const cards = el.querySelectorAll('app-route-card');
    cards[1].querySelector<HTMLButtonElement>('.card__hit')!.click();
    cards[0].querySelector<HTMLButtonElement>('.card__fav')!.click();
    expect(opened).toEqual(['LHR']);
    expect(starred).toEqual(['ATH']);
    expect(cards[1].querySelector('.card__fav')!.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.debugElement.query(p => p.componentInstance instanceof RouteCardComponent)).toBeTruthy();
  });

  it('a week after the coverage end shows "not yet published" with a jump button, not "no flights"', () => {
    const { el, cmp, text } = render({ entries: [], weekStartKey: '2027-04-05' });
    expect(text()).toContain('Schedules not yet published for this week');
    expect(text()).toContain('published through Mar 31, 2027');
    expect(text()).not.toContain('No flights');
    expect(el.querySelector('.pass')).toBeNull();
    let jumped: string | null | undefined;
    cmp.jumpToCoverage.subscribe(k => (jumped = k));
    el.querySelector<HTMLButtonElement>('.empty button')!.click();
    expect(jumped).toBeNull();
  });

  it('a day after the coverage end uses day wording', () => {
    const { text } = render({ entries: [], weekStartKey: '2027-03-29', selectedDateKey: '2027-04-02' });
    expect(text()).toContain('Schedules not yet published for this date');
  });

  it('a date before coverage offers the first covered week', () => {
    const { el, cmp, text } = render({ entries: [], weekStartKey: '2026-08-10' });
    expect(text()).toContain('no longer available');
    let jumped: string | null | undefined;
    cmp.jumpToCoverage.subscribe(k => (jumped = k));
    el.querySelector<HTMLButtonElement>('.empty button')!.click();
    expect(jumped).toBe('2026-09-01');
  });

  it('a week straddling the coverage end shows the cards plus a partial-coverage note', () => {
    const { el, text } = render({ entries: routes('YUL', '2027-03-29', null), weekStartKey: '2027-03-29' });
    expect(text()).toContain('Published through Mar 31, 2027; later days this week are not yet available.');
    expect(el.querySelectorAll('app-route-card').length).toBeGreaterThan(0);
  });

  it('covered with no results: "No flights on <day>" in day mode, "No flights this week" in week mode', () => {
    const day = render({ entries: [], selectedDateKey: '2026-10-07' });
    expect(day.text()).toContain('No flights on Wed, Oct 7');
    expect(day.text()).not.toContain('not yet published');
    expect(day.el.querySelector('.empty button')).toBeNull();
    const week = render({ entries: [] });
    expect(week.text()).toContain('No flights this week');
  });

  it('with filters active, the empty state offers Clear filters', () => {
    const { el, cmp, text } = render({ entries: [], hasActiveFilters: true, selectedDateKey: '2026-10-07' });
    expect(text()).toContain('Nothing matches your filters');
    let cleared = 0;
    cmp.clearFilters.subscribe(() => cleared++);
    const btn = el.querySelector<HTMLButtonElement>('.empty button')!;
    expect(btn.textContent).toContain('Clear filters');
    btn.click();
    expect(cleared).toBe(1);
  });

  it('suggests turning on connections when they are off', () => {
    const { text } = render({ entries: [], showConnections: false });
    expect(text()).toContain('Turn on connections');
  });

  it('countdown compares "today" in the origin airport time zone, not the device (critique 37)', () => {
    // 05:00Z on Oct 6 is still Oct 5, 22:00 in Vancouver.
    clock = Date.parse('2026-10-06T05:00:00Z');
    const { cmp, fixture } = render({ hubCode: 'YVR', hubName: 'Vancouver', weekStartKey: '2026-10-05', selectedDateKey: '2026-10-05', entries: routes('YVR', '2026-10-05', '2026-10-05') });
    expect(cmp.originTodayKey()).toBe('2026-10-05');
    expect(cmp.cardNow()).toBe(clock);
    const el = fixture.nativeElement as HTMLElement;
    // YVR→SYD AC33 departs 23:40 local: 1h 40m after 22:00.
    expect(el.querySelector('.card__countdown')!.textContent).toContain('Departs in 1h 40m');
    fixture.componentRef.setInput('selectedDateKey', '2026-10-06');
    fixture.detectChanges();
    expect(cmp.cardNow()).toBeNull();
  });

  it('one list-owned timer refreshes the clock', () => {
    vi.useFakeTimers();
    const { cmp } = render({});
    const t0 = cmp.now();
    clock += COUNTDOWN_TICK_MS;
    vi.advanceTimersByTime(COUNTDOWN_TICK_MS);
    expect(cmp.now()).toBe(t0 + COUNTDOWN_TICK_MS);
  });

  it('keeps the deprecated shell-facing aliases', () => {
    const { cmp } = render({ entries: routes('YUL', '2026-10-05', null), selectedDateKey: '2026-10-07' });
    expect(cmp.routes.length).toBe(3);
    expect(cmp.hubCityName).toBe('Montreal');
    expect(cmp.selectedDate?.getDate()).toBe(7);
    expect(cmp.stats?.flightsThisWeek).toBe(13);
    expect(cmp.hasActiveFilters).toBe(false);
  });
});
