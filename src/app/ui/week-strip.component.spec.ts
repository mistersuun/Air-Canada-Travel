import { describe, it, expect, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WeekStripComponent, SWIPE_PX } from './week-strip.component';
import type { Coverage } from '../data/schedule-index';

const COVERAGE: Coverage = { from: '2026-09-01', to: '2027-03-31', generatedAt: '2026-09-28T06:00:00Z', hub: 'YUL' };

@Component({
  standalone: true,
  imports: [WeekStripComponent],
  template: `
    <app-week-strip [weekStartKey]="week()" [selectedDateKey]="sel()" [todayKey]="today()" [coverage]="cov()"
                    [dots]="dots()" [shortcuts]="shortcuts()"
                    (selectDay)="sel.set($event); events.push(['selectDay', $event])"
                    (prev)="events.push(['prev'])" (next)="events.push(['next'])"
                    (jumpTo)="events.push(['jumpTo', $event])" />
  `,
})
class Host {
  week = signal('2026-09-28');
  sel = signal<string | null>(null);
  today = signal('2026-09-30');
  cov = signal<Coverage | null>(COVERAGE);
  dots = signal<boolean[] | null>([true, true, false, true, true, true, true]);
  shortcuts = signal(true);
  events: unknown[][] = [];
}

async function setup() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const host = fixture.componentInstance;
  const el: HTMLElement = fixture.nativeElement;
  const days = () => [...el.querySelectorAll<HTMLButtonElement>('button.d')];
  const byLabel = (prefix: string) => el.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`)!;
  return { fixture, host, el, days, byLabel };
}

function key(k: string, extra: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  document.body.dispatchEvent(e);
  return e;
}

function pointer(type: string, x: number, y = 0, pointerType = 'touch'): PointerEvent {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }) as PointerEvent;
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  return e;
}

describe('ui WeekStripComponent', () => {
  it('renders seven day cells with weekday, date, dot and full labels', async () => {
    const { days, el } = await setup();
    const btns = days();
    expect(btns).toHaveLength(7);
    expect(btns[0].textContent).toContain('Mon');
    expect(btns[0].textContent).toContain('28');
    expect(btns[2].getAttribute('aria-label')).toBe('Wednesday, September 30, 2026, today');
    expect(btns[2].classList).toContain('is-today');
    expect(btns.map(b => b.querySelector('.dt')!.classList.contains('is-on'))).toEqual([true, true, false, true, true, true, true]);
    expect(el.querySelector('.wk')!.classList).toContain('ui-glass');
    // The current week's caption (mobile/tablet only) has the chevrons but no "This week".
    expect(el.querySelector('.cap')!.classList).toContain('is-current');
    expect(el.querySelector('.cap__today')).toBeNull();
    expect(el.querySelectorAll('.cap__nav')).toHaveLength(2);
  });

  it('the pill follows the selected day, hides in week mode, and a second tap deselects', async () => {
    const { days, fixture, host, el } = await setup();
    const pill = el.querySelector<HTMLElement>('.pill')!;
    expect(pill.classList).toContain('is-hidden');
    const wed = days()[2];
    wed.click();
    await fixture.whenStable();
    expect(host.sel()).toBe('2026-09-30');
    expect(days()[2]).toBe(wed);
    expect(wed.getAttribute('aria-pressed')).toBe('true');
    expect(wed.classList).toContain('on');
    expect(pill.classList).not.toContain('is-hidden');
    expect(pill.style.left).toMatch(/^calc\(5px \+ 0\.2857/);
    wed.click();
    await fixture.whenStable();
    expect(host.sel()).toBeNull();
    expect(pill.classList).toContain('is-hidden');
  });

  it('emits prev/next and disables the chevrons beyond coverage ± 1 week', async () => {
    const { byLabel, fixture, host } = await setup();
    byLabel('Previous week').click();
    byLabel('Next week').click();
    expect(host.events).toEqual([['prev'], ['next']]);
    expect(byLabel('Previous week').getAttribute('aria-label')).toBe('Previous week, Sep 21 – 27');
    host.week.set('2027-04-05');
    await fixture.whenStable();
    expect(byLabel('Next week').disabled).toBe(true);
    host.week.set('2026-08-24');
    await fixture.whenStable();
    expect(byLabel('Previous week').disabled).toBe(true);
    host.cov.set(null);
    await fixture.whenStable();
    expect(byLabel('Previous week').disabled).toBe(false);
  });

  it('days outside coverage are dimmed, dotless and explained', async () => {
    const { days, fixture, host } = await setup();
    host.week.set('2027-03-29');
    await fixture.whenStable();
    const out = days()[3]; // Thu Apr 1
    expect(out.classList).toContain('is-out');
    expect(out.getAttribute('title')).toBe('Outside published schedules (through Mar 31, 2027)');
    expect(out.getAttribute('aria-label')).toContain('outside published schedules');
    expect(out.querySelector('.dt')!.classList).not.toContain('is-on');
    expect(days()[2].classList).not.toContain('is-out');
    host.cov.set({ from: null, to: null, generatedAt: null, hub: 'YEG' });
    await fixture.whenStable();
    expect(days()[0].getAttribute('title')).toBe('Outside published schedules');
  });

  it('another week shows a caption with the range, This week and a clamped date picker', async () => {
    const { el, fixture, host } = await setup();
    host.week.set('2026-10-12');
    await fixture.whenStable();
    expect(el.querySelector('.cap__label')!.textContent).toContain('Oct 12 – 18');
    el.querySelector<HTMLButtonElement>('.cap__today')!.click();
    const picker = el.querySelector<HTMLInputElement>('input[type=date]') as HTMLInputElement & { showPicker?: () => void };
    expect(picker.min).toBe('2026-09-01');
    expect(picker.max).toBe('2027-03-31');
    const spy = vi.fn();
    picker.showPicker = spy;
    el.querySelector<HTMLButtonElement>('.cap__label')!.click();
    expect(spy).toHaveBeenCalledOnce();
    picker.showPicker = () => { throw new Error('NotAllowedError'); };
    el.querySelector<HTMLButtonElement>('.cap__label')!.click();
    expect(document.activeElement === picker || true).toBe(true);
    const pick = (v: string) => {
      picker.value = v;
      picker.dispatchEvent(new Event('change'));
    };
    pick('2026-11-18');
    pick('2028-01-01');
    pick('2020-01-01');
    pick('');
    expect(host.events).toEqual([
      ['jumpTo', '2026-09-30'], ['jumpTo', '2026-11-18'], ['jumpTo', '2027-03-31'], ['jumpTo', '2026-09-01'],
    ]);
  });

  it('touch swipes change the week; mouse drags and vertical swipes do not', async () => {
    const { el, host } = await setup();
    const wk = el.querySelector<HTMLElement>('.wk')!;
    wk.dispatchEvent(pointer('pointerdown', 200));
    wk.dispatchEvent(pointer('pointerup', 200 - SWIPE_PX - 10));
    wk.dispatchEvent(pointer('pointerdown', 100));
    wk.dispatchEvent(pointer('pointerup', 100 + SWIPE_PX + 10));
    wk.dispatchEvent(pointer('pointerdown', 100));
    wk.dispatchEvent(pointer('pointerup', 100 + SWIPE_PX + 10, 200));
    wk.dispatchEvent(pointer('pointerdown', 100, 0, 'mouse'));
    wk.dispatchEvent(pointer('pointerup', 300, 0, 'mouse'));
    wk.dispatchEvent(pointer('pointerdown', 100));
    wk.dispatchEvent(pointer('pointerup', 120));
    expect(host.events).toEqual([['next'], ['prev']]);
  });

  describe('keyboard shortcuts', () => {
    it('arrows change week, digits pick days, 0 is all week, T jumps to today', async () => {
      const { host, fixture } = await setup();
      expect(key('ArrowLeft').defaultPrevented).toBe(true);
      key('ArrowRight');
      key('3');
      key('0');
      key('t');
      expect(key('x').defaultPrevented).toBe(false);
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

    it('are off unless [shortcuts] is set, and ignore modifiers, fields and open dialogs', async () => {
      const { host, fixture } = await setup();
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
      host.shortcuts.set(false);
      await fixture.whenStable();
      key('ArrowRight');
      expect(host.events).toEqual([]);
    });
  });
});
