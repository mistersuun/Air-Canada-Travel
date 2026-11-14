import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { ShareService } from '../../state/share.service';
import { MemoryStorage } from '../../state/testing';
import { setLocale } from '../../i18n/locale';
import { homeAfterUtc, waysHome } from '../../planner/round-trip';
import { FlightPage } from './flight.page';

/** Wed Oct 7 2026, 08:00 in Montréal. */
const CLOCK = Date.parse('2026-10-07T12:00:00Z');

interface Inputs {
  code?: string;
  date?: string;
  flight?: string;
  pick?: string;
  ret?: string;
  nights?: string;
}

function configure(prefs?: object) {
  const storage = new MemoryStorage();
  if (prefs) storage.setItem('ac.prefs.v1', JSON.stringify(prefs));
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK }],
  });
}

async function render(inputs: Inputs = {}) {
  const fixture = TestBed.createComponent(FlightPage);
  const ref = fixture.componentRef;
  ref.setInput('code', inputs.code ?? 'LHR');
  ref.setInput('date', inputs.date ?? '2026-10-07');
  for (const k of ['flight', 'pick', 'ret', 'nights'] as const) if (inputs[k] !== undefined) ref.setInput(k, inputs[k]);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel?: string) => ((sel ? el.querySelector(sel) : el)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, el, nav, stable, text, cmp: fixture.componentInstance, state: TestBed.inject(AppStateService) };
}

function read(b: Blob): Promise<string> {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });
}

function cells(el: HTMLElement): Record<string, string> {
  return Object.fromEntries([...el.querySelectorAll('app-ticket .cells div')].map(d => [
    d.querySelector('dt')!.textContent!.trim(), d.querySelector('dd')!.textContent!.trim(),
  ]));
}

describe('FlightPage', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('renders the ticket for the earliest flight, with the countdown', async () => {
    configure({ showConnections: false });
    const { el, text } = await render();
    expect(text('h1')).toBe('Flight details');
    expect(text('.tk .io')).toBe('YUL');
    expect([...el.querySelectorAll('.tk .io')].map(n => n.textContent)).toEqual(['YUL', 'LHR']);
    expect(text('.tk .hd .ui-tag')).toBe('NON-STOP');
    expect(text('.tk .times')).toContain('22:10');
    expect(text('.tk .times')).toContain('Thu, Oct 8 · local');
    expect(cells(el)).toMatchObject({ Date: 'Oct 7', Flight: 'AC864', Aircraft: 'A330-300 · about 297 seats', Frequency: 'Daily' });
    expect(text('.cd')).toBe('Departs today · in 14h 10m');
    // The seg lights EARLIEST; NONSTOP is enabled since a nonstop exists.
    const seg = [...el.querySelectorAll<HTMLButtonElement>('app-seg button')];
    expect(seg.map(b => b.textContent!.trim())).toEqual(['EARLIEST', 'NONSTOP', 'FASTEST']);
    expect(seg[0].getAttribute('aria-pressed')).toBe('true');
    expect(seg[1].disabled).toBe(false);
    // The week strip shows the week of the date, with the date selected.
    expect(el.querySelector('app-week-strip')).toBeTruthy();
  });

  it('an explicit slug wins over pick; a bad slug falls back to earliest', async () => {
    configure();
    const a = await render({ code: 'ATH', flight: 'AC922', pick: 'earliest' });
    expect(cells(a.el)['Flight']).toBe('AC922');
    TestBed.resetTestingModule();
    configure();
    const b = await render({ code: 'ATH', flight: 'AC1' });
    expect(cells(b.el)['Flight']).toBe('AC898');
  });

  it('a seg choice navigates to its slug with ?pick= (replaceUrl)', async () => {
    configure();
    const { el, nav, stable } = await render({ code: 'ATH' });
    // Other options lists the second flight that day.
    expect(el.querySelectorAll('app-option-row').length).toBeGreaterThan(0);
    el.querySelectorAll<HTMLButtonElement>('app-seg button')[2].click();
    await stable();
    expect(nav).toHaveBeenCalledWith(['/flight', 'ATH', '2026-10-07', 'AC898'], {
      queryParams: { pick: 'fastest' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
  });

  it('a day chip moves the date and drops the slug', async () => {
    configure();
    const { cmp, nav } = await render({ flight: 'AC864' });
    cmp.goDate('2026-10-09');
    expect(nav).toHaveBeenCalledWith(['/flight', 'LHR', '2026-10-09'], { queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    nav.mockClear();
    cmp.goDate('2026-10-07');
    cmp.goDate(null);
    expect(nav).not.toHaveBeenCalled();
  });

  it('a connection shows each leg and the layover strip', async () => {
    configure({ hub: 'YHZ', showConnections: true });
    const { el, text } = await render({ flight: 'AC603+AC848' });
    expect(text('.tk .hd .ui-tag')).toBe('1 STOP · YYZ');
    expect([...el.querySelectorAll('.tk .leg')].map(n => n.textContent!.trim())).toEqual(['YHZ → YYZ', 'YYZ → LHR']);
    expect(el.querySelectorAll('.tk .cells').length).toBe(2);
    expect(text('.tk .lay')).toBe('2h 30m in Toronto');
    // NONSTOP is disabled: no direct YHZ→LHR.
    expect(el.querySelectorAll<HTMLButtonElement>('app-seg button')[1].disabled).toBe(true);
  });

  it('Add to calendar downloads a one-way .ics; there is no round-trip .ics or "Round trip ready" here', async () => {
    configure({ showConnections: false });
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((b: Blob) => (blobs.push(b), 'blob:x')) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const { el, text } = await render();
    expect(el.querySelector('.acts')!.textContent).not.toContain('Round trip');
    expect(text()).not.toContain('Round trip ready');
    el.querySelector<HTMLButtonElement>('.acts .ui-btn--dark')!.click();
    expect(names).toEqual(['ac-YUL-LHR-2026-10-07.ics']);
    expect(await read(blobs[0])).toContain('BEGIN:VCALENDAR');
    // The Coming home card sits right after the actions.
    expect(el.querySelector('.acts + app-return-summary')).not.toBeNull();
  });

  it('If you miss this lists the later flight the same day', async () => {
    configure();
    const { el } = await render({ code: 'ATH' });
    const groups = [...el.querySelectorAll('.grp')].map(g => g.getAttribute('data-group'));
    expect(groups[0]).toBe('later');
    expect(el.querySelector('section[aria-labelledby="fl-miss"] app-option-row')!.textContent).toContain('AC922');
    expect(el.querySelector("[data-miss-summary]")!.textContent).toBe("After this: 1 more option today, the last at 21:30. None the next day.");
  });

  it('no flights that day: empty card with the next nonstop date', async () => {
    configure({ showConnections: false });
    const { el, text } = await render({ code: 'ATH', date: '2026-10-06' });
    expect(el.querySelector('app-ticket')).toBeNull();
    expect(text('.state h2')).toBe('No flights on Tue, Oct 6');
    expect(text('.state')).toContain('Wed, Oct 7');
    expect(el.querySelector('section[aria-labelledby="fl-ret"]')).toBeNull();
  });

  it('outside coverage: says not published and recovers to the last published week', async () => {
    setScheduleSource([route('YUL', 'LHR', rec('AC864', '22:10', '10:00', '2026-09-01', '2026-10-20'))], FIXTURE_META);
    configure();
    const { el, text, nav, state } = await render({ date: '2026-11-04' });
    expect(text('.state h2')).toBe("Schedules for Wed, Nov 4 aren't published yet");
    expect(text()).not.toContain('No flights');
    const jump = vi.spyOn(state, 'jumpToCoverage');
    el.querySelector<HTMLButtonElement>('.state .ui-btn')!.click();
    expect(jump).toHaveBeenCalledWith('2026-10-07');
    expect(nav).toHaveBeenCalledWith(['/flight', 'LHR', '2026-10-07'], { queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  });

  it('back falls back to the destination; share uses the share service', async () => {
    configure();
    const { el, state } = await render();
    const back = vi.spyOn(state, 'goBack').mockImplementation(() => undefined);
    const share = vi.spyOn(TestBed.inject(ShareService), 'share').mockResolvedValue();
    el.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click();
    expect(back).toHaveBeenCalledWith(['/to', 'LHR']);
    el.querySelector<HTMLButtonElement>('button[aria-label="Share this flight"]')!.click();
    expect(share).toHaveBeenCalledWith('London · Wed, Oct 7');
  });

  it('connections off: nonstops only, unless the slug names a connection', async () => {
    setScheduleSource([
      ...FIXTURE_ROUTES,
      route('YUL', 'YYZ', rec('AC400', '14:00', '15:15', '2026-09-01', '2027-03-31')),
    ], FIXTURE_META);
    configure({ showConnections: false });
    const a = await render();
    expect(a.cmp.itineraries().every(i => !i.hubs.length)).toBe(true);
  });
});

/**
 * The Lisbon world of planner/round-trip.spec: AC834 YUL 22:10 → LIS 08:15⁺¹
 * Mon/Wed/Fri/Sun, AC832 Tue/Thu, AC830 Fri; LIS→YUL AC835 07:10, AC837
 * 10:40, AC839 13:00 daily, plus AC831 08:45 and AC833 09:15 on Sat Nov 21.
 */
const LIS_ROUTES = [
  route('YUL', 'LIS',
    rec('AC834', '22:10', '08:15', '2026-09-01', '2027-03-28', 'Mon,Wed,Fri,Sun', '333'),
    rec('AC832', '21:55', '08:00', '2026-09-01', '2027-03-28', 'Tue,Thu', '333'),
    rec('AC830', '18:05', '04:05', '2026-09-01', '2027-03-28', 'Fri', '789'),
  ),
  route('LIS', 'YUL',
    rec('AC835', '07:10', '09:10', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', '333'),
    rec('AC837', '10:40', '12:40', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', '333'),
    rec('AC839', '13:00', '15:00', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', '333'),
    rec('AC831', '08:45', '10:45', '2026-11-21', '2026-11-21', 'Sat', '333'),
    rec('AC833', '09:15', '11:15', '2026-11-21', '2026-11-21', 'Sat', '333'),
  ),
];
const LIS_META = { generatedAt: '2026-11-01T06:00:00Z', coverageFrom: '2026-09-01', coverageTo: '2027-03-28' };
/** Sat Nov 14 2026, 10:00 in Montréal. */
const LIS_CLOCK = Date.parse('2026-11-14T15:00:00Z');
const NAV = { queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' } as const;

describe('FlightPage · Coming home (dates-spec §3.4)', () => {
  beforeEach(() => setScheduleSource(LIS_ROUTES, LIS_META));
  afterEach(() => {
    setLocale('en');
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  function setup(prefs: object = { showConnections: false }) {
    const storage = new MemoryStorage();
    storage.setItem('ac.prefs.v1', JSON.stringify(prefs));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => LIS_CLOCK }],
    });
  }
  const lis = (inputs: Inputs = {}) => render({ code: 'LIS', date: '2026-11-20', flight: 'AC834', ...inputs });

  it('the LIS Nov 20–28 card says 8 nights, the rule after landing and the first three times', async () => {
    setup();
    const { text, el } = await lis({ ret: '2026-11-28' });
    expect(text('app-return-summary h2')).toBe('Coming home');
    expect(text('[data-ret-line]')).toBe('Sat, Nov 28 · 8 nights · 3 ways home');
    expect(text('app-return-summary .l2')).toBe('after this flight lands (Sat, Nov 21 08:15)');
    expect(text('[data-ret-times]')).toBe('07:10 AC835 · 10:40 AC837 · 13:00 AC839');
    expect(el.querySelector('app-return-summary app-stay-chips')).toBeNull();
  });

  it('"Plan round trip" opens /plan with dep, ret and this flight', async () => {
    setup();
    const { el } = await lis({ ret: '2026-11-28' });
    const a = el.querySelector<HTMLAnchorElement>('[data-plan-round]')!;
    expect(a.textContent!.trim()).toBe('Plan round trip');
    expect(a.getAttribute('href')).toBe('/plan/LIS?from=YUL&dep=2026-11-20&ret=2026-11-28&out=AC834');
  });

  it('the card count equals the ways-home list /plan shows for the same outbound (parity)', async () => {
    setup({ showConnections: false, minConnect: 60 });
    const { text, cmp } = await lis({ ret: '2026-11-21' });
    const out = cmp.current()!;
    const ctx = cmp.countCtx();
    const rows = waysHome('LIS', 'YUL', '2026-11-21', ctx, homeAfterUtc(out, [], ctx.connect));
    // AC835 07:10 leaves before landing and AC831 08:45 within the hour: AC833, AC837, AC839 remain.
    expect(rows.map(r => r.legs[0].flightNumber)).toEqual(['AC833', 'AC837', 'AC839']);
    expect(text('[data-ret-line]')).toBe(`Sat, Nov 21 · 1 night · ${rows.length} ways home`);
    for (const ret of ['2026-11-22', '2026-11-28', '2026-12-04']) {
      const n = waysHome('LIS', 'YUL', ret, ctx, homeAfterUtc(out, [], ctx.connect)).length;
      const r = await (TestBed.resetTestingModule(), setup({ showConnections: false, minConnect: 60 }), lis({ ret }));
      expect(r.text('[data-ret-line]')).toContain(`${n} ways home`);
    }
  });

  it('a legacy ?nights=4 on Nov 20 resolves to Tue, Nov 24 and is rewritten to ?ret (P3)', async () => {
    setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { text } = await lis({ nights: '4' });
    expect(text('[data-ret-line]')).toBe('Tue, Nov 24 · 4 nights · 3 ways home');
    expect(nav).toHaveBeenCalledWith([], { queryParams: { ret: '2026-11-24', nights: null }, ...NAV });
  });

  it('without a return day: stay chips count ways home after landing, and a chip writes ?ret', async () => {
    setup();
    const { el, text, nav } = await lis();
    expect(text('app-return-summary .q')).toBe('When are you coming home?');
    const chips = [...el.querySelectorAll<HTMLButtonElement>('app-return-summary [role="radio"][data-nights]')];
    expect(chips.map(c => c.dataset['nights'])).toEqual(['2', '3', '4', '5', '7']);
    expect(chips[2].textContent!.replace(/\s+/g, ' ').trim()).toBe('4 nights Tue 24 · 3 home');
    chips[2].click();
    expect(nav).toHaveBeenCalledWith([], { queryParams: { ret: '2026-11-24', nights: null }, ...NAV });
    const plan = el.querySelector<HTMLAnchorElement>('[data-plan-round]')!;
    expect(plan.getAttribute('href')).toBe('/plan/LIS?from=YUL&dep=2026-11-20&out=AC834');
  });

  it('a day with no way home after landing says so and offers the nearest days', async () => {
    setup();
    const { el, text, nav } = await lis({ ret: '2026-11-20' });
    expect(text('[data-ret-line]')).toBe('Fri, Nov 20 · 0 nights · 0 ways home');
    expect(text('[data-ret-zero]')).toBe('No ways home on Fri, Nov 20 after you land');
    const near = [...el.querySelectorAll<HTMLButtonElement>('app-return-summary .near button')];
    expect(near.map(b => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Sat, Nov 21 · 3 home', 'Sun, Nov 22 · 3 home']);
    near[1].click();
    expect(nav).toHaveBeenCalledWith([], { queryParams: { ret: '2026-11-22', nights: null }, ...NAV });
  });

  it('the week strip shows flights out per day instead of dots', async () => {
    setup();
    const { el } = await lis({ ret: '2026-11-28' });
    const cts = [...el.querySelectorAll('app-week-strip .ct')].map(c => c.textContent!.trim());
    // Mon 16 … Sun 22: AC834 Mon/Wed/Fri/Sun, AC832 Tue/Thu, AC830 Fri; no nonstop on Saturday.
    expect(cts).toEqual(['1', '1', '1', '1', '2', '–', '1']);
    expect(el.querySelector('app-week-strip .dt')).toBeNull();
  });

  it('Change dates opens the picker with dep, ret and this flight', async () => {
    setup();
    const { el } = await lis({ ret: '2026-11-28' });
    const a = [...el.querySelectorAll<HTMLAnchorElement>('.acts a')].find(x => x.textContent!.includes('Change dates'))!;
    expect(a.getAttribute('href')).toBe('/calendar/LIS?from=YUL&dep=2026-11-20&ret=2026-11-28&out=AC834');
  });

  it('moving the day past the return keeps the nights and says so', async () => {
    setup();
    const { cmp, nav, state } = await lis({ ret: '2026-11-22' });
    const flash = vi.spyOn(state, 'flash');
    cmp.goDate('2026-11-23');
    expect(nav).toHaveBeenCalledWith(['/flight', 'LIS', '2026-11-23'], { queryParams: { ret: '2026-11-25', nights: null }, ...NAV });
    expect(flash).toHaveBeenCalledWith('Home moved to Wed, Nov 25 to keep 2 nights');
    cmp.goDate('2026-11-21');
    expect(nav).toHaveBeenLastCalledWith(['/flight', 'LIS', '2026-11-21'], NAV);
  });

  it('reads in Canadian French', async () => {
    setup();
    setLocale('fr');
    const { text } = await lis({ ret: '2026-11-28' });
    expect(text('app-return-summary h2')).toBe('Retour');
    expect(text('[data-ret-line]')).toBe('sam. 28 nov. · 8 nuits · 3 retours');
    expect(text('[data-plan-round]')).toBe('Planifier l’aller-retour');
    expect(text()).not.toMatch(/Coming home|ways home|Plan round trip/);
  });
});

describe('FlightPage in French', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => {
    setLocale('en');
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('renders the ticket, countdown and sections in Canadian French', async () => {
    configure({ showConnections: false });
    setLocale('fr');
    const { el, text } = await render();
    expect(text('h1')).toBe('Détails du vol');
    expect(text('.tk .hd .ui-tag')).toBe('SANS ESCALE');
    expect(Object.keys(cells(el))).toEqual(['Date', 'Vol', 'Appareil', 'Durée', 'Fréquence', 'Décalage']);
    expect(text('.cd')).toMatch(/^Départ aujourd'hui · dans \d/);
    expect(el.querySelector('[aria-label="Partager ce vol"]')).not.toBeNull();
    expect(text()).toContain('Si vous manquez ce vol');
    expect(text()).toContain('Horaires publiés seulement');
    expect(text()).not.toMatch(/Flight details|Departs|If you miss|Round trip|Other options|Schedules, not seats|Show all/);
  });
});
