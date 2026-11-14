import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource, type SchedulesMeta } from '../../data/schedule-index';
import { rec, route } from '../../data/testing/schedule-fixtures';
import { placeFromDestination } from '../../places/place';
import { homeByFor, resetItinerariesMemo } from '../../planner/round-trip';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_STORAGE } from '../../trips/storage';
import { TripsService } from '../../trips/trips.service';
import { PlanPage } from './plan.page';

/**
 * The Lisbon world of planner/round-trip.spec.ts, autumn 2026:
 * YUL→LIS AC834 22:10→08:15⁺¹ Mon/Wed/Fri/Sun, AC832 21:55→08:00⁺¹ Tue/Thu,
 * AC830 18:05→04:05⁺¹ Fri; LIS→YUL AC835 07:10, AC837 10:40, AC839 13:00
 * every day but Sunday, AC831 08:45 / AC833 09:15 on Sat Nov 21 only. YUL→OPO starts Jan 5.
 */
const PLAN_ROUTES = [
  route('YUL', 'LIS',
    rec('AC834', '22:10', '08:15', '2026-09-01', '2027-03-28', 'Mon,Wed,Fri,Sun', '333'),
    rec('AC832', '21:55', '08:00', '2026-09-01', '2027-03-28', 'Tue,Thu', '333'),
    rec('AC830', '18:05', '04:05', '2026-09-01', '2027-03-28', 'Fri', '789'),
  ),
  route('LIS', 'YUL',
    rec('AC835', '07:10', '09:10', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat', '333'),
    rec('AC837', '10:40', '12:40', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat', '333'),
    rec('AC839', '13:00', '15:00', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat', '333'),
    rec('AC831', '08:45', '10:45', '2026-11-21', '2026-11-21', 'Sat', '333'),
    rec('AC833', '09:15', '11:15', '2026-11-21', '2026-11-21', 'Sat', '333'),
  ),
  route('YUL', 'OPO', rec('AC820', '21:00', '08:30', '2027-01-05', '2027-03-28', 'Tue,Fri', '333')),
  route('OPO', 'YUL', rec('AC821', '10:30', '13:00', '2027-01-06', '2027-03-28', 'Wed,Sat', '333')),
];
const PLAN_META: SchedulesMeta = { generatedAt: '2026-11-01T06:00:00Z', coverageFrom: '2026-09-01', coverageTo: '2027-03-28' };
/** Sat Nov 14 2026, 10:00 in Montréal. */
const PLAN_CLOCK = Date.parse('2026-11-14T15:00:00Z');

interface PlanInputs {
  code?: string;
  dep?: string;
  ret?: string;
  out?: string;
  back?: string;
  nights?: string;
}

function configurePlan(prefs: object = { showConnections: false }) {
  const storage = new MemoryStorage();
  storage.setItem('ac.prefs.v1', JSON.stringify(prefs));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PREFS_STORAGE, useValue: storage },
      { provide: TRIPS_STORAGE, useValue: new MemoryStorage() },
      { provide: NOW, useValue: () => PLAN_CLOCK },
    ],
  });
}

async function renderPlan(inputs: PlanInputs = {}) {
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PlanPage);
  const ref = fixture.componentRef;
  ref.setInput('code', inputs.code ?? 'LIS');
  for (const k of ['dep', 'ret', 'out', 'back', 'nights'] as const) if (inputs[k] !== undefined) ref.setInput(k, inputs[k]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Sets query inputs the way the router would after a navigation. */
  const set = async (p: PlanInputs) => {
    for (const [k, v] of Object.entries(p)) ref.setInput(k, v);
    await stable();
  };
  const text = (sel?: string) => ((sel ? el.querySelector(sel) : el)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const pressed = (list: 'out' | 'home') =>
    [...el.querySelectorAll(`[data-list="${list}"] button[aria-checked="true"]`)].map(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim());
  const lastQuery = () => (nav.mock.calls.at(-1)?.[1] as { queryParams?: Record<string, unknown> } | undefined)?.queryParams;
  return { fixture, el, nav, stable, set, text, pressed, lastQuery, cmp: fixture.componentInstance };
}

const DEP = '2026-11-20';
const RET = '2026-11-28';

describe('PlanPage', () => {
  beforeEach(() => {
    setScheduleSource(PLAN_ROUTES, PLAN_META);
    resetItinerariesMemo();
  });
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('restores the picked flights out and home from the URL', async () => {
    configurePlan();
    const { el, text, pressed, nav } = await renderPlan({ dep: DEP, ret: RET, out: 'AC834', back: 'AC837' });
    expect(text('h1')).toBe('Round trip');
    expect(text('.ctx')).toBe('YUL ⇄ LIS · Lisbon');
    expect(text('[data-dates]')).toContain('Fri, Nov 20 → Sat, Nov 28');
    expect(text('[data-dates]')).toContain('8 nights');
    expect(text('#pl-out')).toBe('Flights out · Fri, Nov 20');
    expect(text('#pl-home')).toBe('Ways home · Sat, Nov 28');
    expect(pressed('out')).toHaveLength(1);
    expect(pressed('out')[0]).toContain('AC834');
    expect(pressed('home')).toHaveLength(1);
    expect(pressed('home')[0]).toContain('AC837');
    expect(text('[data-side="out"]')).toBe('Out · AC834 22:10');
    expect(text('[data-side="home"]')).toBe('Home · AC837 10:40');
    expect(text('[data-stay]')).toBe('7d 2h in Lisbon');
    expect(el.querySelector('[data-notice]')).toBeNull();
    expect(el.querySelector('[data-strip="out"] [data-key="2026-11-20"]')!.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-strip="home"] [data-key="2026-11-28"]')!.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-change]')!.getAttribute('href')).toContain(
      'dep=2026-11-20&ret=2026-11-28&out=AC834&back=AC837');
    expect(nav).not.toHaveBeenCalledWith(['/calendar', 'LIS'], expect.anything());
  });

  it('a row tap writes ?out= / ?back=, and tapping the picked row unpicks it', async () => {
    configurePlan();
    const { el, nav, set } = await renderPlan({ dep: DEP, ret: RET });
    expect(el.querySelector('[data-side="out"]')!.classList).toContain('is-open');
    expect(el.querySelector('[data-side="out"]')!.textContent!.trim()).toBe('Out · pick one (2)');
    expect(el.querySelector('[data-side="home"]')!.textContent!.trim()).toBe('Home · pick one (3)');
    // Screen readers hear the noun, not 'pick one, parenthesis 3'.
    expect(el.querySelector('[data-side="out"]')!.getAttribute('aria-label')).toBe('Flights out: pick 1 of 2 flights');
    expect(el.querySelector('[data-side="home"]')!.getAttribute('aria-label')).toBe('Ways home: pick 1 of 3 flights');
    const row = [...el.querySelectorAll<HTMLButtonElement>('[data-list="out"] button')].find(b => b.textContent!.includes('AC834'))!;
    row.click();
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { out: 'AC834' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    await set({ out: 'AC834' });
    [...el.querySelectorAll<HTMLButtonElement>('[data-list="out"] button')].find(b => b.textContent!.includes('AC834'))!.click();
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { out: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    [...el.querySelectorAll<HTMLButtonElement>('[data-list="home"] button')].find(b => b.textContent!.includes('AC839'))!.click();
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { back: 'AC839' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  });

  it('a strip day keeps the flight when it flies, else shows the carry notice with a suggestion and no auto-pick', async () => {
    configurePlan();
    const { el, nav, set, pressed, text, lastQuery, stable } = await renderPlan({ dep: DEP, ret: RET, out: 'AC834' });
    el.querySelector<HTMLButtonElement>('[data-strip="out"] [data-key="2026-11-22"]')!.click();
    expect(lastQuery()).toEqual({ dep: '2026-11-22' });   // ?out= is left alone
    await stable();
    expect(text('[aria-live="polite"]')).toBe('1 flight out on Sunday, November 22');
    await set({ dep: '2026-11-22' });
    expect(pressed('out')[0]).toContain('AC834');
    // The return stayed on Nov 28, so the stay shrank: said, with a one-tap way to keep 8 nights (never applied silently).
    expect([...el.querySelectorAll('[data-notice]')].map(n => n.getAttribute('data-notice'))).toEqual(['nights']);
    expect(text('[data-notice="nights"] p')).toBe('Your stay is now 6 nights');
    expect(text('[data-notice="nights"] button')).toBe('Keep 8 nights (home Mon, Nov 30)');

    await set({ dep: '2026-11-19' });
    expect(pressed('out')).toEqual([]);
    expect(text('[data-notice="carry"] p')).toBe('AC834 doesn’t fly Thu, Nov 19 · earliest nonstop: AC832 21:55');
    expect(text('[data-side="out"]')).toBe('Out · pick one (1)');
    const calls = nav.mock.calls.length;
    const [pick, dismiss] = [...el.querySelectorAll<HTMLButtonElement>('[data-notice="carry"] button')];
    expect(nav.mock.calls.length).toBe(calls);  // nothing written until a tap
    pick.click();
    expect(lastQuery()).toEqual({ out: 'AC832' });
    dismiss.click();
    expect(lastQuery()).toEqual({ out: null });
  });

  it('moving the departure to or past the return shifts the return and says so', async () => {
    configurePlan();
    const { el, set, text, lastQuery } = await renderPlan({ dep: DEP, ret: '2026-11-22' });
    el.querySelector<HTMLButtonElement>('[data-strip="out"] [data-key="2026-11-23"]')!.click();
    expect(lastQuery()).toEqual({ dep: '2026-11-23', ret: '2026-11-25' });
    await set({ dep: '2026-11-23', ret: '2026-11-25' });
    expect(text('[data-notice="moved"] p')).toBe('Home moved to Wed, Nov 25 to keep 2 nights');
    el.querySelector<HTMLButtonElement>('[data-notice="moved"] button')!.click();
    await set({});
    expect(el.querySelector('[data-notice="moved"]')).toBeNull();
  });

  it('a way home that leaves before you land stays in the URL with a notice; one that does not fly says so', async () => {
    configurePlan();
    const a = await renderPlan({ dep: DEP, ret: '2026-11-21', out: 'AC834', back: 'AC835' });
    expect(a.text('[data-notice="beforeLanding"] p')).toBe('AC835 leaves before you land · pick another way home');
    expect(a.pressed('home')).toEqual([]);
    expect(a.text('[data-side="home"]')).toBe('Home · pick one (3)');
    expect(a.nav).not.toHaveBeenCalled();
    expect(a.el.querySelector('[data-change]')!.getAttribute('href')).toContain('back=AC835');
    a.el.querySelector<HTMLButtonElement>('[data-notice="beforeLanding"] button')!.click();
    expect(a.lastQuery()).toEqual({ back: null });

    await a.set({ ret: RET, back: 'AC831' });
    expect(a.text('[data-notice="gone"] p')).toBe('AC831 doesn’t fly home on Sat, Nov 28 · pick another way home');
  });

  it('the rule line names the earliest arrival, then the picked flight', async () => {
    configurePlan();
    const { set, text, el } = await renderPlan({ dep: DEP, ret: '2026-11-21' });
    expect(text('[data-rule]')).toBe('Leaving at least 60 min after the earliest arrival (Sat, Nov 21 04:05)');
    expect(el.querySelectorAll('[data-list="home"] app-option-row')).toHaveLength(4);   // + Show all
    expect(text('.more')).toBe('Show all 5');
    await set({ out: 'AC834' });
    expect(text('[data-rule]')).toBe('Leaving at least 60 min after AC834 lands (Sat, Nov 21 08:15)');
    expect(text('[data-side="home"]')).toBe('Home · pick one (3)');
  });

  it('days after landing, the rule line just says when you land', async () => {
    configurePlan();
    const { set, text } = await renderPlan({ dep: DEP, ret: RET });
    expect(text('[data-rule]')).toBe('You land Sat, Nov 21 04:05 at the earliest');
    await set({ out: 'AC834' });
    expect(text('[data-rule]')).toBe('AC834 lands Sat, Nov 21 08:15');
  });

  it('a stay chip on a day not yet published says why instead of doing nothing', async () => {
    configurePlan();
    const { cmp, text, nav, stable } = await renderPlan({ dep: '2027-03-25' });
    nav.mockClear();
    cmp.setRet('2027-03-30');
    await stable();
    expect(nav).not.toHaveBeenCalled();
    expect(text('[data-chip-note]')).toBe('Not yet published · schedules end Mar 28, 2027');
  });

  it('Start a trip creates the outbound and return legs with home by the return; without one, the return day at 22:00', async () => {
    configurePlan();
    const a = await renderPlan({ dep: DEP, ret: RET, out: 'AC834', back: 'AC837' });
    const trips = TestBed.inject(TripsService);
    const btn = a.el.querySelector<HTMLButtonElement>('[data-start]')!;
    expect(btn.textContent!.trim()).toBe('Start a trip');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-describedby')).toBeNull();
    btn.click();
    const trip = trips.trips()[0];
    expect(trip.legs.filter(l => l.kind === 'flight').map(l => (l as { role: string }).role)).toEqual(['outbound', 'return']);
    expect(trip.homeBy).toEqual(homeByFor(a.cmp.backPicked()!));
    expect(a.nav).toHaveBeenLastCalledWith(['/trips', trip.id], { queryParams: expect.any(Object) });

    TestBed.resetTestingModule();
    configurePlan();
    const b = await renderPlan({ dep: DEP, ret: RET, out: 'AC834' });
    b.el.querySelector<HTMLButtonElement>('[data-start]')!.click();
    const one = TestBed.inject(TripsService).trips()[0];
    expect(one.legs.filter(l => l.kind === 'flight')).toHaveLength(1);
    expect(one.homeBy).toEqual({ dateKey: RET, hhmm: '22:00' });
  });

  it('offers "Add to <trip>" when a trip on these dates goes there', async () => {
    configurePlan();
    const trips = TestBed.inject(TripsService);
    const existing = trips.create({
      goal: placeFromDestination('LIS'), fromHub: 'YUL', outboundDate: DEP, homeBy: { dateKey: RET, hhmm: '22:00' },
    });
    const { el, nav } = await renderPlan({ dep: DEP, ret: RET, out: 'AC834', back: 'AC837' });
    const btn = el.querySelector<HTMLButtonElement>('[data-start]')!;
    expect(btn.textContent!.trim()).toBe('Add to Lisbon trip');
    btn.click();
    const tr = trips.trip(existing.id)!;
    expect(tr.legs.filter(l => l.kind === 'flight')).toHaveLength(2);
    expect(trips.trips()).toHaveLength(1);
    expect(nav).toHaveBeenLastCalledWith(['/trips', existing.id], { queryParams: expect.any(Object) });
  });

  it('the start button is disabled until a flight out is picked, and says why', async () => {
    configurePlan();
    const { el, text } = await renderPlan({ dep: DEP, ret: RET });
    const btn = el.querySelector<HTMLButtonElement>('[data-start]')!;
    // aria-disabled, not disabled: it stays in the tab order, so the reason is heard.
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('aria-describedby')).toBe('pb-need');
    expect(text('#pb-need')).toBe('Pick a flight out first');
    btn.click();
    expect(TestBed.inject(TripsService).trips()).toHaveLength(0);
    expect(el.querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('Your round trip');
    const ics = el.querySelector<HTMLButtonElement>('[data-ics]')!;
    expect(ics.getAttribute('aria-disabled')).toBe('true');
    expect(text('#' + ics.getAttribute('aria-describedby'))).toBe('Pick a flight out and a way home first');
    expect(text('[data-ics]')).toBe('Add to my calendar');
  });

  it('with no return day yet, offers the stay chips counted after you land', async () => {
    configurePlan();
    const { el, text, lastQuery, stable } = await renderPlan({ dep: DEP });
    expect(text('[data-dates]')).toContain('Fri, Nov 20 → pick a day home');
    expect(text('[data-change]')).toBe('Pick');
    expect(text('#pl-home')).toBe('When are you coming home?');
    expect(text('[data-side="home"]')).toBe('Home · pick a day');
    const chips = [...el.querySelectorAll<HTMLButtonElement>('app-stay-chips [role="radio"][data-nights]')];
    expect(chips.map(c => c.dataset['nights'])).toEqual(['2', '3', '4', '5', '7']);
    chips[2].click();
    expect(lastQuery()).toEqual({ ret: '2026-11-24' });
    await stable();
    expect(text('[aria-live="polite"]')).toBe('3 ways home on Tuesday, November 24');
  });

  it('a day with no way home after you land lists the nearest days', async () => {
    configurePlan();
    // Nothing leaves Lisbon on Sundays: the nearest days are Sat 28 and Mon 30.
    const { el, text, lastQuery } = await renderPlan({ dep: DEP, ret: '2026-11-29', out: 'AC834' });
    expect(text('[data-empty="home"]')).toContain('No ways home on Sun, Nov 29 after you land');
    expect(text('[data-empty="home"]')).toContain('Nearest:');
    const near = [...el.querySelectorAll<HTMLButtonElement>('[data-empty="home"] .near button')];
    expect(near.map(b => b.textContent!.trim())).toEqual(['Sat, Nov 28 · 3 home', 'Mon, Nov 30 · 3 home']);
    near[1].click();
    expect(lastQuery()).toEqual({ ret: '2026-11-30' });
  });

  it('downloads the round trip .ics once both flights are picked', async () => {
    configurePlan();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:x') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const { el } = await renderPlan({ dep: DEP, ret: RET, out: 'AC834', back: 'AC837' });
    const ics = el.querySelector<HTMLButtonElement>('[data-ics]')!;
    expect(ics.disabled).toBe(false);
    ics.click();
    expect(names).toEqual(['ac-YUL-LIS-2026-11-20_2026-11-28.ics']);
  });

  it('a date past the published window shows the not-yet-published card instead of redirecting', async () => {
    configurePlan();
    const { el, text, nav } = await renderPlan({ dep: '2027-04-02' });
    expect(text('[data-unpublished]')).toContain('Not yet published');
    expect(text('[data-unpublished]')).toContain('Schedules end Mar 28, 2027. Pick an earlier day.');
    expect(nav).not.toHaveBeenCalled();
    expect(el.querySelector('app-plan-bar')).toBeNull();
  });

  it('before the season starts: one sentence with Go', async () => {
    configurePlan();
    const { el, text, lastQuery } = await renderPlan({ code: 'OPO', dep: DEP });
    expect(text('[data-empty="out"]')).toBe('Next flight out: Tue, Jan 5, 2027 Go');
    el.querySelector<HTMLButtonElement>('[data-empty="out"] button')!.click();
    expect(lastQuery()).toEqual({ dep: '2027-01-05' });
  });

  it('no flights out that day: says so, with the next day', async () => {
    configurePlan();
    const { el, text, lastQuery } = await renderPlan({ dep: '2026-11-21' });
    expect(text('[data-empty="out"]')).toBe('No flights out on Sat, Nov 21 · next: Sun, Nov 22 Go');
    el.querySelector<HTMLButtonElement>('[data-empty="out"] button')!.click();
    expect(lastQuery()).toEqual({ dep: '2026-11-22' });
  });

  it('a missing or past departure goes back to the picker', async () => {
    configurePlan();
    const a = await renderPlan({});
    expect(a.nav).toHaveBeenCalledWith(['/calendar', 'LIS'], { queryParams: expect.any(Object), replaceUrl: true });
    TestBed.resetTestingModule();
    configurePlan();
    const b = await renderPlan({ dep: '2026-11-01' });
    expect(b.nav).toHaveBeenCalledWith(['/calendar', 'LIS'], { queryParams: expect.any(Object), replaceUrl: true });
  });

  it('a legacy ?nights= reads as dep + N', async () => {
    configurePlan();
    const { text, nav } = await renderPlan({ dep: DEP, nights: '4' });
    expect(text('#pl-home')).toBe('Ways home · Tue, Nov 24');
    expect(text('[data-dates]')).toContain('4 nights');
    // Rewritten to ?ret= at once, so a later departure move can't shift the return through ?nights.
    expect(nav).toHaveBeenCalledWith([], {
      queryParams: { ret: '2026-11-24', nights: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
  });
});
