import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { ALL_DAYS, FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { PhotoService } from '../../state/photo.service';
import { ShareService } from '../../state/share.service';
import { MemoryStorage } from '../../state/testing';
import { addDays, toUtcMs } from '../../utils/time';
import { type CountCtx, homeAfterUtc, minuteOf, outboundsOn, waysHome } from '../../planner/round-trip';
import { DestinationPage } from './destination.page';

const NOW_MS = toUtcMs('2026-10-01', '12:00', 'America/Toronto');

describe('DestinationPage', () => {
  let fixture: ComponentFixture<DestinationPage>;
  let el: HTMLElement;
  let state: AppStateService;
  let share: { share: ReturnType<typeof vi.fn> };

  async function render(code: string, setup?: (s: AppStateService) => void, query: Record<string, string> = {}): Promise<void> {
    fixture = TestBed.createComponent(DestinationPage);
    el = fixture.nativeElement;
    state = TestBed.inject(AppStateService);
    setup?.(state);
    fixture.componentRef.setInput('code', code);
    for (const [k, v] of Object.entries(query)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
  }

  async function setQuery(query: Record<string, string | undefined>): Promise<void> {
    for (const [k, v] of Object.entries(query)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
  }

  function spyNav() {
    return vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  }

  function ctxOf(s: AppStateService): CountCtx {
    return {
      today: s.todayKey(), nowMinute: minuteOf(s.nowMs()), coverage: s.coverage(),
      showConnections: s.showConnections(), connect: s.connect(),
    };
  }

  const text = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const items = (sel: string) => el.querySelectorAll(`${sel} .ui-tl__it`);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    share = { share: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: ShareService, useValue: share },
      ],
    });
    TestBed.inject(PhotoService).setManifest({
      version: 1,
      photos: {
        LHR: {
          author: 'Colin', authorUrl: 'https://commons.example/User:Colin', source: 'wikimedia',
          sourceUrl: 'https://commons.example/LHR', license: 'CC BY-SA 4.0', licenseUrl: 'https://cc.example/by-sa/4.0',
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetScheduleSource();
  });

  it('renders the header: title, code, tags and the next departure', async () => {
    await render('LHR');
    expect(text('h1')).toBe('London LHR');
    expect(text('.head .ui-sub')).toBe('United Kingdom · Europe');
    const tags = [...el.querySelectorAll('.tags .ui-tag')].map(t => t.textContent!.trim());
    expect(tags[0]).toMatch(/^Nonstop · \d+h\d\d$/);
    expect(tags.slice(1)).toEqual(['Daily', 'Airbus A330-300', 'Year-round']);
    expect(text('.next__when')).toBe('Today · 22:10');
    expect(el.querySelector('a.next')!.getAttribute('href')).toBe('/flight/LHR/2026-10-01/AC864?from=YUL');
    expect(el.querySelector('.head__btns a.ui-btn--ghost')!.textContent!.trim()).toBe('Pick dates');
    expect(el.querySelector('.head__btns a.ui-btn--ghost')!.getAttribute('href')).toBe('/calendar/LHR?from=YUL');
    expect(el.querySelector('.head__btns a.wide')!.getAttribute('href')).toBe('https://www.aircanada.com/');
    const daysOff = [...el.querySelectorAll('[data-days-off]')].map(a => a.getAttribute('href'));
    expect(daysOff.length).toBe(2); // desktop and mobile placements
    expect(daysOff.every(h => h === '/weekend?from=YUL&to=LHR')).toBe(true);
  });

  it('shows the photo credit linking to its source, author and licence', async () => {
    await render('LHR');
    const credit = el.querySelector<HTMLElement>('.credit')!;
    expect(credit.textContent!.replace(/\s+/g, ' ').trim()).toBe('Photo · Colin · CC BY-SA 4.0');
    expect([...credit.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual([
      'https://commons.example/LHR', 'https://commons.example/User:Colin', 'https://cc.example/by-sa/4.0',
    ]);
    // The credit hides when the photo fails and the monogram shows.
    el.querySelector('app-dest-photo img')!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(el.querySelector('.credit')).toBeNull();
    await render('ATH');
    expect(el.querySelector('.credit')).toBeNull();
    expect(el.querySelector('app-dest-photo')!.classList).toContain('is-mono');
  });

  it('lists the next departures as links to their flight pages, with Show more', async () => {
    await render('LHR');
    const its = items('.dep');
    expect(its).toHaveLength(5);
    expect(its[0].classList).toContain('ui-tl__it--now');
    expect(its[0].getAttribute('href')).toBe('/flight/LHR/2026-10-01/AC864?from=YUL');
    expect(its[0].querySelector('.d')!.textContent).toBe('Today, Oct 1 · in 10h 10m');
    el.querySelector<HTMLButtonElement>('.dep .more')!.click();
    await fixture.whenStable();
    expect(items('.dep')).toHaveLength(10);
  });

  it('starts the timeline at the selected day when it is later than today', async () => {
    await render('LHR', s => s.selectDay('2026-10-08'));
    expect(items('.dep')[0].querySelector('.d')!.textContent).toBe('Thu, Oct 8');
  });

  it('lists nonstop return flights, with no Via option when there are no connections', async () => {
    await render('LHR');
    const its = items('.ret');
    expect(its).toHaveLength(5);
    expect(its[0].tagName).toBe('DIV');
    expect(its[0].textContent).toContain('AC865');
    expect(el.querySelector('.ret app-seg')).toBeNull();
  });

  it('offers a Via toggle for connecting returns', async () => {
    await render('LHR', s => s.setHub('YHZ'));
    const seg = el.querySelectorAll<HTMLButtonElement>('.ret app-seg button');
    expect(seg[0].textContent!.trim()).toBe('Nonstop');
    expect(seg[1].textContent!.trim()).toMatch(/^Via (YYZ|YUL)$/);
    expect(seg[0].disabled).toBe(true);
    expect(seg[1].getAttribute('aria-pressed')).toBe('true');
    expect(items('.ret')[0].textContent).toMatch(/1 stop · (YYZ|YUL)/);
  });

  it('toggles the favourite with an undo notice', async () => {
    await render('LHR');
    const star = () => el.querySelector<HTMLButtonElement>('button.star')!;
    expect(star().getAttribute('aria-pressed')).toBe('false');
    star().click();
    await fixture.whenStable();
    expect(state.favouriteSet().has('LHR')).toBe(true);
    expect(star().getAttribute('aria-pressed')).toBe('true');
    expect(state.notice()?.message).toBe('Saved London');
    star().click();
    await fixture.whenStable();
    expect(state.favouriteSet().has('LHR')).toBe(false);
    expect(state.notice()?.actionLabel).toBe('Undo');
    state.notice()!.action!();
    expect(state.favouriteSet().has('LHR')).toBe(true);
  });

  it('shares and goes back', async () => {
    await render('LHR');
    const back = vi.spyOn(state, 'goBack').mockImplementation(() => {});
    el.querySelector<HTMLButtonElement>('button[aria-label="Share"]')!.click();
    expect(share.share).toHaveBeenCalledWith('Flights to London');
    el.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click();
    expect(back).toHaveBeenCalledWith(['/']);
  });

  it('shows the essentials and the distance', async () => {
    await render('LHR');
    const ess = [...el.querySelectorAll('.ui-ess b')].map(b => b.textContent!.trim());
    expect(ess).toEqual(['+5h · BST', 'British pound', 'Year-round', 'A330-300']);
    expect(text('.dist b')).toMatch(/^5,\d{3} km$/);
  });

  it('starts the timelines at the browsed week, not today', async () => {
    await render('LHR', s => s.goToWeek('2026-10-12'));
    const href = el.querySelector('a.next')!.getAttribute('href')!;
    expect(href.split('/')[3] >= '2026-10-12').toBe(true);
    for (const a of el.querySelectorAll<HTMLAnchorElement>('.dep a.ui-tl__it')) {
      expect(a.getAttribute('href')!.split('/')[3] >= '2026-10-12').toBe(true);
    }
  });

  it('flags an unpublished week and jumps back to coverage', async () => {
    await render('LHR', s => s.goToWeek('2027-05-03'));
    expect(text('.notice')).toContain("Schedules for May 3 – 9 aren't published yet.");
    el.querySelector<HTMLButtonElement>('.notice button')!.click();
    expect(state.weekStartKey()).toBe('2027-03-29');
  });

  it('points to the next nonstop when the week has none', async () => {
    await render('ATH', s => s.goToWeek('2026-11-02'));
    expect(text('.notice .ui-tag')).toBe('No nonstop this week');
    expect(text('.notice p')).toBe('Next nonstop: Fri, Oct 2.');
    el.querySelector<HTMLButtonElement>('.notice button')!.click();
    expect(state.weekStartKey()).toBe('2026-09-28');
  });

  it('says when a destination is not served from the hub, with the hubs that fly it', async () => {
    await render('DEL', s => s.setShowConnections(false));
    expect(text('.notice')).toContain('Not currently served from Montréal');
    const hubs = el.querySelectorAll<HTMLButtonElement>('.notice__acts button');
    expect(hubs[0].textContent).toContain('Toronto');
    hubs[0].click();
    expect(state.hub()).toBe('YYZ');
    await fixture.whenStable();
    expect(el.querySelector('.notice')).toBeNull();
  });

  it('lists connections for connection-only destinations when they are shown', async () => {
    await render('LHR', s => {
      s.setHub('YHZ');
      s.setShowConnections(true);
    });
    expect(text('.tags .ui-tag')).toBe('1 stop · via YYZ');
    expect(text('.notice .ui-tag')).toBe('Connections only');
    expect(items('.dep').length).toBeGreaterThan(0);
    state.setShowConnections(false);
    await fixture.whenStable();
    expect(items('.dep')).toHaveLength(0);
    el.querySelector<HTMLButtonElement>('.dep .empty .ui-link')!.click();
    expect(state.showConnections()).toBe(true);
  });

  it('says a route-only pair is flown with times not in our data, Unknown tag and a link out', async () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    try {
      await render('BOS', s => {
        s.setHub('YHZ');
        s.setShowConnections(false);
      });
      const notice = text('.notice');
      expect(notice).toContain('Flies this route · times not in our data.');
      expect(notice).toContain('Air Canada Express');
      expect(el.querySelector('.notice app-provenance-tag')?.getAttribute('data-provenance')).toBe('unknown');
      expect(text('.notice app-provenance-tag')).toBe('Unknown');
      expect(el.querySelector<HTMLAnchorElement>('.notice a.ui-btn')!.href).toContain('aircanada.com');
      expect(text('.dep .empty')).toContain('Flies this route · times not in our data.');
      expect(notice).not.toMatch(/%|no flight|Not served|Connections only/i);
    } finally {
      resetRouteNetworkSource();
    }
  });

  it('follows ?tab= for the mobile seg, and writes it back with replaceUrl', async () => {
    await render('LHR');
    fixture.componentRef.setInput('tab', 'map');
    await fixture.whenStable();
    expect(el.querySelector('.dep')!.classList).toContain('m-hide');
    expect(el.querySelector('.side')!.classList).not.toContain('m-hide');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect([...el.querySelectorAll('.tabs button')].map(b => b.textContent!.trim())).toEqual(['Departures', 'Ways home', 'Map']);
    el.querySelectorAll<HTMLButtonElement>('.tabs button')[1].click();
    expect(nav).toHaveBeenCalledWith([], { queryParams: { tab: 'returns' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    el.querySelectorAll<HTMLButtonElement>('.tabs button')[0].click();
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { tab: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  });

  it('has no month availability card and no mobile Plan dates block', async () => {
    await render('LHR');
    expect(el.querySelector('.avail')).toBeNull();
    expect(el.querySelector('app-month-availability')).toBeNull();
    expect(el.textContent).not.toContain('Plan dates');
  });

  it('Dates bar, unset: asks when you are going and opens the picker', async () => {
    await render('LHR');
    expect(text('[data-dates-bar] .dates__q')).toBe('When are you going?');
    const pick = el.querySelector<HTMLAnchorElement>('[data-dates-pick]')!;
    expect(pick.textContent!.trim()).toBe('Pick dates');
    expect(pick.getAttribute('href')).toBe('/calendar/LHR?from=YUL');
    expect(el.querySelector('app-stay-chips')).toBeNull();
  });

  it('Dates bar, departure only: five stay chips with their ways home; a chip writes ?ret', async () => {
    await render('LHR', undefined, { dep: '2026-10-02' });
    expect(text('[data-dates-text]')).toBe('Leave Fri, Oct 2 · pick a day home');
    const chips = [...el.querySelectorAll<HTMLButtonElement>('app-stay-chips [role="radio"][data-nights]')];
    expect(chips.map(c => c.dataset['nights'])).toEqual(['2', '3', '4', '5', '7']);
    expect(chips[0].textContent!.replace(/\s+/g, ' ').trim()).toBe('2 nights Sun 4 · 1 home');
    expect(el.querySelector('[data-pick-dates]')!.getAttribute('href')).toBe('/calendar/LHR?from=YUL&dep=2026-10-02');
    const nav = spyNav();
    chips[2].click();
    expect(nav).toHaveBeenCalledWith([], {
      queryParams: { dep: '2026-10-02', ret: '2026-10-06' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    el.querySelector<HTMLButtonElement>('[data-dates-clear]')!.click();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: null, ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
  });

  it('Dates bar, both dates: the range and nights, See flights opens the round trip', async () => {
    await render('LHR', undefined, { dep: '2026-10-02', ret: '2026-10-10' });
    expect(text('[data-dates-text]')).toBe('Oct 2 – 10 · 8 nights');
    const see = el.querySelector<HTMLAnchorElement>('[data-dates-see]')!;
    expect(see.textContent!.trim()).toBe('See flights');
    expect(see.getAttribute('href')).toBe('/plan/LHR?from=YUL&dep=2026-10-02&ret=2026-10-10');
    expect(el.querySelector('[data-dates-clear]')!.getAttribute('aria-label')).toBe('Clear dates');
    expect(el.querySelector('[data-pick-dates]')!.getAttribute('href')).toBe('/calendar/LHR?from=YUL&dep=2026-10-02&ret=2026-10-10');
    // Departures open the round trip from their own day, keeping the 8 nights.
    const rows = el.querySelectorAll<HTMLAnchorElement>('.dep a.ui-tl__it');
    expect(rows[0].getAttribute('href')).toBe('/plan/LHR?from=YUL&dep=2026-10-02&ret=2026-10-10&out=AC864');
    expect(rows[1].getAttribute('href')).toBe('/plan/LHR?from=YUL&dep=2026-10-03&ret=2026-10-11&out=AC868');
  });

  it('drops invalid dates and a same-day return with no way home after landing', async () => {
    await render('LHR', undefined, { dep: '2026-09-20', ret: '2026-09-25' });
    expect(text('[data-dates-bar] .dates__q')).toBe('When are you going?');
    // AC864 lands the next morning: no way home on Oct 2 itself.
    await setQuery({ dep: '2026-10-02', ret: '2026-10-02' });
    expect(text('[data-dates-text]')).toBe('Leave Fri, Oct 2 · pick a day home');
  });

  it('a 14-day strip: a tap writes ?dep; then the timeline starts there with a From chip', async () => {
    await render('LHR', s => s.setShowConnections(false));
    const cells = el.querySelectorAll<HTMLButtonElement>('.dep app-day-count-strip [role="option"]');
    expect(cells).toHaveLength(14);
    expect(cells[0].dataset['key']).toBe('2026-10-01');
    expect([...cells[0].querySelectorAll('span')].map(x => x.textContent!.trim())).toEqual(['Thu, Oct 1', '1 flight', '22:10']);
    expect(el.querySelector('[data-from]')).toBeNull();
    expect(el.querySelector('[data-full-cal]')!.textContent!.trim()).toBe('Full calendar');
    const nav = spyNav();
    el.querySelector<HTMLButtonElement>('.dep app-day-count-strip [data-key="2026-10-09"]')!.click();
    expect(nav).toHaveBeenCalledWith([], {
      queryParams: { dep: '2026-10-09', ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    await setQuery({ dep: '2026-10-09' });
    expect(text('[data-from]')).toBe('From Fri, Oct 9');
    expect(el.querySelector('.dep [aria-selected="true"]')!.getAttribute('data-key')).toBe('2026-10-09');
    expect(items('.dep')[0].querySelector('.d')!.textContent).toBe('Fri, Oct 9');
    // Without a return, departures still open their flight page.
    expect(items('.dep')[0].getAttribute('href')).toBe('/flight/LHR/2026-10-09/AC864?from=YUL');
    // A later departure moves the return with it, keeping the nights.
    await setQuery({ ret: '2026-10-12' });
    el.querySelector<HTMLButtonElement>('.dep app-day-count-strip [data-key="2026-10-14"]')!.click();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: '2026-10-14', ret: '2026-10-17' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    el.querySelector<HTMLButtonElement>('[data-from]')!.click();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: null, ret: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
  });

  it('the strip counts what the list under it shows; a day with none of that kind says so, with the other kind', async () => {
    resetScheduleSource();
    setScheduleSource([
      route('YUL', 'LHR', rec('AC864', '22:10', '10:00', '2026-09-01', '2027-03-31', 'Mon', '333')),
      route('YYZ', 'LHR', rec('AC848', '18:00', '06:15', '2026-09-01', '2027-03-31', ALL_DAYS, '77W')),
      route('LHR', 'YUL', rec('AC865', '12:10', '14:35', '2026-09-01', '2027-03-31', ALL_DAYS, '333')),
    ], FIXTURE_META);
    await render('LHR', s => s.setShowConnections(true), { dep: '2026-10-06' });
    const cell = (k: string) => [...el.querySelectorAll(`.dep app-day-count-strip [data-key="${k}"] span`)].map(x => x.textContent!.trim());
    // Nonstop seg: Monday's AC864 only, never the via-YYZ connection (which flies daily).
    expect(cell('2026-10-05').slice(1)).toEqual(['1 flight', '22:10']);
    expect(cell('2026-10-06').slice(0, 2)).toEqual(['Tue 6', '0 flights']);
    expect(text('[data-day-gap]')).toBe('No nonstop on Tue, Oct 6 · 1 with a connection that day Show · first listed: Mon, Oct 12');
    // Ways home are counted after the flight that does fly that day (the connection), and the heading says so.
    expect(text('[data-ret-heading]')).toMatch(/^Leaving LHR after you land via YYZ \(Wed, Oct 7 /);
    el.querySelector<HTMLButtonElement>('[data-day-gap] button')!.click();
    await fixture.whenStable();
    // Via seg: the strip counts connections only, and the tapped day is listed first.
    expect(cell('2026-10-06').slice(1, 2)).toEqual(['1 flight']);
    expect(el.querySelector('[data-day-gap]')).toBeNull();
    expect(items('.dep')[0].querySelector('.d')!.textContent).toContain('Tue, Oct 6');
  });

  it('a departure tapped past the return moves it and says so (nothing changes silently)', async () => {
    await render('LHR', s => s.setShowConnections(false), { dep: '2026-10-05', ret: '2026-10-08' });
    const nav = spyNav();
    const flash = vi.spyOn(state, 'flash');
    el.querySelector<HTMLButtonElement>('.dep app-day-count-strip [data-key="2026-10-10"]')!.click();
    expect(nav).toHaveBeenLastCalledWith([], {
      queryParams: { dep: '2026-10-10', ret: '2026-10-13' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual',
    });
    expect(flash).toHaveBeenCalledWith('Home moved to Tue, Oct 13 to keep 3 nights');
    // The From chip's name says what it does: it clears both dates.
    expect(el.querySelector('[data-from]')!.getAttribute('aria-label')).toBe('From Mon, Oct 5 · clear dates');
  });

  it('Ways home without dates: the next flights home, unlinked, with a prompt to pick dates', async () => {
    await render('LHR');
    expect(text('[data-ret-heading]')).toBe('Next flights home from London');
    expect(text('.ret__pick')).toBe('Pick dates to match these to your stay Pick dates');
    expect(items('.ret')[0].tagName).toBe('DIV');
    expect(el.querySelector('.ret [data-stay]')).toBeNull();
  });

  it('Ways home with a departure: leaving after you land, with a stay tag and a round-trip link', async () => {
    await render('LHR', s => s.setShowConnections(false), { dep: '2026-10-02' });
    expect(text('[data-ret-heading]')).toBe('Leaving LHR after you land (Sat, Oct 3 10:00)');
    const first = items('.ret')[0] as HTMLAnchorElement;
    expect(first.tagName).toBe('A');
    expect(first.querySelector('.d')!.textContent).toContain('Sat, Oct 3');
    expect(text('.ret [data-stay]')).toBe('1 night');
    // It leaves at least the minimum connection after AC864 lands.
    const landed = toUtcMs('2026-10-03', '10:00', 'Europe/London');
    expect(toUtcMs('2026-10-03', '12:10', 'Europe/London')).toBeGreaterThanOrEqual(landed + state.connect().minConnect! * 60_000);
    expect(first.textContent).toContain('12:10');
    const href = first.getAttribute('href')!;
    expect(href).toBe('/plan/LHR?from=YUL&dep=2026-10-02&ret=2026-10-03&back=AC865');
    expect(el.querySelector('.ret__pick')).toBeNull();
  });

  it('the stay chips count exactly the ways home the round-trip page lists (parity)', async () => {
    await render('LHR', s => s.setHub('YHZ'), { dep: '2026-10-05' });
    state.setShowConnections(true);
    await fixture.whenStable();
    const ctx = ctxOf(state);
    const after = homeAfterUtc(null, outboundsOn('YHZ', 'LHR', '2026-10-05', ctx), ctx.connect);
    const chips = [...el.querySelectorAll<HTMLButtonElement>('app-stay-chips [data-nights]')];
    expect(chips).toHaveLength(5);
    for (const c of chips) {
      const key = addDays('2026-10-05', Number(c.dataset['nights']));
      const n = Number(/(\d+) home/.exec(c.textContent!)![1]);
      expect(n).toBe(waysHome('LHR', 'YHZ', key, ctx, after).length);
    }
  });

  it('a seasonal route says, in one sentence with the year, when the first flight home is', async () => {
    resetScheduleSource();
    setScheduleSource([
      ...FIXTURE_ROUTES,
      route('YUL', 'OPO', rec('AC1988', '21:00', '09:00', '2027-06-01', '2027-09-30', ALL_DAYS, '321')),
      route('OPO', 'YUL', rec('AC1989', '11:00', '13:30', '2027-06-02', '2027-09-30', ALL_DAYS, '321')),
    ], { ...FIXTURE_META, coverageTo: '2027-10-31' });
    await render('OPO');
    expect(text('[data-seasonal-home]')).toBe('No flights home until Wed, Jun 2, 2027 Go');
    el.querySelector<HTMLButtonElement>('[data-seasonal-home] button')!.click();
    expect(state.selectedDateKey()).toBe('2027-06-02');
  });
});
