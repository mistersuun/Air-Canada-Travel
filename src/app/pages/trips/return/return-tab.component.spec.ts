import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import { AppStateService, NOW } from '../../../state/app-state.service';
import { PREFS_KEY, PREFS_STORAGE } from '../../../state/prefs.service';
import { MemoryStorage } from '../../../state/testing';
import type { MissStep } from '../../../trips/engine/homeby';
import { TRIPS_KEY, type Trip, type TripsFile } from '../../../trips/model';
import { TRIPS_STORAGE } from '../../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../../trips/testing/seville-fixture';
import { TripsService } from '../../../trips/trips.service';
import { directItineraries } from '../../../utils/connections';
import { toUtcMs } from '../../../utils/time';
import { DestHomeByComponent } from '../../destination/dest-home-by.component';
import { MissChainComponent } from './miss-chain.component';
import { ReturnTabComponent, parseDeadline } from './return-tab.component';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function configure(trip: Trip, minConnect = 120) {
  const store = new MemoryStorage();
  const file: TripsFile = { schema: 1, trips: [trip] };
  store.setItem(TRIPS_KEY, JSON.stringify(file));
  const prefs = new MemoryStorage();
  prefs.setItem(PREFS_KEY, JSON.stringify({ minConnect }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: prefs },
    ],
  });
  return store;
}

async function renderTab(trip = sevilleTrip(), minConnect = 120) {
  const store = configure(trip, minConnect);
  const trips = TestBed.inject(TripsService);
  const fixture = TestBed.createComponent(ReturnTabComponent);
  fixture.componentRef.setInput('trip', trips.trip(trip.id)!);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const refresh = async () => {
    fixture.componentRef.setInput('trip', trips.trip(trip.id)!);
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel: string) => clean(el.querySelector(sel)?.textContent);
  const texts = (sel: string) => [...el.querySelectorAll(sel)].map(n => clean(n.textContent));
  const stat = (k: string) => `${text(`[data-${k}] b`)} | ${text(`[data-${k}] small`)}`;
  return { fixture, el, trips, store, refresh, text, texts, stat, state: TestBed.inject(AppStateService) };
}

describe('ReturnTabComponent (g3)', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('counts from another airport (?retFrom=), and Other airports rows switch it instead of leaving the tab', async () => {
    const { fixture, el, text } = await renderTab();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('from', 'MAD');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text('[data-context]')).toBe('Seville trip · from Madrid · Back to Lisbon');
    (el.querySelector('[data-reset]') as HTMLButtonElement).click();
    expect(nav.mock.calls[0][1]?.queryParams).toEqual({ retFrom: null });
    fixture.componentRef.setInput('from', null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text('[data-context]')).toBe('Seville trip · from Lisbon');
    (el.querySelector('[data-other="MAD"]') as HTMLButtonElement).click();
    expect(nav.mock.calls[1][1]?.queryParams).toEqual({ retFrom: 'MAD' });
    // The home airport is never a "from".
    fixture.componentRef.setInput('from', 'YUL');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text('[data-context]')).toBe('Seville trip · from Lisbon');
  });

  it('matches the g3 copy with minConnect 120', async () => {
    const { el, text, texts, stat } = await renderTab();
    expect(text('.rt__ctx h2')).toBe('Getting home');
    expect(text('[data-context]')).toBe('Seville trip · from Lisbon');
    expect(text('[data-deadline]')).toBe('Home by Tue Oct 13, 22:00');
    expect(stat('fly')).toBe('2 tries | if you fly Tue');
    expect(stat('start')).toBe('4 tries | if you start Mon');
    expect(text('.rt__h h3')).toBe('If you try Tuesday');
    expect(texts('app-miss-chain .mc__t')).toEqual([
      'Try 1 · AC813 LIS 11:25 → YUL 13:50',
      'If you miss it · AC811 LIS 13:00 → YYZ 15:55',
      'If you miss both',
    ]);
    expect(texts('app-miss-chain .mc__m')).toEqual([
      'Home with 8h to spare',
      'then AC422 YYZ 18:00 → YUL 19:21 · 2 standby legs',
      'Next is AC813 Wed Oct 14 · lands after your deadline',
    ]);
    expect(text('[data-info]')).toBe(
      'Being in Lisbon by Monday morning adds AC813 and AC811 on Oct 12: 4 tries before the deadline instead of 2.');
    expect(text('[data-other="MAD"] .rt__rt')).toBe('Madrid MAD · Mon: AC835 to YUL, AC825 to YYZ · Tue: AC825 only · count tries from Madrid');
    expect(el.querySelector('[data-unknown]')).toBeNull();
    // A return leg exists: no "Use as return".
    expect(el.querySelector('.mc__act')).toBeNull();
    // Facts carry their provenance.
    expect(text('.rt__h app-provenance-tag')).toBe('Scheduled');
  });

  it('Change sets a new deadline and the counts update', async () => {
    const { el, trips, refresh, text, stat } = await renderTab();
    el.querySelector<HTMLButtonElement>('[data-change]')!.click();
    await refresh();
    const input = document.querySelector<HTMLInputElement>('[data-deadline-input]')!;
    expect(input.value).toBe('2026-10-13T22:00');
    input.value = '2026-10-13T19:00';
    input.dispatchEvent(new Event('input'));
    await refresh();
    document.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await refresh();
    expect(trips.trip(SEVILLE_IDS.trip)!.homeBy).toEqual({ dateKey: '2026-10-13', hhmm: '19:00' });
    expect(text('[data-deadline]')).toBe('Home by Tue Oct 13, 19:00');
    expect(stat('fly')).toBe('1 try | if you fly Tue');
    expect(stat('start')).toBe('3 tries | if you start Mon');
    expect(document.querySelector('[data-deadline-input]')).toBeNull();
  });

  it('With no return leg, "Use as return" adds one (with Undo)', async () => {
    const t = sevilleTrip();
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.ret);
    const { el, trips, refresh, state } = await renderTab(t);
    const buttons = el.querySelectorAll<HTMLButtonElement>('.mc__act');
    expect(buttons).toHaveLength(2);
    expect(clean(buttons[0].textContent)).toBe('Use as return');
    buttons[1].click();
    await refresh();
    const ret = trips.trip(t.id)!.legs.filter(l => l.kind === 'flight' && l.role === 'return');
    expect(ret).toHaveLength(1);
    expect(ret[0].kind === 'flight' && ret[0].refs.map(r => r.flightNumber)).toEqual(['AC811', 'AC422']);
    expect(state.notice()?.message).toBe('Added AC811 + AC422 as your return · Listing is still your step');
    expect(el.querySelector('.mc__act')).toBeNull();
    state.notice()!.action!();
    expect(trips.trip(t.id)!.legs.some(l => l.kind === 'flight' && l.role === 'return')).toBe(false);
  });

  it('with minConnect 60 the fallback is AC811 then AC894', async () => {
    const { texts } = await renderTab(sevilleTrip(), 60);
    expect(texts('app-miss-chain .mc__m')[1]).toBe('then AC894 YYZ 17:30 → YUL 18:52 · 2 standby legs');
  });

  it('days outside the published schedules say Unknown', async () => {
    const t = sevilleTrip();
    t.outboundDate = '2027-10-01';
    t.homeBy = { dateKey: '2027-10-05', hhmm: '22:00' };
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.ret);
    const { el, text } = await renderTab(t);
    expect(el.querySelector('[data-unknown]')).toBeTruthy();
    expect(text('.rt__h app-provenance-tag')).toBe('Unknown');
    expect(text('app-miss-chain .mc__t')).toBe('No try found before your deadline');
  });

  it('parseDeadline', () => {
    expect(parseDeadline('2026-10-13T22:00')).toEqual({ dateKey: '2026-10-13', hhmm: '22:00' });
    expect(parseDeadline('2026-10-13T22:00:00')).toEqual({ dateKey: '2026-10-13', hhmm: '22:00' });
    expect(parseDeadline('')).toBeNull();
    expect(parseDeadline('2026-13-40T22:00')).toBeNull();
    expect(parseDeadline('2026-10-13T25:00')).toBeNull();
  });
});

@Component({
  standalone: true,
  imports: [MissChainComponent],
  template: `<app-miss-chain [steps]="steps()" actionLabel="Use instead" arrive="Madrid" (pick)="picked = $event" />`,
})
class ChainHost {
  readonly steps = signal<MissStep[]>([]);
  picked: unknown = null;
}

describe('MissChainComponent', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('renders any MissStep[] and emits the picked itinerary', async () => {
    configure(sevilleTrip());
    const fixture = TestBed.createComponent(ChainHost);
    const [ac834] = directItineraries('YUL', 'MAD', '2026-10-08');
    const [ac822] = directItineraries('YUL', 'BCN', '2026-10-08');
    fixture.componentInstance.steps.set([
      { label: 'Try 1', itinerary: ac834, kind: 'try', slackMin: 120 },
      { label: 'If you miss it', itinerary: ac822, kind: 'fallback', slackMin: 30 },
      { label: 'If you miss both', itinerary: null, kind: 'late', slackMin: null },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('[data-step]')].map(n => n.getAttribute('data-step'))).toEqual(['try', 'fallback', 'late']);
    expect(clean(el.querySelector('.mc__m')?.textContent)).toBe('Madrid with 2h to spare');
    const acts = el.querySelectorAll<HTMLButtonElement>('.mc__act');
    expect(acts).toHaveLength(2);
    acts[1].click();
    expect(fixture.componentInstance.picked).toBe(ac822);

    fixture.componentInstance.steps.set([]);
    await fixture.whenStable();
    expect(el.querySelectorAll('[data-step]')).toHaveLength(0);
  });
});

describe('DestHomeByComponent', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  async function renderDest(code: string) {
    configure(sevilleTrip());
    const fixture = TestBed.createComponent(DestHomeByComponent);
    fixture.componentRef.setInput('code', code);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('on /to/LIS shows the Seville trip tries and links to the Return tab', async () => {
    const el = await renderDest('LIS');
    const a = el.querySelector<HTMLAnchorElement>('[data-home-by]')!;
    expect([...a.querySelectorAll('.hb__b > span')].map(n => clean(n.textContent))).toEqual([
      'Seville trip', 'Home by Tue Oct 13, 22:00', '2 tries from LIS if you fly Tue · 4 if you start Mon',
    ]);
    expect(a.getAttribute('href')).toContain(`/trips/${SEVILLE_IDS.trip}?`);
    expect(a.getAttribute('href')).toContain('tab=return');
  });

  it('on /to/MAD counts the Madrid tries', async () => {
    const el = await renderDest('MAD');
    expect(clean(el.querySelector('.hb__m')?.textContent)).toMatch(/^\d+ tr(y|ies) from MAD if you fly Tue · \d+ if you start Mon$/);
  });

  it('renders nothing for an airport no active trip flies home from', async () => {
    const el = await renderDest('LHR');
    expect(el.querySelector('[data-home-by]')).toBeNull();
  });
});
