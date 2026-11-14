import { afterEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setLocale } from '../i18n/locale';
import type { DayCount } from '../planner/round-trip';
import { DayCountStripComponent } from './day-count-strip.component';

function count(key: string, state: DayCount['state'], total = 0, direct = total, extra: Partial<DayCount> = {}): DayCount {
  return {
    key, state, total, direct, connecting: total - direct, hidden: 0,
    first: total ? '18:05' : null, last: total ? '22:10' : null, ...extra,
  };
}

const OUT: DayCount[] = [
  count('2026-11-13', 'past'),
  count('2026-11-19', 'ok', 1),
  count('2026-11-20', 'ok', 2),
  count('2026-11-21', 'ok', 1, 0),
  count('2026-11-22', 'none'),
  count('2027-03-29', 'unpublished'),
];

@Component({
  standalone: true,
  imports: [DayCountStripComponent],
  template: `
    <app-day-count-strip [days]="days()" [selected]="sel()" [variant]="variant()" label="x"
                         (pick)="picks.push($event)" (extend)="extends.push($event)" />
  `,
})
class Host {
  days = signal<DayCount[]>(OUT);
  sel = signal<string | null>('2026-11-20');
  variant = signal<'out' | 'home'>('out');
  picks: string[] = [];
  extends: number[] = [];
}

async function setup() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const cells = () => [...el.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const lines = (b: HTMLElement) => [...b.querySelectorAll('span')].map(s => s.textContent!.trim());
  return { fixture, host: fixture.componentInstance, el, cells, lines };
}

describe('ui DayCountStripComponent', () => {
  afterEach(() => setLocale('en'));

  it('is a listbox of days: three lines each, the picked day selected, markers by kind', async () => {
    const { el, cells, lines } = await setup();
    expect(el.querySelector('[role="listbox"]')!.getAttribute('aria-label')).toBe('x');
    const c = cells();
    expect(c).toHaveLength(6);
    expect(lines(c[2])).toEqual(['Fri 20', '2 flights', '18:05']);
    expect(c[2].getAttribute('aria-selected')).toBe('true');
    expect(c[2].classList).toContain('is-sel');
    expect(c[1].getAttribute('aria-selected')).toBe('false');
    expect(c[2].getAttribute('tabindex')).toBe('0');
    expect(c[1].getAttribute('tabindex')).toBe('-1');
    expect(c[2].querySelector('.dm--solid')).not.toBeNull();
    expect(c[3].querySelector('.dm--dotted')).not.toBeNull();
    expect(c[4].querySelector('.dm--none')).not.toBeNull();
    expect(c[5].classList).toContain('dm--hatch');
    expect(c[2].getAttribute('aria-label')).toBe('Friday, November 20, 2026, 2 flights out');
  });

  it('every closed day is aria-disabled and says why in words (1.4.1)', async () => {
    const { cells, lines } = await setup();
    const closed = cells().filter(b => b.getAttribute('aria-disabled') === 'true');
    expect(closed.map(b => b.dataset['key'])).toEqual(['2026-11-13', '2026-11-22', '2027-03-29']);
    for (const b of closed) expect(lines(b)[1]).not.toBe('');
    expect(lines(cells()[4])).toEqual(['Sun 22', '0 flights', '–']);
    expect(cells()[4].classList).toContain('is-zero');
    expect(lines(cells()[5])[1]).toBe('not published');
    expect(cells()[0].getAttribute('aria-label')).toBe('Friday, November 13, 2026, past');
  });

  it('ways home: nights and "3 home"; a zero day has a dashed border and "0 home"', async () => {
    const { fixture, host, cells, lines } = await setup();
    host.variant.set('home');
    host.days.set([
      count('2026-11-19', 'before-dep'),
      count('2026-11-28', 'ok', 3, 3, { nights: 8 }),
      count('2026-11-29', 'none', 0, 0, { nights: 9 }),
    ]);
    host.sel.set(null);
    await fixture.whenStable();
    expect(lines(cells()[1])).toEqual(['Sat 28', '8 nights', '3 home']);
    expect(lines(cells()[2])).toEqual(['Sun 29', '9 nights', '0 home']);
    expect(cells()[2].classList).toContain('is-zero');
    expect(cells()[0].getAttribute('aria-label')).toBe('Thursday, November 19, 2026, before you leave');
    expect(cells()[1].getAttribute('aria-label')).toBe('Saturday, November 28, 2026, 3 ways home, 8 nights');
    expect(cells()[0].getAttribute('tabindex')).toBe('0');   // nothing selected: the first takes Tab
  });

  it('emits picks and extends; arrows move the focus', async () => {
    const { fixture, host, el, cells } = await setup();
    cells()[1].click();
    cells()[4].click();
    expect(host.picks).toEqual(['2026-11-19', '2026-11-22']);
    const navs = [...el.querySelectorAll<HTMLButtonElement>('.dcs__nav')];
    navs[0].click();
    navs[1].click();
    expect(host.extends).toEqual([-1, 1]);
    cells()[2].focus();
    cells()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(cells()[3]);
    expect(cells()[3].getAttribute('tabindex')).toBe('0');
  });

  it('loading days show "·" and emit nothing', async () => {
    const { fixture, host, cells, lines } = await setup();
    host.days.set([count('2026-11-20', 'loading')]);
    await fixture.whenStable();
    expect(lines(cells()[0])[1]).toBe('·');
    cells()[0].click();
    expect(host.picks).toEqual([]);
  });

  it('cells and chevrons are at least 44 px', async () => {
    const { el, cells } = await setup();
    const cell = getComputedStyle(cells()[0]);
    expect(parseFloat(cell.minHeight)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(cell.minWidth)).toBeGreaterThanOrEqual(44);
    const nav = getComputedStyle(el.querySelector('.dcs__nav')!);
    expect(parseFloat(nav.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('speaks French', async () => {
    setLocale('fr');
    const { cells, lines } = await setup();
    expect(lines(cells()[2])).toEqual(['ven. 20', '2 vols', '18:05']);
    expect(cells()[2].getAttribute('aria-label')).toBe('vendredi 20 novembre 2026, 2 vols aller');
    expect(lines(cells()[5])[1]).toBe('non publié');
  });
});
