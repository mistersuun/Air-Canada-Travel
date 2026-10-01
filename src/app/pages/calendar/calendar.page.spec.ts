import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { CalendarPage } from './calendar.page';

/** Wed Oct 7 2026, 08:00 in Montréal. */
const CLOCK = Date.parse('2026-10-07T12:00:00Z');

function configure(prefs: object = { hub: 'YUL', showConnections: false }) {
  const storage = new MemoryStorage();
  storage.setItem('ac.prefs.v1', JSON.stringify(prefs));
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK }],
  });
}

async function render(inputs: { code?: string; dep?: string; ret?: string } = {}) {
  const fixture = TestBed.createComponent(CalendarPage);
  const ref = fixture.componentRef;
  for (const k of ['code', 'dep', 'ret'] as const) if (inputs[k] !== undefined) ref.setInput(k, inputs[k]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel: string) => (el.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const day = (key: string) => el.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
  return { fixture, el, nav, stable, text, day, cmp: fixture.componentInstance, state: TestBed.inject(AppStateService) };
}

describe('CalendarPage', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('shows the chooser without a code: favourites first, search filters', async () => {
    configure({ hub: 'YUL', favourites: ['LHR'] });
    const { el, stable, cmp } = await render();
    expect(el.querySelector('h1')?.textContent).toBe('Calendar');
    expect(el.querySelector('[data-search-input]')).not.toBeNull();
    const lists = el.querySelectorAll('.ch__l');
    expect(lists).toHaveLength(2);
    expect([...lists[0].querySelectorAll('app-dest-row')].map(r => r.querySelector('small')?.textContent)).toEqual(['LHR']);
    expect(lists[0].querySelector('a')?.getAttribute('href')).toContain('/calendar/LHR');
    expect([...lists[1].querySelectorAll('small')].map(s => s.textContent)).toEqual(['ATH']);
    cmp.query.set('zzz');
    await stable();
    expect(el.querySelector('.ch__none')?.textContent).toContain('zzz');
  });

  it('renders the picker: title, months from today, bars, past days disabled', async () => {
    configure();
    const { el, text, day } = await render({ code: 'LHR' });
    expect(text('h1')).toContain('YUL → LHR');
    // Oct–Dec eager; the rest are deferred placeholders.
    expect(el.querySelectorAll('app-cal-month')).toHaveLength(3);
    expect(el.querySelectorAll('.mo--ph')).toHaveLength(3);
    expect(text('app-cal-month .mh')).toBe('October 2026');
    expect(day('2026-10-06').getAttribute('aria-disabled')).toBe('true');
    expect(day('2026-10-06').querySelector('.bar')).toBeNull();
    expect(day('2026-10-07').classList).toContain('today');
    expect(day('2026-10-08').querySelector<HTMLElement>('.bar i')!.style.width).toMatch(/^33\.3/);
    expect(day('2026-10-08').getAttribute('aria-label')).toBe('Thursday, October 8, 1 departure');
    expect(text('.ft .ui-btn')).toBe('Select a departure date');
    expect(el.querySelector<HTMLButtonElement>('.ft .ui-btn')!.disabled).toBe(true);
    expect(el.querySelector('.lg__b--c')).toBeNull();
  });

  it('picks depart then return, writes ?dep/?ret, and switches to return availability', async () => {
    configure();
    const { nav, stable, text, day, cmp } = await render({ code: 'LHR' });
    day('2026-10-08').click();
    await stable();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: '2026-10-08', ret: null }, queryParamsHandling: 'merge', replaceUrl: true,
    });
    expect(cmp.dir()).toEqual({ from: 'LHR', to: 'YUL' });
    expect(day('2026-10-08').getAttribute('aria-label')).toBe('Thursday, October 8, 1 return departure');
    expect(day('2026-10-08').classList).toContain('s');
    expect(text('.ft .ui-btn')).toBe('Select Thu, Oct 8 · one way');
    day('2026-10-15').click();
    await stable();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: '2026-10-08', ret: '2026-10-15' }, queryParamsHandling: 'merge', replaceUrl: true,
    });
    expect(day('2026-10-15').classList).toContain('e');
    expect(day('2026-10-10').classList).toContain('mid');
    expect(text('.ft .ui-btn')).toBe('Select Oct 8 – 15 · 7 nights');
    expect(text('.fld:nth-child(2) b')).toBe('Thu, Oct 15');
    // Past days do nothing.
    nav.mockClear();
    day('2026-10-02').click();
    expect(nav).not.toHaveBeenCalled();
  });

  it('reads ?dep and ?ret, ignoring invalid ones', async () => {
    configure();
    const a = await render({ code: 'LHR', dep: '2026-10-08', ret: '2026-10-15' });
    expect(a.cmp.sel()).toEqual({ dep: '2026-10-08', ret: '2026-10-15', active: 'ret' });
    a.fixture.componentRef.setInput('dep', '2026-10-01');
    await a.stable();
    expect(a.cmp.sel()).toEqual({ dep: null, ret: null, active: 'dep' });
    a.fixture.componentRef.setInput('dep', '2026-10-20');
    await a.stable();
    expect(a.cmp.sel().ret).toBeNull();
  });

  it('switches fields, and the return field needs a departure', async () => {
    configure();
    const { cmp, el, stable } = await render({ code: 'LHR' });
    cmp.setField('ret');
    expect(cmp.sel().active).toBe('dep');
    cmp.pick('2026-10-09');
    cmp.setField('dep');
    await stable();
    expect(el.querySelector('.fld.on .fld__l')?.textContent).toBe('Depart');
    expect(cmp.dir()).toEqual({ from: 'YUL', to: 'LHR' });
  });

  it('Done opens the flight page with ?ret and moves the app week', async () => {
    configure();
    const { cmp, nav, state, el, stable } = await render({ code: 'LHR', dep: '2026-10-20', ret: '2026-10-27' });
    el.querySelector<HTMLButtonElement>('.tb .lnk--b')!.click();
    await stable();
    expect(state.selectedDateKey()).toBe('2026-10-20');
    expect(nav).toHaveBeenLastCalledWith(['/flight', 'LHR', '2026-10-20'], {
      queryParams: expect.objectContaining({ ret: '2026-10-27', day: '2026-10-20' }),
    });
    nav.mockClear();
    cmp.pick('2026-10-08'); // restart: one way
    cmp.done();
    expect(nav).toHaveBeenLastCalledWith(['/flight', 'LHR', '2026-10-08'], {
      queryParams: expect.not.objectContaining({ ret: expect.anything() }),
    });
  });

  it('Cancel goes back, falling back to the destination', async () => {
    configure();
    const { el, state } = await render({ code: 'LHR' });
    const back = vi.spyOn(state, 'goBack').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('.tb .lnk')!.click();
    expect(back).toHaveBeenCalledWith(['/to', 'LHR']);
  });

  it('moves the roving focus with the keyboard, clamped to the rendered range', async () => {
    configure();
    const { cmp, day, stable } = await render({ code: 'LHR' });
    expect(cmp.focusKey()).toBe('2026-10-07');
    expect(day('2026-10-07').tabIndex).toBe(0);
    const press = async (key: string, from: string) => {
      day(from).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await stable();
    };
    await press('ArrowDown', '2026-10-07');
    expect(cmp.focusKey()).toBe('2026-10-14');
    expect(document.activeElement === day('2026-10-14') || day('2026-10-14').tabIndex === 0).toBe(true);
    await press('PageDown', '2026-10-14');
    expect(cmp.focusKey()).toBe('2026-11-14');
    await press('ArrowUp', '2026-10-01');
    expect(cmp.focusKey()).toBe('2026-10-01');
    await press('x', '2026-10-01');
    expect(cmp.focusKey()).toBe('2026-10-01');
  });

  it('shows the connection legend and amber bars when connections are on', async () => {
    configure({ hub: 'YHZ', showConnections: true });
    const { el, day } = await render({ code: 'LHR' });
    expect(el.querySelector('.lg__b--c')).not.toBeNull();
    expect(day('2026-10-08').querySelector('.bar i.cn')).not.toBeNull();
    expect(day('2026-10-08').getAttribute('aria-label')).toContain('connection only');
  });
});
