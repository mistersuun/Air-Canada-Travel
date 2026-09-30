import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WeekStripComponent, freshnessAge, weekRangeLabel } from './week-strip.component';
import type { Coverage } from '../../data/schedule-index';

const COVERAGE: Coverage = { from: '2026-09-01', to: '2027-03-31', generatedAt: '2026-09-28T06:00:00Z', hub: 'YUL' };

@Component({
  standalone: true,
  imports: [WeekStripComponent],
  template: `
    <app-week-strip [weekStartKey]="week()" [selectedDateKey]="sel()" [todayKey]="today()" [coverage]="cov()"
                    [routeCount]="count()"
                    (selectDay)="sel.set($event); events.push(['selectDay', $event])"
                    (prev)="events.push(['prev'])" (next)="events.push(['next'])"
                    (jumpTo)="events.push(['jumpTo', $event])" />
  `,
})
class HostComponent {
  week = signal('2026-09-28');
  sel = signal<string | null>(null);
  today = signal('2026-09-30');
  cov = signal<Coverage | null>(COVERAGE);
  count = signal(84);
  events: unknown[][] = [];
}

async function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const host = fixture.componentInstance;
  const el: HTMLElement = fixture.nativeElement;
  const days = () => [...el.querySelectorAll<HTMLButtonElement>('.ws__day')];
  const byLabel = (prefix: string) => el.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`)!;
  return { fixture, host, el, days, byLabel };
}

function key(k: string, extra: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  document.body.dispatchEvent(e);
  return e;
}

describe('weekRangeLabel / freshnessAge', () => {
  it('formats within a month, across months and across years', () => {
    expect(weekRangeLabel('2026-10-05')).toBe('Oct 5 – 11');
    expect(weekRangeLabel('2026-09-28')).toBe('Sep 28 – Oct 4');
    expect(weekRangeLabel('2026-12-28')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('describes the schedule age', () => {
    expect(freshnessAge('2026-09-30T08:00:00Z', '2026-09-30')?.text).toBe('today');
    expect(freshnessAge('2026-09-29T12:00:00Z', '2026-09-30')?.text).toBe('yesterday');
    expect(freshnessAge('2026-09-27T12:00:00Z', '2026-09-30')).toEqual({ days: 3, text: '3 days ago' });
    expect(freshnessAge('not a date', '2026-09-30')).toBeNull();
  });
});

describe('WeekStripComponent', () => {
  afterEach(() => document.querySelectorAll('dialog').forEach(d => d.remove()));

  it('renders All week plus seven stable day buttons with full labels', async () => {
    const { days } = await setup();
    const btns = days();
    expect(btns).toHaveLength(8);
    expect(btns[0].getAttribute('aria-label')).toBe('All week, Sep 28 – Oct 4, 2026');
    expect(btns[3].getAttribute('aria-label')).toBe('Wednesday, September 30, 2026, today');
    expect(btns[3].classList).toContain('is-today');
    expect(btns[1].textContent).toContain('Mon');
    expect(btns[1].textContent).toContain('28');
  });

  it('shows the cross-month week label with the year apart', async () => {
    const { el } = await setup();
    expect(el.querySelector('.ws__range')!.textContent).toBe('Sep 28 – Oct 4');
    expect(el.querySelector('.ws__year')!.textContent).toBe('2026');
  });

  it('shows a cross-year label in full without a separate year', async () => {
    const { el, host, fixture } = await setup();
    host.week.set('2026-12-28');
    await fixture.whenStable();
    expect(el.querySelector('.ws__range')!.textContent).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(el.querySelector('.ws__year')).toBeNull();
  });

  it('toggles aria-pressed and keeps focus on the clicked day button', async () => {
    const { days, fixture, host } = await setup();
    expect(days()[0].getAttribute('aria-pressed')).toBe('true');
    const wed = days()[3];
    wed.focus();
    wed.click();
    await fixture.whenStable();
    expect(host.sel()).toBe('2026-09-30');
    expect(days()[3]).toBe(wed); // same DOM node: tracked by date key
    expect(document.activeElement).toBe(wed);
    expect(wed.getAttribute('aria-pressed')).toBe('true');
    expect(days()[0].getAttribute('aria-pressed')).toBe('false');
    expect(fixture.nativeElement.querySelector('.ws__days').style.getPropertyValue('--i')).toBe('3');

    days()[0].click();
    await fixture.whenStable();
    expect(host.sel()).toBeNull();
    expect(days()[3].getAttribute('aria-pressed')).toBe('false');
  });

  it('emits prev/next and disables arrows beyond coverage ± 1 week', async () => {
    const { byLabel, fixture, host } = await setup();
    byLabel('Previous week').click();
    byLabel('Next week').click();
    expect(host.events).toEqual([['prev'], ['next']]);
    expect(byLabel('Previous week').getAttribute('aria-label')).toBe('Previous week, Sep 21 – 27');

    // coverage.to 2027-03-31 is in the week of Mar 29; one week beyond is Apr 5.
    host.week.set('2027-04-05');
    await fixture.whenStable();
    expect(byLabel('Next week').disabled).toBe(true);
    host.week.set('2027-03-29');
    await fixture.whenStable();
    expect(byLabel('Next week').disabled).toBe(false);

    // coverage.from 2026-09-01 is in the week of Aug 31; one week before is Aug 24.
    host.week.set('2026-08-24');
    await fixture.whenStable();
    expect(byLabel('Previous week').disabled).toBe(true);
    host.cov.set(null);
    await fixture.whenStable();
    expect(byLabel('Previous week').disabled).toBe(false);
  });

  it('dims days outside coverage with a tooltip', async () => {
    const { days, fixture, host } = await setup();
    host.week.set('2027-03-29');
    await fixture.whenStable();
    const out = days()[4]; // Thu Apr 1
    expect(out.classList).toContain('is-outside');
    expect(out.getAttribute('title')).toBe('Outside published schedules (through Mar 31, 2027)');
    expect(out.getAttribute('aria-label')).toContain('outside published schedules');
    expect(days()[3].classList).not.toContain('is-outside');
  });

  it('Today jumps to today and is disabled when today is selected', async () => {
    const { el, fixture, host } = await setup();
    const today = el.querySelector<HTMLButtonElement>('.ws__today')!;
    today.click();
    expect(host.events).toEqual([['jumpTo', '2026-09-30']]);
    host.sel.set('2026-09-30');
    await fixture.whenStable();
    expect(today.disabled).toBe(true);
  });

  it('the date picker jumps within coverage and clamps outside it', async () => {
    const { el, host } = await setup();
    const picker = el.querySelector<HTMLInputElement>('input[type=date]')!;
    expect(picker.min).toBe('2026-09-01');
    expect(picker.max).toBe('2027-03-31');
    const pick = (v: string) => {
      picker.value = v;
      picker.dispatchEvent(new Event('change'));
    };
    pick('2026-11-18');
    pick('2028-01-01');
    pick('');
    expect(host.events).toEqual([['jumpTo', '2026-11-18'], ['jumpTo', '2027-03-31']]);
  });

  it('the week label opens the native picker, or reveals the input as a fallback', async () => {
    const { el, fixture } = await setup();
    const picker = el.querySelector<HTMLInputElement>('input[type=date]') as HTMLInputElement & { showPicker?: () => void };
    const label = el.querySelector<HTMLButtonElement>('.ws__label')!;
    expect(label.getAttribute('aria-label')).toBe('Week of Sep 28 – Oct 4, 2026. Choose a date');
    const spy = vi.fn();
    picker.showPicker = spy;
    label.click();
    expect(spy).toHaveBeenCalledOnce();

    picker.showPicker = () => { throw new Error('NotAllowedError'); };
    label.click();
    await fixture.whenStable();
    expect(picker.classList).toContain('is-shown');
  });

  it('shows the route count and schedule freshness, warning when stale', async () => {
    const { el, fixture, host } = await setup();
    expect(el.querySelector('.ws__count')!.textContent).toBe('84 routes this week');
    expect(el.querySelector('.ws__fresh')!.textContent!.trim()).toBe('Schedules updated 2 days ago · through Mar 31, 2027');
    expect(el.querySelector('.ws__fresh')!.classList).not.toContain('is-stale');

    host.sel.set('2026-10-02');
    host.count.set(1);
    host.today.set('2026-10-20');
    await fixture.whenStable();
    expect(el.querySelector('.ws__count')!.textContent).toBe('1 route on Fri, Oct 2');
    const fresh = el.querySelector('.ws__fresh')!;
    expect(fresh.classList).toContain('is-stale');
    expect(fresh.textContent!.trim()).toBe('Schedules may be stale · updated 22 days ago · through Mar 31, 2027');

    host.cov.set({ from: null, to: null, generatedAt: null, hub: 'YEG' });
    await fixture.whenStable();
    expect(el.querySelector('.ws__fresh')!.textContent!.trim()).toBe('No published schedules for this airport');
  });

  describe('keyboard shortcuts', () => {
    it('arrows change week, digits pick days, 0 selects all week, T jumps to today', async () => {
      const { host, fixture } = await setup();
      expect(key('ArrowLeft').defaultPrevented).toBe(true);
      key('ArrowRight');
      key('3');
      key('0');
      key('t');
      expect(host.events).toEqual([
        ['prev'], ['next'], ['selectDay', '2026-09-30'], ['selectDay', null], ['jumpTo', '2026-09-30'],
      ]);
      host.week.set('2027-04-05');
      await fixture.whenStable();
      host.events = [];
      key('ArrowRight');
      key('8');
      expect(host.events).toEqual([]);
    });

    it('ignores keys with modifiers, inside fields, and while a dialog is open', async () => {
      const { host, el } = await setup();
      key('ArrowLeft', { metaKey: true });
      key('1', { ctrlKey: true });

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      input.remove();

      const dlg = document.createElement('dialog');
      dlg.setAttribute('open', '');
      document.body.appendChild(dlg);
      key('ArrowRight');
      dlg.remove();
      expect(host.events).toEqual([]);
      expect(el).toBeTruthy();
    });
  });
});
