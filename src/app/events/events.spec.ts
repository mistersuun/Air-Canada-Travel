import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AppStateService } from '../state/app-state.service';
import { EventsCardComponent } from './events-card.component';
import { EVENTS_FETCH, EventsService } from './events.service';
import { aroundDay, clampWindow, eventLine, eventsUrl, parseEvents } from './events';

const TODAY = '2026-10-06';

describe('windows', () => {
  it('clamps to today, 7 days and 120 days', () => {
    expect(clampWindow('2026-10-01', '2026-10-03', TODAY)).toBeNull();
    expect(clampWindow('2026-10-03', '2026-10-08', TODAY)).toEqual({ from: TODAY, to: '2026-10-08' });
    expect(clampWindow('2026-10-10', '2026-10-30', TODAY)).toEqual({ from: '2026-10-10', to: '2026-10-16' });
    expect(clampWindow('2027-02-01', '2027-02-10', TODAY)).toEqual({ from: '2027-02-01', to: '2027-02-03' });
    expect(clampWindow('2027-02-04', '2027-02-10', TODAY)).toBeNull();
    expect(clampWindow('bad', '2026-10-10', TODAY)).toBeNull();
    expect(clampWindow('2026-10-12', '2026-10-10', TODAY)).toBeNull();
  });
  it('is the picked day plus or minus 3', () => {
    expect(aroundDay('2026-10-20', TODAY)).toEqual({ from: '2026-10-17', to: '2026-10-23' });
    expect(aroundDay('2026-10-07', TODAY)).toEqual({ from: TODAY, to: '2026-10-10' });
  });
  it('builds the same-origin URL', () => {
    expect(eventsUrl('LIS', { from: '2026-10-10', to: '2026-10-12' })).toBe('/.netlify/functions/events?code=LIS&from=2026-10-10&to=2026-10-12');
  });
});

describe('parseEvents / eventLine', () => {
  const good = { name: 'Coldplay', url: 'https://www.ticketmaster.pt/e/1', date: '2026-10-10', time: '20:00', venue: 'Estádio da Luz', segment: 'Music' };
  it('keeps valid https events only', () => {
    const r = parseEvents({ events: [good, { ...good, url: 'javascript:alert(1)' }, { ...good, url: 'http://x' }, { ...good, date: 'x' }, null], fetchedAt: 'z' });
    expect(r?.events).toEqual([good]);
    expect(parseEvents(null)).toBeNull();
    expect(parseEvents({ events: 'x' })).toBeNull();
  });
  it('formats the line', () => {
    expect(eventLine(good)).toBe('Sat Oct 10 · 20:00 · Coldplay · Estádio da Luz');
    expect(eventLine({ ...good, time: null, venue: '' })).toBe('Sat Oct 10 · Coldplay');
    expect(eventLine(good, '12h')).toContain('8:00 PM');
  });
});

describe('EventsService', () => {
  function setup(fetcher: (u: string) => Promise<{ status: number; body: unknown }>) {
    TestBed.configureTestingModule({ providers: [{ provide: EVENTS_FETCH, useValue: fetcher }] });
    return TestBed.inject(EventsService);
  }
  const w = { from: '2026-10-10', to: '2026-10-12' };
  it('is silent on 404/503/throws and backs off after a refusal', async () => {
    const calls: string[] = [];
    const svc = setup(async u => { calls.push(u); return { status: 503, body: { error: 'not-configured' } }; });
    await svc.load('LIS', w);
    expect(svc.result('LIS', w)).toBeNull();
    await svc.load('LIS', { from: '2026-10-11', to: '2026-10-12' });
    expect(calls).toHaveLength(1);
  });
  it('treats network errors as nothing to show, and caches successes', async () => {
    let n = 0;
    const svc = setup(async () => { n++; throw new Error('offline'); });
    await svc.load('LIS', w);
    expect(svc.result('LIS', w)).toBeNull();
    await svc.load('LIS', w);
    expect(n).toBe(1);
  });
});

describe('EventsCardComponent', () => {
  function render(status: number, body: unknown, from = '2026-10-10', to = '2026-10-12') {
    TestBed.configureTestingModule({ providers: [{ provide: EVENTS_FETCH, useValue: async () => ({ status, body }) }] });
    TestBed.inject(AppStateService).nowMs.set(Date.parse('2026-10-06T15:00:00Z'));
    const f = TestBed.createComponent(EventsCardComponent);
    f.componentRef.setInput('code', 'LIS');
    f.componentRef.setInput('from', from);
    f.componentRef.setInput('to', to);
    return f;
  }
  it('renders linked events with Ticketmaster attribution and no prices', async () => {
    const f = render(200, { events: [{ name: 'Coldplay', url: 'https://www.ticketmaster.pt/e/1', date: '2026-10-10', time: '20:00', venue: 'Estádio da Luz', segment: 'Music' }], source: 'Ticketmaster', fetchedAt: 'x' });
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const a = el.querySelector<HTMLAnchorElement>('[data-events] ul a')!;
    expect(a.textContent).toBe('Sat Oct 10 · 20:00 · Coldplay · Estádio da Luz');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.getAttribute('href')).toBe('https://www.ticketmaster.pt/e/1');
    const cred = el.querySelector<HTMLAnchorElement>('.ev__c a')!;
    expect(cred.textContent).toBe('Ticketmaster');
    expect(el.textContent).not.toMatch(/[$€£]/);
  });
  it('renders nothing when unavailable', async () => {
    const f = render(503, { error: 'not-configured' });
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-events]')).toBeNull();
  });
  it('does not ask for a window entirely in the past', async () => {
    let n = 0;
    TestBed.configureTestingModule({ providers: [{ provide: EVENTS_FETCH, useValue: async () => { n++; return { status: 200, body: { events: [] } }; } }] });
    TestBed.inject(AppStateService).nowMs.set(Date.parse('2026-10-06T15:00:00Z'));
    const f = TestBed.createComponent(EventsCardComponent);
    f.componentRef.setInput('code', 'LIS');
    f.componentRef.setInput('from', '2026-09-01');
    f.componentRef.setInput('to', '2026-09-03');
    f.detectChanges();
    await f.whenStable();
    expect(n).toBe(0);
  });
});
