import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FlightModalComponent } from './flight-modal.component';
import { getCoverage, resetScheduleSource, setScheduleSource, type Coverage } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { findDestination } from '../../utils/airports';
import { NO_OPTS } from '../../utils/connections';
import { formatStay, isOutside, operatesLabel, prettyFlight, stopsLabel } from './modal-model';

interface Setup {
  dest?: string;
  hub?: string;
  hubName?: string;
  week?: string;
  day?: string | null;
  today?: string;
  coverage?: Coverage | null;
  showConnections?: boolean;
}

let opener: HTMLButtonElement;

async function setup(o: Setup = {}) {
  TestBed.configureTestingModule({ imports: [FlightModalComponent] });
  const fixture = TestBed.createComponent(FlightModalComponent);
  const hub = o.hub ?? 'YUL';
  const ref = fixture.componentRef;
  ref.setInput('destination', findDestination(o.dest ?? 'LHR')!);
  ref.setInput('entry', null);
  ref.setInput('hubCode', hub);
  ref.setInput('hubName', o.hubName ?? 'Montreal');
  ref.setInput('weekStartKey', o.week ?? '2026-10-05');
  ref.setInput('selectedDateKey', o.day ?? null);
  ref.setInput('todayKey', o.today ?? '2026-10-01');
  ref.setInput('coverage', o.coverage === undefined ? getCoverage(hub) : o.coverage);
  ref.setInput('showConnections', o.showConnections ?? true);
  ref.setInput('connect', NO_OPTS);
  ref.setInput('timeFormat', '24h');
  ref.setInput('isFavourite', false);
  const closed = vi.fn();
  const selectDate = vi.fn();
  const share = vi.fn();
  const fav = vi.fn();
  ref.instance.closed.subscribe(closed);
  ref.instance.selectDate.subscribe(selectDate);
  ref.instance.share.subscribe(share);
  ref.instance.toggleFavourite.subscribe(fav);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const dialog = el.querySelector('dialog')!;
  return { fixture, el, dialog, closed, selectDate, share, fav };
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const day = (el: HTMLElement, key: string) => el.querySelector<HTMLElement>(`[data-day="${key}"]`)!;

async function clickTab(fixture: ComponentFixture<FlightModalComponent>, id: string) {
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`#fm-tab-${id}`)!.click();
  await fixture.whenStable();
}

describe('FlightModalComponent', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    opener = document.createElement('button');
    opener.textContent = 'card';
    document.body.appendChild(opener);
    opener.focus();
  });
  afterEach(() => {
    resetScheduleSource();
    opener.remove();
    vi.restoreAllMocks();
  });

  describe('dialog', () => {
    it('opens as a modal labelled by the city heading, locks page scroll and focuses close', async () => {
      const { el, dialog } = await setup();
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.getAttribute('aria-labelledby')).toBe('fm-title');
      expect(text(el.querySelector('#fm-title'))).toBe('London');
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.documentElement.classList.contains('modal-open')).toBe(true);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    });

    it('Esc closes, and focus returns to the opener when the parent removes it', async () => {
      const { fixture, dialog, closed } = await setup();
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(closed).toHaveBeenCalledTimes(1);
      expect(dialog.hasAttribute('open')).toBe(false);
      fixture.destroy();
      expect(document.activeElement).toBe(opener);
      expect(document.documentElement.style.overflow).toBe('');
      expect(document.documentElement.classList.contains('modal-open')).toBe(false);
    });

    it('the close button emits closed once', async () => {
      const { el, closed } = await setup();
      el.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      el.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('closes on a backdrop click but not on a click inside', async () => {
      const { el, dialog, closed } = await setup();
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 400, top: 10, bottom: 600 } as DOMRect);
      el.querySelector('#fm-title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
      expect(closed).not.toHaveBeenCalled();
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 2 }));
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('dragging the sheet top down 120px closes it on mobile; a short drag snaps back', async () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
      const { el, dialog, closed } = await setup();
      const top = el.querySelector<HTMLElement>('.top')!;
      const fire = (type: string, y: number) => top.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY: y }));
      fire('pointerdown', 100); fire('pointermove', 150); fire('pointerup', 150);
      expect(closed).not.toHaveBeenCalled();
      expect(dialog.style.transform).toBe('');
      fire('pointerdown', 100); fire('pointermove', 240); fire('pointerup', 240);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('ignores drags on desktop', async () => {
      const { el, closed } = await setup();
      const top = el.querySelector<HTMLElement>('.top')!;
      top.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 0 }));
      top.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 400 }));
      expect(closed).not.toHaveBeenCalled();
    });

    it('emits share and toggleFavourite', async () => {
      const { el, share, fav } = await setup();
      el.querySelector<HTMLButtonElement>('button[aria-label="Share link"]')!.click();
      el.querySelector<HTMLButtonElement>('button.fav')!.click();
      expect(share).toHaveBeenCalledOnce();
      expect(fav).toHaveBeenCalledOnce();
    });
  });

  describe('outbound', () => {
    it('lists both flights of a double day, de-duplicated (YUL→ATH Mon)', async () => {
      const { el } = await setup({ dest: 'ATH' });
      const mon = day(el, '2026-10-05');
      const chips = [...mon.querySelectorAll('.ui-chip-mono')].map(text).filter(t => t.startsWith('AC'));
      expect(chips).toEqual(['AC 898', 'AC 922']);
      expect(text(mon)).toContain('2 direct');
      expect(text(day(el, '2026-10-06'))).toContain('No flights');
    });

    it("shows '+1' on an overnight arrival and the hero ticket", async () => {
      const { el } = await setup({ dest: 'LHR' });
      const wed = day(el, '2026-10-07');
      expect(text(wed.querySelector('.ui-dayoff'))).toBe('+1');
      const ticket = text(el.querySelector('.ticket'));
      expect(ticket).toContain('YUL');
      expect(ticket).toContain('LHR');
      expect(ticket).toContain('Daily');
      expect(el.querySelector('.foot')!.textContent).toContain('Toronto');
      expect(el.querySelector('.foot')!.textContent).toContain('Hidden from your list');
    });

    it('expands the selected day, with a layover pill, total time and estimated legs marked', async () => {
      const { el } = await setup({ dest: 'LHR', hub: 'YHZ', hubName: 'Halifax', day: '2026-10-05' });
      const mon = day(el, '2026-10-05');
      expect(text(mon)).toContain('via connection');
      const detail = mon.querySelector('.detail')!;
      expect(detail).toBeTruthy();
      expect(text(detail.querySelector('.ui-timeline__layover'))).toContain('2h 30m layover · Toronto');
      expect(text(detail.querySelector('.ui-timeline__footer'))).toMatch(/^Total \d+h/);
      expect(text(detail)).toContain('If you miss this');
      // An estimated option (via YUL) is visibly flagged.
      expect([...mon.querySelectorAll('.ui-chip--warn')].map(text)).toContain('Estimated leg');
    });

    it('toggles options and reveals hidden connections', async () => {
      const { el, fixture } = await setup({ dest: 'LHR', day: '2026-10-07' });
      const wed = day(el, '2026-10-07');
      expect(wed.querySelectorAll('.detail').length).toBe(1);
      const sum = wed.querySelector<HTMLButtonElement>('app-itinerary-option .sum')!;
      expect(sum.getAttribute('aria-expanded')).toBe('true');
      sum.click();
      await fixture.whenStable();
      expect(wed.querySelectorAll('.detail').length).toBe(0);
      const more = wed.querySelector<HTMLButtonElement>('.more');
      if (more) {
        const before = wed.querySelectorAll('app-itinerary-option').length;
        more.click();
        await fixture.whenStable();
        expect(wed.querySelectorAll('app-itinerary-option').length).toBeGreaterThan(before);
      }
    });

    it('says "not yet published" beyond coverage, never "no flights"', async () => {
      const { el } = await setup({ coverage: { from: '2026-09-01', to: '2026-10-07', generatedAt: null, hub: 'YUL' } });
      expect(text(day(el, '2026-10-08'))).toContain('Schedules not yet published');
      expect(text(day(el, '2026-10-07'))).not.toContain('not yet published');
    });

    it('a day header emits selectDate', async () => {
      const { el, selectDate } = await setup();
      day(el, '2026-10-09').querySelector<HTMLButtonElement>('.day__date')!.click();
      expect(selectDate).toHaveBeenCalledWith('2026-10-09');
    });

    it('offers the next direct date when the week has none', async () => {
      setScheduleSource([route('YUL', 'ATH', rec('AC898', '17:25', '10:35', '2026-11-20', '2026-12-31', 'Fri'))], FIXTURE_META);
      const { el, selectDate } = await setup({ dest: 'ATH', showConnections: false });
      const next = el.querySelector('.next')!;
      expect(text(next)).toContain('Fri, Nov 20');
      next.querySelector('button')!.click();
      expect(selectDate).toHaveBeenCalledWith('2026-11-20');
    });
  });

  describe('tabs', () => {
    it('arrow keys move between tabs', async () => {
      const { el, fixture } = await setup();
      const tab = el.querySelector<HTMLElement>('#fm-tab-outbound')!;
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await fixture.whenStable();
      expect(el.querySelector('#fm-tab-return')!.getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector('[role=tabpanel]')!.id).toBe('fm-panel-return');
      el.querySelector<HTMLElement>('#fm-tab-return')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await fixture.whenStable();
      expect(fixture.componentInstance.tab()).toBe('calendar');
    });

    it('Return: YUL→LHR, 4 nights counted from the arrival date, lists LHR→YUL', async () => {
      const { el, fixture } = await setup({ dest: 'LHR', day: '2026-10-07' });
      await clickTab(fixture, 'return');
      expect(text(el.querySelector('.basis'))).toContain('lands Thu, Oct 8');
      const exact = el.querySelector('[data-return="2026-10-12"]')!;
      expect(exact.classList.contains('ret--exact')).toBe(true);
      expect(text(exact)).toContain('AC 865');
      expect(text(exact)).toContain('4 nights');
      expect(text(exact)).toMatch(/\dd( \d+h)? at destination/);
      // A day either side.
      expect(el.querySelector('[data-return="2026-10-11"]')).toBeTruthy();
      expect(el.querySelector('[data-return="2026-10-13"]')).toBeTruthy();
    });

    it('Return: the stepper changes nights and an empty window says so', async () => {
      setScheduleSource([
        route('YUL', 'ATH', rec('AC898', '17:25', '10:35', '2026-10-01', '2026-10-31', 'Mon')),
      ], FIXTURE_META);
      const { el, fixture } = await setup({ dest: 'ATH', day: '2026-10-05' });
      await clickTab(fixture, 'return');
      expect(text(el.querySelector('.none'))).toContain('No published return within that window');
      el.querySelector<HTMLButtonElement>('button[aria-label="One night more"]')!.click();
      await fixture.whenStable();
      expect(el.querySelector('[data-return="2026-10-11"]')!.classList.contains('ret--exact')).toBe(true);
    });

    it('Return: nights survive a tab switch', async () => {
      const { el, fixture } = await setup({ dest: 'LHR', day: '2026-10-07' });
      await clickTab(fixture, 'return');
      el.querySelector<HTMLButtonElement>('button[aria-label="One night more"]')!.click();
      await fixture.whenStable();
      await clickTab(fixture, 'calendar');
      await clickTab(fixture, 'return');
      expect(fixture.componentInstance.returnNights()).toBe(5);
      expect(el.querySelector('[data-return="2026-10-13"]')!.classList.contains('ret--exact')).toBe(true);
    });

    it('Return: an outbound expanded in a week no longer shown is not used', async () => {
      const { el, fixture } = await setup({ dest: 'LHR', day: '2026-10-07' });
      expect(fixture.componentInstance.outbound()?.dateKey).toBe('2026-10-07');
      await clickTab(fixture, 'calendar');
      // The parent moves to another week (a Calendar pick): the Outbound panel is not mounted.
      fixture.componentRef.setInput('weekStartKey', '2026-10-19');
      fixture.componentRef.setInput('selectedDateKey', '2026-10-21');
      await fixture.whenStable();
      await clickTab(fixture, 'return');
      expect(text(el.querySelector('.basis'))).toContain('lands Thu, Oct 22');
    });

    it('Calendar: a cell click emits the date key; outside coverage is disabled', async () => {
      const cov = { from: '2026-09-01', to: '2026-10-20', generatedAt: null, hub: 'YUL' };
      const { el, fixture, selectDate } = await setup({ dest: 'ATH', coverage: cov, today: '2026-10-07' });
      await clickTab(fixture, 'calendar');
      expect(text(el.querySelector('#cal-title'))).toBe('October 2026');
      const mon = el.querySelector<HTMLButtonElement>('[data-date="2026-10-12"]')!;
      expect(mon.classList.contains('ui-heat--direct')).toBe(true);
      expect(mon.getAttribute('aria-label')).toBe('Monday, October 12: 2 direct flights');
      expect(el.querySelector('[data-date="2026-10-13"]')!.classList.contains('ui-heat--none')).toBe(true);
      expect(el.querySelector('[data-date="2026-10-07"]')!.classList.contains('is-today')).toBe(true);
      const late = el.querySelector<HTMLButtonElement>('[data-date="2026-10-26"]')!;
      expect(late.classList.contains('ui-heat--outside')).toBe(true);
      expect(late.disabled).toBe(true);
      mon.click();
      expect(selectDate).toHaveBeenCalledWith('2026-10-12');
      // Next month is beyond coverage.
      expect(el.querySelector<HTMLButtonElement>('button[aria-label="Next month"]')!.disabled).toBe(true);
      el.querySelector<HTMLButtonElement>('button[aria-label="Previous month"]')!.click();
      await fixture.whenStable();
      expect(text(el.querySelector('#cal-title'))).toBe('September 2026');
    });

    it('Calendar: connection-only days are striped', async () => {
      const { el, fixture } = await setup({ dest: 'LHR', hub: 'YHZ', hubName: 'Halifax' });
      await clickTab(fixture, 'calendar');
      expect(el.querySelector('[data-date="2026-10-14"]')!.classList.contains('ui-heat--connect')).toBe(true);
    });
  });
});

describe('modal-model helpers', () => {
  it('formats', () => {
    expect(formatStay(0)).toBe('0m');
    expect(formatStay(45 * 60000)).toBe('45m');
    expect(formatStay(5 * 3600000)).toBe('5h');
    expect(formatStay(2 * 86400000)).toBe('2d');
    expect(formatStay(2 * 86400000 + 3 * 3600000)).toBe('2d 3h');
    expect(operatesLabel(['2026-10-05', '2026-10-07', '2026-10-09'])).toBe('Mon Wed Fri');
    expect(prettyFlight('AC864')).toBe('AC 864');
    expect(prettyFlight(null)).toBe('');
    expect(isOutside('2026-10-10', null)).toBe(false);
    expect(isOutside('2026-08-10', { from: '2026-09-01', to: null, generatedAt: null, hub: null })).toBe(true);
    const it2 = { hubs: ['YYZ', 'YUL'] } as never;
    expect(stopsLabel(it2)).toBe('2 stops · YYZ YUL');
  });
});
