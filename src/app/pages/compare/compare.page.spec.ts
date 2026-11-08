import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { CLIMATE_FETCH } from '../../recs/climate.service';
import { CLIMATE_FIXTURE } from '../../recs/testing/climate-fixture';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { ComparePage } from './compare.page';

/** Tue Oct 6 2026, 09:00 in Montréal. */
const CLOCK = Date.parse('2026-10-06T13:00:00Z');

describe('ComparePage', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    const storage = new MemoryStorage();
    storage.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', showConnections: false, favourites: ['LHR'] }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK },
        { provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE },
      ],
    });
  });
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  async function render(c?: string) {
    const fixture = TestBed.createComponent(ComparePage);
    if (c !== undefined) fixture.componentRef.setInput('c', c);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const flat = () => (el.textContent ?? '').replace(/\s+/g, ' ');
    return { fixture, el, nav, flat };
  }

  it('renders one column per valid code from ?c=, ignoring bad and repeated codes', async () => {
    const { el, flat } = await render('lhr,ZZZ,ATH,LHR');
    const cols = [...el.querySelectorAll('[data-col]')].map(c => c.getAttribute('data-col'));
    expect(cols).toEqual(['LHR', 'ATH']);
    expect(flat()).toContain('7 nonstops');
    expect(flat()).toContain('Flights this week');
    expect(flat()).toContain('Nonstops home this week');
    expect(el.querySelector('[data-empty]')).toBeNull();
    expect(el.querySelectorAll('[data-row="flights"].is-best')).toHaveLength(1);
    // Links to each destination page and its calendar.
    const hrefs = [...el.querySelectorAll('[data-col="ATH"] .links a')].map(a => a.getAttribute('href')!);
    expect(hrefs[0]).toMatch(/^\/to\/ATH/);
    expect(hrefs[1]).toMatch(/^\/calendar\/ATH/);
    // No passport set: no entry row.
    expect(el.querySelector('[data-row="entry"]')).toBeNull();
  });

  it('asks for at least two destinations and offers the picker', async () => {
    const { el } = await render('LHR');
    expect(el.querySelector('[data-empty]')!.textContent).toContain('at least two');
    expect(el.querySelectorAll('[data-col]')).toHaveLength(1);
    expect(el.querySelector('app-dest-picker')).not.toBeNull();
  });

  it('remove updates the URL (?c=)', async () => {
    const { el, nav } = await render('LHR,ATH');
    el.querySelector<HTMLButtonElement>('[data-col="LHR"] [data-remove]')!.click();
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { c: 'ATH' }, queryParamsHandling: 'merge', replaceUrl: true }));
  });

  it('Add opens the picker (without the shown ones) and a pick appends the code, up to three', async () => {
    const { fixture, el, nav } = await render('LHR,ATH');
    el.querySelector<HTMLButtonElement>('[data-add]')!.click();
    fixture.detectChanges();
    const picks = [...el.querySelectorAll('[data-pick]')].map(b => b.getAttribute('data-pick'));
    expect(picks.length).toBeGreaterThan(0);
    expect(picks).not.toContain('LHR');
    expect(picks).not.toContain('ATH');
    el.querySelector<HTMLButtonElement>('[data-pick]')!.click();
    const arg = nav.mock.calls[0][1] as { queryParams: { c: string } };
    expect(arg.queryParams.c.split(',').slice(0, 2)).toEqual(['LHR', 'ATH']);
    expect(arg.queryParams.c.split(',')).toHaveLength(3);
  });

  it('with three columns there is no Add, only the limit note', async () => {
    const { el, flat } = await render('LHR,ATH,LIS');
    expect(el.querySelector('[data-add]')).toBeNull();
    expect(flat()).toContain('up to 3 destinations');
  });

  it('the picker searches by city', async () => {
    const { fixture, el } = await render('LHR,ATH');
    el.querySelector<HTMLButtonElement>('[data-add]')!.click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('[data-pick-search]')!;
    input.value = 'lisbon';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('[data-pick]')].map(b => b.getAttribute('data-pick'))).toEqual(['LIS']);
  });
});
