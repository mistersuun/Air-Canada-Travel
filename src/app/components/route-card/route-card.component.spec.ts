import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RouteCardComponent, spaceFlightNumber } from './route-card.component';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { RouteEntry, computeRoutes } from '../../utils/routes';

const WEEK = '2026-10-05'; // Mon; fixtures: YUL→ATH Mon/Wed/Fri x2, YUL→LHR daily 22:10→10:00(+1)

function entry(home: string, dest: string, dateKey: string | null, weekStartKey = WEEK): RouteEntry {
  const e = computeRoutes({ home, weekStartKey, dateKey, region: 'All', showConnections: true })
    .find(r => r.destination.code === dest);
  if (!e) throw new Error(`no entry ${home}→${dest} ${dateKey}`);
  return e;
}

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(RouteCardComponent);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = () => el.textContent!.replace(/\s+/g, ' ');
  return { fixture, el, text, cmp: fixture.componentInstance };
}

describe('RouteCardComponent', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  it('formats flight numbers with a space', () => {
    expect(spaceFlightNumber('AC864')).toBe('AC 864');
    expect(spaceFlightNumber(null)).toBe('');
    expect(spaceFlightNumber('XYZ')).toBe('XYZ');
  });

  it('shows an overnight arrival with a superscript +1 and the real flight/aircraft chips', () => {
    const { el, text } = render({ entry: entry('YUL', 'LHR', '2026-10-06'), selectedDateKey: '2026-10-06', hubName: 'Montreal' });
    expect(text()).toContain('22:10');
    const sup = el.querySelector('.card__arr sup.ui-dayoff')!;
    expect(sup.textContent).toBe('+1');
    expect(sup.getAttribute('aria-label')).toBe('next day');
    expect(el.querySelector('.card__arr')!.textContent).toContain('10:00');
    const chips = [...el.querySelectorAll('.ui-chip-mono')].map(c => c.textContent!.trim());
    expect(chips).toEqual(['AC 864', '333']);
    expect(text()).toContain('6h 50m · direct');
    expect(el.querySelectorAll('.ui-code')[0].textContent).toBe('YUL');
    expect(el.querySelector('.card__lbl')!.textContent).toBe('Montreal');
  });

  it('shows +2 for a two-calendar-day arrival', () => {
    const { el } = render({ entry: entry('YVR', 'SYD', '2026-10-06'), selectedDateKey: '2026-10-06' });
    expect(el.querySelector('.card__arr sup')!.textContent).toBe('+2');
  });

  it('day stub: departs/arrives dates, flight, aircraft, duration, operates', () => {
    const { el } = render({ entry: entry('YUL', 'LHR', '2026-10-06'), selectedDateKey: '2026-10-06' });
    const values = [...el.querySelectorAll('.ui-stub__value')].map(v => v.textContent!.trim());
    expect(values).toEqual(['Tue, Oct 6', 'Wed, Oct 7', 'AC 864', '333', '6h 50m', 'Daily']);
    expect(el.querySelector('.card__more')).toBeNull();
    expect(el.querySelector('.card__week')).toBeNull();
  });

  it('multi-flight day: ×2 badge, first flight in the stub and a "+1 more" link that opens the modal', () => {
    const { el, fixture } = render({ entry: entry('YUL', 'ATH', '2026-10-05'), selectedDateKey: '2026-10-05' });
    const chips = [...el.querySelectorAll('.ui-chip-mono')].map(c => c.textContent!.trim());
    expect(chips).toContain('×2');
    expect(chips[0]).toBe('AC 898 +1');
    const values = [...el.querySelectorAll('.ui-stub__value')].map(v => v.textContent!.trim());
    expect(values[2]).toBe('AC 898');
    expect(values[5]).toBe('Mo We Fr');
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);
    const more = el.querySelector<HTMLButtonElement>('.card__more')!;
    expect(more.textContent).toContain('+1 more flight this day');
    more.click();
    expect(opened).toBe(1);
  });

  it('week mode: seven segments with full-day aria labels and a ×2 marker on double days', () => {
    const { el, text } = render({ entry: entry('YUL', 'ATH', null), selectedDateKey: null });
    const segs = [...el.querySelectorAll('.ui-seg')];
    expect(segs.length).toBe(7);
    expect(segs[0].getAttribute('aria-label')).toBe('Monday Oct 5: 2 direct flights');
    expect(segs[0].classList).toContain('ui-seg--direct');
    expect(segs[1].getAttribute('aria-label')).toMatch(/^Tuesday Oct 6: /);
    expect(segs[1].classList).not.toContain('ui-seg--direct');
    expect(el.querySelectorAll('.card__day b').length).toBe(3);
    expect(el.querySelector('.card__day b')!.textContent).toBe('×2');
    expect(text()).toContain('3 days direct');
    expect(el.querySelector('.ui-stub')).toBeNull();
  });

  it('week mode: days beyond published coverage are marked outside, not empty', () => {
    // Fixture coverage ends 2027-03-31 (Wed); Thu–Sun of that week are unpublished.
    const { el } = render({ entry: entry('YUL', 'LHR', null, '2027-03-29'), selectedDateKey: null });
    const segs = [...el.querySelectorAll('.ui-seg')];
    expect(segs[2].classList).toContain('ui-seg--direct');
    expect(segs[3].classList).toContain('ui-seg--outside');
    expect(segs[3].getAttribute('aria-label')).toBe('Thursday Apr 1: schedule not yet published');
  });

  it('connection via an estimated leg: warning chip with title, dashed first segment and hub on the line', () => {
    const { el, text } = render({ entry: entry('YUL', 'SYD', '2026-10-05'), selectedDateKey: '2026-10-05' });
    const est = el.querySelector('.card__est')!;
    expect(est.textContent).toContain('Leg 1 estimated');
    expect(est.getAttribute('title')).toContain('verify in the Air Canada app');
    const dash = el.querySelector('.card__dash')!;
    expect(dash.classList).not.toContain('card__dash--second');
    expect(el.querySelector('.ui-route-line__hub')!.textContent).toBe('YVR');
    expect(text()).toContain('1 stop via YVR');
    expect(el.querySelector('.ui-chip--connect')).toBeTruthy();
  });

  it('weekly connection card never shows a blank via', () => {
    const { el, text } = render({ entry: entry('YOW', 'ATH', null), selectedDateKey: null });
    expect(el.querySelector('.card__weeksum')!.textContent).toMatch(/^via YUL · \d+ days?$/);
    expect(text()).toContain('Estimated leg');
    expect(el.querySelectorAll('.ui-seg--connect').length).toBeGreaterThan(0);
  });

  it('a real (published) connection has no estimated chip', () => {
    const { el } = render({ entry: entry('YHZ', 'LHR', '2026-10-05'), selectedDateKey: '2026-10-05' });
    expect(el.querySelector('.card__est')).toBeNull();
    expect(el.querySelector('.card__dash')).toBeNull();
    const chips = [...el.querySelectorAll('.ui-chip-mono')].map(c => c.textContent!.trim());
    expect(chips).toEqual(['AC 603', 'AC 848']);
  });

  it('12h time format', () => {
    const { el } = render({ entry: entry('YUL', 'LHR', '2026-10-06'), selectedDateKey: '2026-10-06', timeFormat: '12h' });
    expect(el.querySelector('.ui-time')!.textContent).toBe('10:10 PM');
  });

  it('countdown uses depUtc and appears only while the first departure is ahead', () => {
    const e = entry('YUL', 'LHR', '2026-10-06');
    const dep = e.flights[0].depUtc;
    const { el, fixture } = render({ entry: e, selectedDateKey: '2026-10-06', now: dep - (3 * 60 + 12) * 60_000 });
    expect(el.querySelector('.card__countdown')!.textContent).toContain('Departs in 3h 12m');
    fixture.componentRef.setInput('now', dep + 60_000);
    fixture.detectChanges();
    expect(el.querySelector('.card__countdown')).toBeNull();
    fixture.componentRef.setInput('now', null);
    fixture.detectChanges();
    expect(el.querySelector('.card__countdown')).toBeNull();
  });

  it('the card is a dialog button; the star toggles without opening', () => {
    const { el, fixture } = render({ entry: entry('YUL', 'LHR', null), selectedDateKey: null, isFavourite: true });
    const out: string[] = [];
    fixture.componentInstance.open.subscribe(() => out.push('open'));
    fixture.componentInstance.toggleFavourite.subscribe(() => out.push('fav'));
    const hit = el.querySelector<HTMLButtonElement>('.card__hit')!;
    expect(hit.getAttribute('aria-haspopup')).toBe('dialog');
    expect(hit.getAttribute('aria-label')).toMatch(/^London, United Kingdom, LHR\. Direct\. departs 22:10, arrives 10:00 next day/);
    const star = el.querySelector<HTMLButtonElement>('.card__fav')!;
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.getAttribute('aria-label')).toBe('Unstar London');
    star.click();
    hit.click();
    expect(out).toEqual(['fav', 'open']);
  });

  it('uses region tokens, never hex colours', () => {
    const { el } = render({ entry: entry('YUL', 'LHR', null), selectedDateKey: null });
    const style = el.querySelector<HTMLElement>('.card')!.getAttribute('style') ?? '';
    expect(style).toContain('--region-europe');
    expect(style).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
