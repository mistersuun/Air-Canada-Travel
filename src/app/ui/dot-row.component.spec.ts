import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DotDay, DotRowComponent, dotsLabel, entryDots } from './dot-row.component';
import type { RouteEntry } from '../utils/routes';

describe('dot row helpers', () => {
  it('labels the operating days', () => {
    expect(dotsLabel(['on', 'on', 'off', 'on', 'off', 'off', 'off'])).toBe('Flies Mon, Tue, Thu');
    expect(dotsLabel(Array(7).fill('on'))).toBe('Flies daily');
    expect(dotsLabel(['on', 'connect', 'off', 'off', 'off', 'off', 'off'])).toBe('Flies Mon; connections Tue');
    expect(dotsLabel(['connect', 'off', 'off', 'off', 'off', 'off', 'off'])).toBe('Connections Mon');
    expect(dotsLabel(Array(7).fill('off'))).toBe('No flights this week');
    expect(dotsLabel(Array(7).fill('outside'))).toBe('Schedules not yet published');
  });

  it('derives dots from a route entry', () => {
    const day = (flies: boolean, coverage: 'covered' | 'outside' = 'covered') => ({ flies, coverage });
    const e = {
      weekDays: [day(true), day(false), day(false), day(false, 'outside'), day(false), day(false), day(false)],
      weekSummary: { days: [{}, { connections: 2 }, { connections: 0 }, {}, {}, {}, {}] },
    } as unknown as RouteEntry;
    expect(entryDots(e)).toEqual(['on', 'connect', 'off', 'outside', 'off', 'off', 'off']);
  });
});

describe('DotRowComponent', () => {
  it('renders seven dots with states, the selected ring and an aria label', async () => {
    const fixture = TestBed.createComponent(DotRowComponent);
    const days: DotDay[] = ['on', 'off', 'connect', 'outside', 'on', 'on', 'on'];
    fixture.componentRef.setInput('days', days);
    fixture.componentRef.setInput('selected', 2);
    fixture.componentRef.setInput('size', 'sm');
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const dots = [...el.querySelectorAll('i')];
    expect(dots.map(d => d.className.replace(/\s*sel/, '').trim())).toEqual(days);
    expect(dots[2].classList).toContain('sel');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Flies Mon, Fri, Sat, Sun; connections Wed');
    expect(el.classList).toContain('is-sm');
  });
});
