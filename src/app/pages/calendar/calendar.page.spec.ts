import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource, type SchedulesMeta } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { resetItinerariesMemo } from '../../planner/round-trip';
import { RECENT_STORAGE, RecentService } from '../../state/recent.service';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { setLocale } from '../../i18n/locale';
import { CalendarPage } from './calendar.page';

/** Wed Oct 7 2026, 08:00 in Montréal. */
const CLOCK = Date.parse('2026-10-07T12:00:00Z');

const plain = (s: string) => s.replace(/[  ]/g, ' ');

function configure(prefs: object = { hub: 'YUL', showConnections: false }) {
  const storage = new MemoryStorage();
  storage.setItem('ac.prefs.v1', JSON.stringify(prefs));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: RECENT_STORAGE, useValue: new MemoryStorage() },
      { provide: NOW, useValue: () => CLOCK },
    ],
  });
}

type Inputs = { code?: string; dep?: string; ret?: string; out?: string; back?: string; trip?: string };

async function render(inputs: Inputs = {}) {
  const fixture = TestBed.createComponent(CalendarPage);
  const ref = fixture.componentRef;
  for (const k of ['code', 'dep', 'ret', 'out', 'back', 'trip'] as const) if (inputs[k] !== undefined) ref.setInput(k, inputs[k]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel: string) => plain((el.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim());
  const day = (key: string) => el.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
  const count = (key: string) => (day(key).querySelector('.c')?.textContent ?? '').trim();
  return { fixture, el, nav, stable, text, day, count, cmp: fixture.componentInstance, state: TestBed.inject(AppStateService) };
}

describe('CalendarPage', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    resetItinerariesMemo();
  });
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
    expect([...lists[1].querySelectorAll('.az__h')].map(h => h.textContent)).toEqual(['A']);   // grouped by letter
    expect(el.querySelector('[data-az]')).toBeNull();                                          // jump row only on the long list
    cmp.query.set('zzz');
    await stable();
    expect(el.querySelector('.ch__none')?.textContent).toContain('zzz');
  });

  it('from Home (?trip=round): titled as a round trip, recently viewed first', async () => {
    configure({ hub: 'YUL', favourites: ['LHR'] });
    TestBed.inject(RecentService).add('ATH');
    const { el } = await render({ trip: 'round', dep: '2026-10-20' });
    expect(el.querySelector('h1')?.textContent).toBe('Plan a round trip — where to?');
    expect(el.querySelector('.ch__s')?.textContent).toBe('Pick a destination, then the days you leave and fly home');
    const recent = el.querySelector('[data-recent]')!;
    expect([...recent.querySelectorAll('small')].map(x => x.textContent)).toEqual(['ATH']);
    expect(recent.querySelector('a')?.getAttribute('href')).toMatch(/^\/calendar\/ATH\?.*dep=2026-10-20/);
  });

  it('keeps a ?dep= from Home on the chooser links', async () => {
    configure({ hub: 'YUL', favourites: ['LHR'] });
    const { el } = await render({ dep: '2026-10-20' });
    expect(el.querySelector('.ch__l a')?.getAttribute('href')).toMatch(/^\/calendar\/LHR\?.*dep=2026-10-20/);
  });

  it('renders the picker: counts with shape markers, a visible step line and the flights-out banner', async () => {
    configure();
    const { el, text, day, count } = await render({ code: 'LHR' });
    expect(text('h1')).toContain('YUL → LHR');
    // Oct–Dec eager; the rest are deferred placeholders.
    expect(el.querySelectorAll('app-cal-month')).toHaveLength(3);
    expect(el.querySelectorAll('.mo--ph')).toHaveLength(3);
    expect(text('app-cal-month .mh')).toBe('October 2026');
    expect(text('app-cal-month .ms')).toBe('Nonstops: Mon, Tue, Wed, Thu, Fri, Sat, Sun');
    expect(el.querySelector('.bar')).toBeNull();
    expect(day('2026-10-06').getAttribute('aria-disabled')).toBe('true');
    expect(count('2026-10-06')).toBe('');
    expect(day('2026-10-07').classList).toContain('today');
    expect(count('2026-10-08')).toBe('1');
    expect(day('2026-10-08').querySelector('.dm--solid')).not.toBeNull();
    expect(day('2026-10-08').getAttribute('aria-label')).toBe('Thursday, October 8, 2026, 1 flight out, 1 with a connection hidden');
    expect(day('2026-10-08').getAttribute('aria-disabled')).toBeNull();
    // Every cell that shows a count carries a shape marker.
    for (const b of el.querySelectorAll<HTMLElement>('[data-key]')) {
      if ((b.querySelector('.c')?.textContent ?? '').trim()) {
        expect(b.querySelector('.dm--solid, .dm--dotted, .dm--none') ?? (b.classList.contains('dm--hatch') ? b : null)).not.toBeNull();
      }
    }
    const step = el.querySelector<HTMLElement>('[data-step]')!;
    expect(step.closest('.ui-sr-only')).toBeNull();
    expect(step.getAttribute('aria-live')).toBe('polite');
    expect(text('[data-step] .step__l')).toBe('1 of 2 · Tap the day you leave');
    expect(text('[data-banner] b')).toBe('Flights out · YUL → LHR');
    expect(text('.ft .ui-btn')).toBe('Tap the day you leave');
    expect(el.querySelector<HTMLButtonElement>('.ft .ui-btn')!.disabled).toBe(true);
    expect(text('[data-peek]')).toBe('Counts are scheduled flights, not seats');
    expect(el.querySelector<HTMLButtonElement>('.tb .lnk--b')!.disabled).toBe(true);
    expect(el.querySelector('app-stay-chips')).toBeNull();
  });

  it('picks depart then return, writes ?dep/?ret, and switches to ways home after the earliest arrival', async () => {
    configure();
    const { nav, stable, text, day, count, cmp, el } = await render({ code: 'LHR' });
    day('2026-10-08').click();
    await stable();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: '2026-10-08', ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    expect(cmp.dir()).toEqual({ from: 'LHR', to: 'YUL' });
    expect(text('[data-step] .step__l')).toBe('2 of 2 · Now tap the day you fly home');
    expect(text('[data-step] .step__s')).toBe('Tap an earlier day, or tap Leave, to change your departure');
    expect(text('[data-banner] b')).toBe('Flights home · LHR → YUL');
    expect(text('[data-banner] .bn__s')).toBe('Counted after the earliest arrival (Fri, Oct 9 10:00)');
    expect(text('.lg__h')).toBe('Ways home each day');
    // AC865 leaves at 12:10, before AC864 (22:10) has even left: the departure day has no way home.
    expect(count('2026-10-08')).toBe('–');
    expect(day('2026-10-08').classList).toContain('s');
    expect(day('2026-10-09').getAttribute('aria-label')).toBe('Friday, October 9, 2026, 1 way home, 1 night');
    // Days before the departure: no count, aria-disabled and the reason.
    expect(day('2026-10-07').getAttribute('aria-disabled')).toBe('true');
    expect(day('2026-10-07').getAttribute('aria-label')).toContain('before you leave');
    expect(count('2026-10-07')).toBe('');
    expect(text('.ft .ui-btn')).toBe('See flights · one way · Thu, Oct 8');
    expect(text('[data-peek]')).toBe('Leave Thu, Oct 8 · 1 flight · 22:10');
    expect(el.querySelectorAll('app-stay-chips [role="radio"]')).toHaveLength(6); // 5 stays + Other
    // Focus moves to the first day with a way home.
    expect(cmp.focusKey()).toBe('2026-10-09');

    day('2026-10-15').click();
    await stable();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: '2026-10-08', ret: '2026-10-15' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    expect(day('2026-10-15').classList).toContain('e');
    expect(day('2026-10-10').classList).toContain('mid');
    expect(text('.ft .ui-btn')).toBe('See flights · Oct 8 – 15 · 7 nights');
    expect(text('.fld:nth-child(2) b')).toBe('Thu, Oct 15');
    expect(text('[data-step] .step__l')).toBe('Dates set · tap Leave or Home to change one, or See flights');
    expect(text('[data-peek]')).toBe('Home Thu, Oct 15 · 7 nights · 1 way home · 12:10');
    expect(el.querySelector('app-stay-chips [role="radio"][data-nights="7"]')!.getAttribute('aria-checked')).toBe('true');
    // Past days do nothing.
    nav.mockClear();
    day('2026-10-02').click();
    expect(nav).not.toHaveBeenCalled();
  });

  it('sets the return from a stay chip', async () => {
    configure();
    const { nav, stable, el } = await render({ code: 'LHR', dep: '2026-10-08' });
    el.querySelector<HTMLButtonElement>('app-stay-chips [data-nights="4"]')!.click();
    await stable();
    expect(nav).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { dep: '2026-10-08', ret: '2026-10-12' } }));
  });

  it('says why a same-day return cannot be picked, and an earlier day changes the departure', async () => {
    configure();
    const { stable, text, day, cmp } = await render({ code: 'LHR', dep: '2026-10-08' });
    day('2026-10-08').click();
    await stable();
    expect(text('[data-peek]')).toBe('No way home the same day');
    expect(cmp.sel()).toEqual({ dep: '2026-10-08', ret: null, active: 'ret' });
    day('2026-10-07').click();
    await stable();
    expect(cmp.sel()).toEqual({ dep: '2026-10-07', ret: null, active: 'ret' });
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

  it('a return-day tap keeps the ways-home basis, so the months do not recount', async () => {
    configure();
    const { cmp, stable } = await render({ code: 'LHR', dep: '2026-10-08', ret: '2026-10-15' });
    const basis = cmp.home();
    expect(basis).not.toBeNull();
    cmp.pick('2026-10-16');
    await stable();
    expect(cmp.sel().ret).toBe('2026-10-16');
    expect(cmp.home()).toBe(basis);
  });

  it('drops a ?dep= on a day with no flights out, and says so', async () => {
    configure();
    const { cmp, text } = await render({ code: 'ATH', dep: '2026-10-08' });
    expect(cmp.sel().dep).toBeNull();
    expect(text('[data-peek]')).toBe('No flights to Athens on Thu, Oct 8 · pick a day');
  });

  it('switches fields, and the return field needs a departure', async () => {
    configure();
    const { cmp, el, stable, text } = await render({ code: 'LHR' });
    cmp.setField('ret');
    expect(cmp.sel().active).toBe('dep');
    cmp.pick('2026-10-09');
    cmp.setField('dep');
    await stable();
    expect(el.querySelector('.fld.on .fld__l')?.textContent).toBe('Leave');
    expect(cmp.dir()).toEqual({ from: 'YUL', to: 'LHR' });
    expect(text('[data-banner] b')).toBe('Flights out · YUL → LHR');
  });

  it('See flights opens /plan with ?dep, ?ret and the passed-through ?out / ?back, and moves the app week', async () => {
    configure();
    const { cmp, nav, state, el, stable } = await render({ code: 'LHR', dep: '2026-10-20', ret: '2026-10-27', out: 'AC864', back: 'AC865' });
    el.querySelector<HTMLButtonElement>('.ft .ui-btn')!.click();
    await stable();
    expect(state.selectedDateKey()).toBe('2026-10-20');
    expect(nav).toHaveBeenLastCalledWith(['/plan', 'LHR'], {
      queryParams: expect.objectContaining({ dep: '2026-10-20', ret: '2026-10-27', out: 'AC864', back: 'AC865', day: '2026-10-20' }),
    });
    nav.mockClear();
    cmp.pick('2026-10-08'); // restart: one way
    cmp.done();
    expect(nav).toHaveBeenLastCalledWith(['/plan', 'LHR'], {
      queryParams: expect.not.objectContaining({ ret: expect.anything(), back: expect.anything() }),
    });
    expect(nav.mock.lastCall![1]!.queryParams).toMatchObject({ dep: '2026-10-08', out: 'AC864' });
  });

  it('Clear resets the selection and the URL, and announces it', async () => {
    configure();
    const { cmp, nav, el, stable, text } = await render({ code: 'LHR', dep: '2026-10-20', ret: '2026-10-27' });
    const clear = el.querySelector<HTMLButtonElement>('.tb .lnk--b')!;
    expect(clear.textContent?.trim()).toBe('Clear');
    expect(clear.disabled).toBe(false);
    clear.click();
    await stable();
    expect(cmp.sel()).toEqual({ dep: null, ret: null, active: 'dep' });
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: null, ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    expect(text('[data-peek]')).toBe('Dates cleared');
    expect(clear.disabled).toBe(true);
  });

  it('a tap on a day with no flights explains it and offers the next day', async () => {
    configure();
    const { cmp, nav, stable, text, el, count } = await render({ code: 'ATH' });
    expect(count('2026-10-08')).toBe('–');
    expect(el.querySelector('[data-key="2026-10-08"] .dm--none')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-key="2026-10-08"]')!.click();
    await stable();
    expect(nav).not.toHaveBeenCalled();
    expect(cmp.sel().dep).toBeNull();
    expect(text('[data-peek]')).toBe('No flights out on Thu, Oct 8 · next: Fri, Oct 9 Go');
    el.querySelector<HTMLButtonElement>('.pe__go')!.click();
    await stable();
    expect(cmp.sel().dep).toBe('2026-10-09');
  });

  it('List view rows are the days the grid counts', async () => {
    configure();
    const { el, stable, cmp } = await render({ code: 'ATH' });
    const cellKeys = [...el.querySelectorAll<HTMLElement>('app-cal-month [data-key]')]
      .filter(b => /^\d+$/.test((b.querySelector('.c')?.textContent ?? '').trim()))
      .map(b => b.dataset['key']);
    el.querySelectorAll<HTMLButtonElement>('.vw app-seg button')[1].click();
    await stable();
    expect(cmp.view()).toBe('list');
    expect(el.querySelector('app-cal-month')).toBeNull();
    const rows = [...el.querySelectorAll<HTMLElement>('[data-list-key]')];
    expect(rows.map(r => r.dataset['listKey'])).toEqual(cellKeys);
    expect(plain(rows[0].textContent!.replace(/\s+/g, ' ').trim())).toBe('Wed, Oct 7 · 2 nonstop · 17:25, 21:30');
    rows[0].click();
    await stable();
    expect(cmp.sel().dep).toBe('2026-10-07');
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

  it('marks connections-only days dotted, and the banner toggles connections', async () => {
    configure({ hub: 'YHZ', showConnections: true });
    const { el, day, state, stable, text } = await render({ code: 'LHR' });
    expect(day('2026-10-08').querySelector('.dm--dotted')).not.toBeNull();
    expect(day('2026-10-08').getAttribute('aria-label')).toMatch(/flights? out, 0 nonstop and \d+ with a connection$/);
    // One labelled two-option toggle: fixed labels, the pressed one is what the counts include.
    const [all, nonstop] = [...el.querySelectorAll<HTMLButtonElement>('[data-conn] button')];
    expect(el.querySelector('[data-conn] [role="group"]')!.getAttribute('aria-label')).toBe('Flights counted');
    expect([all.textContent!.trim(), nonstop.textContent!.trim()]).toEqual(['All flights', 'Nonstop only']);
    expect([all.getAttribute('aria-pressed'), nonstop.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
    expect([...el.querySelectorAll('[data-key-line] span')].map(x => x.textContent!.trim())).toEqual(['has a nonstop', 'connections only']);
    nonstop.click();
    await stable();
    expect(state.showConnections()).toBe(false);
    expect([all.getAttribute('aria-pressed'), nonstop.getAttribute('aria-pressed')]).toEqual(['false', 'true']);
    expect(nonstop.textContent!.trim()).toBe('Nonstop only');
    expect(day('2026-10-08').querySelector('.dm--none')).not.toBeNull();
    expect(day('2026-10-08').getAttribute('aria-label')).toContain('with a connection hidden');
  });

  it('shows loading while schedules load', async () => {
    configure();
    const { state, stable, el, text, count } = await render({ code: 'LHR' });
    state.dataLoad.set('loading');
    await stable();
    expect(text('.ft .ui-btn')).toBe('Loading schedules…');
    expect(el.querySelector<HTMLButtonElement>('.ft .ui-btn')!.disabled).toBe(true);
    expect(el.querySelector('[role="grid"]')!.getAttribute('aria-busy')).toBe('true');
    expect(count('2026-10-08')).toBe('·');
  });
});

describe('CalendarPage on a seasonal route', () => {
  const META: SchedulesMeta = { generatedAt: '2026-09-28T06:00:00Z', coverageFrom: '2026-09-01', coverageTo: '2027-10-31' };
  beforeEach(() => {
    setScheduleSource([route('YUL', 'OPO', rec('AC844', '19:45', '07:30', '2027-06-02', '2027-10-15', 'Wed,Sat', '32N'))], META);
    resetItinerariesMemo();
  });
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('opens on the first flying month, and the step line gives the year', async () => {
    configure();
    const { cmp, el, text, stable } = await render({ code: 'OPO' });
    await stable();
    expect(cmp.focusKey()).toBe('2027-06-02');
    expect(text('.step__s--season')).toBe('First flights: Wed, Jun 2, 2027 Jump');
    expect(el.querySelector('#m-2027-06')).not.toBeNull();
    expect(el.querySelector('[data-key="2027-06-02"]')!.getAttribute('tabindex')).toBe('0');
  });
});

describe('CalendarPage in French', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    resetItinerariesMemo();
  });
  afterEach(() => {
    setLocale('en');
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('shows the chooser in French', async () => {
    configure({ hub: 'YUL', favourites: ['LHR'] });
    setLocale('fr');
    const { el, text } = await render();
    expect(el.querySelector('h1')?.textContent).toBe('Calendrier');
    expect(el.querySelector<HTMLInputElement>('[data-search-input]')!.placeholder).toBe('Rechercher des destinations');
    expect(text('.ch__s')).toContain('Choisissez une destination');
    expect(text('.ch__l')).toMatch(/prochain/);
    expect(text('.ch__l')).not.toMatch(/\bnext\b/);
  });

  it('labels the picker in French: fields, step line, banner, day cells and the button', async () => {
    configure();
    setLocale('fr');
    const { el, text } = await render({ code: 'LHR', dep: '2026-10-08', ret: '2026-10-15' });
    expect(text('.fld:nth-child(1) .fld__l')).toBe('Départ');
    expect(text('.fld:nth-child(2) .fld__l')).toBe('Retour');
    expect(text('.tb .lnk')).toBe('Annuler');
    expect(text('.tb .lnk--b')).toBe('Effacer');
    expect(text('[data-step] .step__l')).toBe('Dates choisies · touchez Départ ou Retour pour en changer une, ou Voir les vols');
    expect(text('[data-banner] b')).toBe('Vols de retour · LHR → YUL');
    expect(text('[data-banner] .bn__s')).toBe('Comptés après la première arrivée (ven. 9 oct. 10:00)');
    expect(text('.ft .ui-btn')).toBe('Voir les vols · 8–15 oct. · 7 nuits');
    expect(text('[data-peek]')).toBe('Retour le jeu. 15 oct. · 7 nuits · 1 retour · 12:10');
    expect(plain(el.querySelector('[data-key="2026-10-07"]')!.getAttribute('aria-label')!)).toBe('mercredi 7 octobre 2026, avant le départ');
    // The departure and return say which they are; days between say they are in the stay.
    expect(plain(el.querySelector('[data-key="2026-10-08"]')!.getAttribute('aria-label')!)).toMatch(/, votre départ$/);
    expect(plain(el.querySelector('[data-key="2026-10-15"]')!.getAttribute('aria-label')!)).toMatch(/, votre retour$/);
    expect(plain(el.querySelector('[data-key="2026-10-09"]')!.getAttribute('aria-label')!)).toBe('vendredi 9 octobre 2026, 1 retour, 1 nuit, pendant le séjour');
    expect(text('.lg__s')).toBe('Légende');
    expect(text('.lg__h')).toBe('Retours par jour');
    expect(text('.vw app-seg')).toBe('Calendrier Liste');
  });

  it('words the empty picker in French', async () => {
    configure();
    setLocale('fr');
    const { text } = await render({ code: 'LHR' });
    expect(text('[data-step] .step__l')).toBe('1 sur 2 · Touchez le jour du départ');
    expect(text('[data-banner] b')).toBe('Vols aller · YUL → LHR');
    expect(text('[data-conn]')).toBe('Tous les vols Sans escale seulement');
    expect(text('.ft .ui-btn')).toBe('Touchez le jour du départ');
    expect(text('[data-peek]')).toBe('Les nombres sont des vols prévus, pas des places');
  });
});
