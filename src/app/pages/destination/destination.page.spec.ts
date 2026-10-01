import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { PhotoService } from '../../state/photo.service';
import { ShareService } from '../../state/share.service';
import { MemoryStorage } from '../../state/testing';
import { toUtcMs } from '../../utils/time';
import { DestinationPage } from './destination.page';

const NOW_MS = toUtcMs('2026-10-01', '12:00', 'America/Toronto');

describe('DestinationPage', () => {
  let fixture: ComponentFixture<DestinationPage>;
  let el: HTMLElement;
  let state: AppStateService;
  let share: { share: ReturnType<typeof vi.fn> };

  async function render(code: string, setup?: (s: AppStateService) => void): Promise<void> {
    fixture = TestBed.createComponent(DestinationPage);
    el = fixture.nativeElement;
    state = TestBed.inject(AppStateService);
    state.todayKey.set('2026-10-01'); // the device zone may already be on Oct 2
    setup?.(state);
    fixture.componentRef.setInput('code', code);
    await fixture.whenStable();
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
    expect(el.querySelector('.head__btns a.ui-btn--ghost')!.getAttribute('href')).toBe('/calendar/LHR?from=YUL');
    expect(el.querySelector('.head__btns a.wide')!.getAttribute('href')).toBe('https://www.aircanada.com/');
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

  it('follows ?tab= for the mobile seg, and writes it back with replaceUrl', async () => {
    await render('LHR');
    fixture.componentRef.setInput('tab', 'map');
    await fixture.whenStable();
    expect(el.querySelector('.dep')!.classList).toContain('m-hide');
    expect(el.querySelector('.side')!.classList).not.toContain('m-hide');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelectorAll<HTMLButtonElement>('.tabs button')[1].click();
    expect(nav).toHaveBeenCalledWith([], { queryParams: { tab: 'returns' }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
    el.querySelectorAll<HTMLButtonElement>('.tabs button')[0].click();
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { tab: null }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  });

  it('moves the app to a day picked in the month availability', async () => {
    await render('LHR');
    const day = el.querySelector<HTMLButtonElement>('.avail button[data-date="2026-10-09"]')!;
    expect(day.getAttribute('aria-label')).toBe('Fri, Oct 9: 1 nonstop departure');
    expect(el.querySelector<HTMLButtonElement>('.avail button[data-date="2026-09-30"]')).toBeNull();
    day.click();
    await fixture.whenStable();
    expect(state.selectedDateKey()).toBe('2026-10-09');
    expect(day.getAttribute('aria-pressed')).toBe('true');
    expect(items('.dep')[0].querySelector('.d')!.textContent).toBe('Fri, Oct 9');
    const next = el.querySelector<HTMLButtonElement>('.avail button[aria-label="Next month"]')!;
    next.click();
    await fixture.whenStable();
    expect(el.querySelector('.avail .mt')!.textContent).toBe('November 2026');
    expect(el.querySelector<HTMLButtonElement>('.avail button[aria-label="Previous month"]')!.disabled).toBe(false);
  });
});
