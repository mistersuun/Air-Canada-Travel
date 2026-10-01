import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { ShareService } from '../../state/share.service';
import { MemoryStorage } from '../../state/testing';
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
    expect(cells(el)).toMatchObject({ Date: 'Oct 7', Flight: 'AC864', Aircraft: 'A330-300', Frequency: 'Daily' });
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

  it('Add to calendar downloads an .ics; picking a return enables the round trip', async () => {
    configure({ showConnections: false });
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((b: Blob) => (blobs.push(b), 'blob:x')) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const { el, stable, text } = await render();
    expect(el.querySelector('.acts')!.textContent).not.toContain('Round trip');
    el.querySelector<HTMLButtonElement>('.acts .ui-btn--dark')!.click();
    expect(names).toEqual(['ac-YUL-LHR-2026-10-07.ics']);
    expect(await read(blobs[0])).toContain('BEGIN:VCALENDAR');

    // Return: 4 nights from the Thu Oct 8 arrival → Mon Oct 12, LHR→YUL AC865.
    expect(text('app-return-panel .date')).toBe('Mon, Oct 12');
    const row = el.querySelector<HTMLButtonElement>('app-return-panel app-option-row button')!;
    expect(row.textContent).toContain('AC865');
    row.click();
    await stable();
    expect(row.getAttribute('aria-pressed')).toBe('true');
    const round = [...el.querySelectorAll<HTMLButtonElement>('.acts button')].find(b => b.textContent!.includes('Round trip'))!;
    round.click();
    expect(names[1]).toBe('ac-YUL-LHR-2026-10-07_2026-10-12.ics');
    const ics = await read(blobs[1]);
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBe(2);
  });

  it('nights presets write ?nights= and clear ?ret=; ?ret= from the calendar wins', async () => {
    configure();
    const a = await render({ nights: '7' });
    expect(a.text('app-return-panel .date')).toBe('Thu, Oct 15');
    const chips = [...a.el.querySelectorAll<HTMLButtonElement>('app-return-panel .chip')];
    expect(chips.find(c => c.getAttribute('aria-pressed') === 'true')!.textContent!.trim()).toBe('7 nights');
    chips[0].click();
    expect(a.nav).toHaveBeenCalledWith([], { queryParams: { nights: 2, ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    a.el.querySelector<HTMLButtonElement>('button[aria-label="One night more"]')!.click();
    expect(a.nav).toHaveBeenLastCalledWith([], { queryParams: { nights: 8, ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });

    TestBed.resetTestingModule();
    configure();
    const b = await render({ ret: '2026-10-20', nights: '3' });
    expect(b.text('app-return-panel .date')).toBe('Tue, Oct 20');
    expect(b.text('app-return-panel .when')).toContain('12 nights');
    expect(b.text('app-return-panel .when')).toContain('from the calendar');
  });

  it('If you miss this lists the later flight the same day', async () => {
    configure();
    const { el } = await render({ code: 'ATH' });
    const groups = [...el.querySelectorAll('.grp')].map(g => g.getAttribute('data-group'));
    expect(groups[0]).toBe('later');
    expect(el.querySelector('section[aria-labelledby="fl-miss"] app-option-row')!.textContent).toContain('AC922');
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
