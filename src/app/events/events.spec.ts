import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AppStateService } from '../state/app-state.service';
import { EventsCardComponent } from './events-card.component';
import { EVENTS_FETCH, EventsService, RATE_LIMIT_BACKOFF_MS } from './events.service';
import { aroundDay, eventLine, eventsUrl, isTicketmasterUrl, parseEvents, weekBuckets, weekLabel, weekOf } from './events';

const TODAY = '2026-10-06'; // a Tuesday

describe('weekly buckets', () => {
  it('snaps to Monday to Sunday', () => {
    expect(weekOf('2026-10-10')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(weekOf('2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(weekOf('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
  it('uses one or two weeks, never one that is over, and keeps this week even though it started in the past', () => {
    expect(weekBuckets('2026-10-06', '2026-10-06', TODAY)).toEqual([{ from: '2026-10-05', to: '2026-10-11' }]);
    expect(weekBuckets('2026-10-09', '2026-10-13', TODAY)).toHaveLength(2);
    expect(weekBuckets('2026-10-01', '2026-10-03', TODAY)).toEqual([]);
    expect(weekBuckets('2026-09-28', '2026-10-07', TODAY)).toEqual([{ from: '2026-10-05', to: '2026-10-11' }]);
    expect(weekBuckets('2026-10-01', '2026-11-30', TODAY)).toHaveLength(2); // capped at two weeks
    expect(weekBuckets('2027-02-08', '2027-02-09', TODAY)).toEqual([]); // starts beyond 120 days
    expect(weekBuckets('bad', '2026-10-10', TODAY)).toEqual([]);
    expect(weekBuckets('2026-10-12', '2026-10-10', TODAY)).toEqual([]);
  });
  it('is the picked day plus or minus 3, as weeks', () => {
    expect(aroundDay('2026-10-22', TODAY)).toEqual([{ from: '2026-10-19', to: '2026-10-25' }]);
    expect(aroundDay('2026-10-20', TODAY)).toHaveLength(2); // Oct 17 and 18 are the week before
  });
  it('labels the week', () => {
    expect(weekLabel([{ from: '2026-10-05', to: '2026-10-11' }])).toBe('Week of Oct 5');
    expect(weekLabel([{ from: '2026-10-05', to: '2026-10-11' }, { from: '2026-10-12', to: '2026-10-18' }])).toBe('Weeks of Oct 5 and Oct 12');
  });
  it('builds the same-origin URL', () => {
    expect(eventsUrl('LIS', { from: '2026-10-05', to: '2026-10-11' })).toBe('/.netlify/functions/events?code=LIS&from=2026-10-05&to=2026-10-11');
  });
});

describe('parseEvents / eventLine', () => {
  const good = { name: 'Coldplay', url: 'https://www.ticketmaster.pt/e/1', date: '2026-10-10', time: '20:00', venue: 'Estádio da Luz', segment: 'Music' };
  it('keeps valid allowlisted events only', () => {
    const r = parseEvents({ events: [good, { ...good, url: 'javascript:alert(1)' }, { ...good, url: 'http://www.ticketmaster.pt/e' }, { ...good, url: 'https://evil.example/' }, { ...good, date: 'x' }, null], fetchedAt: 'z' });
    expect(r?.events).toEqual([good]);
    expect(parseEvents(null)).toBeNull();
    expect(parseEvents({ events: 'x' })).toBeNull();
  });
  it('allowlists Ticketmaster hosts exactly', () => {
    expect(isTicketmasterUrl('https://www.ticketmaster.com.mx/e')).toBe(true);
    expect(isTicketmasterUrl('https://ticketmaster.com.evil.io/')).toBe(false);
    expect(isTicketmasterUrl('https://eviticketmaster.com/')).toBe(false);
  });
  it('formats the line', () => {
    expect(eventLine(good)).toBe('Sat Oct 10 · 20:00 · Coldplay · Estádio da Luz');
    expect(eventLine({ ...good, time: null, venue: '' })).toBe('Sat Oct 10 · Coldplay');
    expect(eventLine(good, '12h')).toContain('8:00 PM');
    expect(eventLine({ ...good, rescheduled: true })).toMatch(/ · rescheduled$/);
  });
});

describe('EventsService', () => {
  function setup(fetcher: (u: string) => Promise<{ status: number; body: unknown }>) {
    TestBed.configureTestingModule({ providers: [{ provide: EVENTS_FETCH, useValue: fetcher }] });
    return TestBed.inject(EventsService);
  }
  const w = { from: '2026-10-05', to: '2026-10-11' };
  const w2 = { from: '2026-10-12', to: '2026-10-18' };
  it('is silent on 503 and then asks nothing for anyone for a while', async () => {
    const calls: string[] = [];
    const svc = setup(async u => { calls.push(u); return { status: 503, body: { error: 'not-configured' } }; });
    await svc.load('LIS', w);
    expect(svc.result('LIS', w)).toBeNull();
    await svc.load('LIS', w2);
    expect(calls).toHaveLength(1);
    expect(svc.result('LIS', w2)).toBeNull(); // answered "nothing", not left waiting
  });
  it('a 429 backs off only that key, and shortly', async () => {
    const calls: string[] = [];
    const svc = setup(async u => { calls.push(u); return u.includes('LIS') ? { status: 429, body: null } : { status: 200, body: { events: [] } }; });
    await svc.load('LIS', w);
    await svc.load('LIS', w);
    expect(calls).toHaveLength(1);
    await svc.load('OPO', w); // another key is still asked
    expect(calls).toHaveLength(2);
    expect(svc.result('OPO', w)?.events).toEqual([]);
    const state = TestBed.inject(AppStateService);
    state.nowMs.set(state.nowMs() + RATE_LIMIT_BACKOFF_MS + 1000);
    await svc.load('LIS', w);
    expect(calls).toHaveLength(3);
  });
  it('treats network errors as nothing to show, and does not repeat them', async () => {
    let n = 0;
    const svc = setup(async () => { n++; throw new Error('offline'); });
    await svc.load('LIS', w);
    expect(svc.result('LIS', w)).toBeNull();
    await svc.load('LIS', w);
    expect(n).toBe(1);
  });
});

describe('EventsCardComponent', () => {
  const good = { name: 'Coldplay', url: 'https://www.ticketmaster.pt/e/1', date: '2026-10-10', time: '20:00', venue: 'Estádio da Luz', segment: 'Music' };
  function render(fetcher: () => Promise<{ status: number; body: unknown }>, from = '2026-10-10', to = '2026-10-12', verbose = false) {
    TestBed.configureTestingModule({ providers: [{ provide: EVENTS_FETCH, useValue: fetcher }] });
    TestBed.inject(AppStateService).nowMs.set(Date.parse('2026-10-06T15:00:00Z'));
    const f = TestBed.createComponent(EventsCardComponent);
    f.componentRef.setInput('code', 'LIS');
    f.componentRef.setInput('from', from);
    f.componentRef.setInput('to', to);
    f.componentRef.setInput('verbose', verbose);
    return f;
  }
  async function settle(f: ReturnType<typeof render>) {
    f.detectChanges();
    await f.whenStable();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
  }
  it('renders linked events with a week label, Ticketmaster attribution and no prices', async () => {
    const f = render(async () => ({ status: 200, body: { events: [good], source: 'Ticketmaster', fetchedAt: 'x' } }), '2026-10-10', '2026-10-11');
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const sec = el.querySelector('[data-events]')!;
    expect(el.querySelector('#' + sec.getAttribute('aria-labelledby'))?.textContent).toContain('Week of');
    const a = el.querySelector<HTMLAnchorElement>('[data-events] ul a')!;
    expect(a.textContent).toContain('Sat Oct 10 · 20:00 · Coldplay · Estádio da Luz');
    expect(a.textContent).toContain('(opens in a new tab)');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.getAttribute('href')).toBe('https://www.ticketmaster.pt/e/1');
    const cred = el.querySelector<HTMLAnchorElement>('.ev__c a')!;
    expect(cred.textContent).toContain('Ticketmaster');
    expect(el.textContent).not.toMatch(/[$€£]/);
  });
  it('asks for both weeks when the range spans two', async () => {
    const urls: string[] = [];
    const f = render(async () => { urls.push('x'); return { status: 200, body: { events: [] } }; }, '2026-10-10', '2026-10-13');
    await settle(f);
    expect(urls).toHaveLength(2);
  });
  it('renders nothing when unavailable, unless verbose', async () => {
    const quiet = render(async () => ({ status: 503, body: { error: 'not-configured' } }));
    await settle(quiet);
    expect((quiet.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });
  it('verbose shows Looking… and then No events listed', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const f = render(async () => { await gate; return { status: 200, body: { events: [] } }; }, '2026-10-10', '2026-10-12', true);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Looking…');
    release();
    await settle(f);
    expect((f.nativeElement as HTMLElement).textContent).toContain('No events listed');
  });
  it('does not ask for a range entirely in the past', async () => {
    let n = 0;
    const f = render(async () => { n++; return { status: 200, body: { events: [] } }; }, '2026-09-01', '2026-09-03');
    await settle(f);
    expect(n).toBe(0);
  });
});
