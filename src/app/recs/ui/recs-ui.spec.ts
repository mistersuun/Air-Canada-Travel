import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY } from 'rxjs';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { FLIGHTLOG_KEY, Outcome, TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_TRIPS_FILE } from '../../trips/testing/seville-fixture';
import { CLIMATE_FETCH } from '../climate.service';
import { PROFILE_KEY, Recommendation, TravelProfile } from '../model';
import { PROFILE_STORAGE, ProfileService } from '../profile.service';
import { RecsService, tripCodes } from '../recs.service';
import { CLIMATE_FIXTURE } from '../testing/climate-fixture';
import { RECS_META, RECS_NOW, RECS_PROFILE, RECS_ROUTES } from '../testing/recs-fixture';
import { ForYouComponent, FOR_YOU_LINE } from './for-you.component';
import { cardsFor, splitGroupTitle, tagged, whyTexts } from './rec-card.component';
import { SettingsProfileBodyComponent as SettingsProfileComponent } from './settings-profile-body.component';
import { TripIdeasComponent } from './trip-ideas.component';

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function outcome(i: number, kind: Outcome['kind'], dest = 'LIS'): Outcome {
  return {
    id: `o${i}`, flightNumber: 'AC812', origin: 'YUL', dest, dateKey: `2026-09-0${i + 1}`, kind,
    partySize: 1, tripId: null, note: '', recordedAt: `2026-09-0${i + 1}T12:00:00.000Z`,
  };
}

interface Setup {
  profile?: TravelProfile | null;
  favourites?: string[];
  outcomes?: Outcome[];
  withTrip?: boolean;
}

function configure(o: Setup = {}) {
  const prefs = new MemoryStorage();
  prefs.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', favourites: o.favourites ?? ['OPO'] }));
  const profile = new MemoryStorage();
  if (o.profile !== null) profile.setItem(PROFILE_KEY, JSON.stringify(o.profile ?? RECS_PROFILE));
  const trips = new MemoryStorage();
  if (o.withTrip) trips.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  if (o.outcomes) trips.setItem(FLIGHTLOG_KEY, JSON.stringify({ schema: 1, notes: [], outcomes: o.outcomes, dismissed: [] }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => RECS_NOW },
      { provide: PREFS_STORAGE, useValue: prefs },
      { provide: PROFILE_STORAGE, useValue: profile },
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE },
      { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: EMPTY, unrecoverable: EMPTY } },
    ],
  });
}

async function render<T>(cmp: new (...a: never[]) => T) {
  const fixture = TestBed.createComponent(cmp);
  await fixture.whenStable();
  await TestBed.inject(RecsService).ensureClimate();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const text = (sel: string, root: ParentNode = el) => squash(root.querySelector(sel)?.textContent);
  const all = (sel: string, root: ParentNode = el) => [...root.querySelectorAll(sel)].map(e => squash(e.textContent));
  return { fixture, el, text, all };
}

describe('rec card helpers', () => {
  it('splits the long-weekend title and tags the last line of each label run', () => {
    expect(splitGroupTitle('Thanksgiving long weekend in 8 days')).toEqual({ name: 'Thanksgiving long weekend', when: 'in 8 days' });
    expect(splitGroupTitle('Victoria Day long weekend tomorrow')).toEqual({ name: 'Victoria Day long weekend', when: 'tomorrow' });
    expect(splitGroupTitle('Season ends soon')).toEqual({ name: 'Season ends soon', when: null });
    const lines = [{ text: 'a', label: 'scheduled' as const }, { text: 'b', label: 'scheduled' as const }, { text: 'c', label: null }];
    expect(lines.map((_, i) => tagged(lines, i))).toEqual([false, true, false]);
  });

  it('dedupes Why this texts and makes one card per long weekend', () => {
    const r = (id: string, code: string): Recommendation => ({
      id, kind: 'holiday', code, placeId: null, title: code, out: null, back: null, lines: [], weather: null,
      reason: [{ kind: 'holiday', text: 'Holiday Monday' }], link: { path: ['/to', code], query: {} }, rank: 1,
    });
    expect(whyTexts([r('a', 'LGA'), r('b', 'FLL')])).toEqual(['Holiday Monday.']);
    expect(cardsFor({ id: 'lw:2026-10-12', title: 't', aside: null, items: [r('a', 'LGA'), r('b', 'FLL')] })).toHaveLength(1);
    const season = cardsFor({ id: 'season', title: 'Season ends soon', aside: null, items: [r('a', 'OPO')] });
    expect(season[0].hero).toBe('OPO');
    expect(season[0].heroTag).toBe('Season ends soon');
  });
});

describe('ForYouComponent', () => {
  beforeEach(() => setScheduleSource(RECS_ROUTES, RECS_META));
  afterEach(() => {
    TestBed.resetTestingModule();
    resetScheduleSource();
  });

  it('shows the Thanksgiving card, typical weather and the season ending for a starred OPO (mock x13)', async () => {
    configure();
    const { el, text, all } = await render(ForYouComponent);
    expect(text('#h-foryou')).toBe('For you');
    expect(text('[data-edit-profile]')).toBe('Edit profile');
    expect(el.querySelector('[data-edit-profile]')!.getAttribute('href')).toMatch(/^\/profile/);
    expect(text('.line')).toBe(FOR_YOU_LINE);

    const lw = el.querySelector('[data-group^="lw:"]')!;
    expect(text('[data-holiday]', lw)).toBe('Thanksgiving long weekend');
    expect(text('.when', lw)).toBe('in 8 days');
    expect(text('.fy__dates', lw)).toBe('Fri Oct 9 → Mon Oct 12');
    const rows = lw.querySelectorAll('app-rec-row');
    expect(rows.length).toBe(2);
    expect(all('[data-why]', lw)).toEqual(['Why this Holiday Monday. You travel Thu to Mon, like City and Sun, flights under 7h.']);

    const fll = lw.querySelector('[data-rec^="holiday:FLL"]')!;
    expect(all('[data-line]', fll)).toEqual(['Out Fri 08:10, 18:05', 'Back Mon 12:40, 20:55 Scheduled']);
    expect(text('[data-weather]', fll)).toBe('Oct 30° / 23° Typical');
    expect(fll.querySelector('[data-weather] .ui-tag')!.getAttribute('aria-label')).toBe('Typical, not a forecast');
    expect(fll.querySelector('a')!.getAttribute('href')).toMatch(/^\/flight\/FLL\/2026-10-09/);

    const opo = el.querySelector('[data-rec="seasonEnding:OPO:"]')!;
    expect(opo).not.toBeNull();
    const card = opo.closest('article')!;
    expect(text('.fy__tag', card)).toBe('Season ends soon');
    expect(all('[data-line]', card)[0]).toBe('Last flight there AC928 Fri Oct 23 · last home AC929 Sat Oct 24');
    expect(all('[data-line]', card)[1]).toBe('Back from Jun 1, 2027 Scheduled');
    expect(text('[data-why]', card)).toBe('Why this You starred Porto.');

    expect(el.querySelector('[data-weather-credit]')).not.toBeNull();
    expect(el.querySelector('[data-tell]')).toBeNull();
    expect(el.textContent).not.toMatch(/%|odds|chance of|likely/i);
  });

  it('"Not for me" hides a card and Undo brings it back', async () => {
    configure();
    const { fixture, el } = await render(ForYouComponent);
    const id = el.querySelector('[data-rec^="holiday:FLL"]')!.getAttribute('data-rec')!;
    el.querySelector<HTMLButtonElement>(`[data-rec="${id}"] [data-dismiss]`)!.click();
    await fixture.whenStable();
    expect(el.querySelector(`[data-rec="${id}"]`)).toBeNull();
    expect(TestBed.inject(ProfileService).profile().dismissed).toContain(id);
    const notice = TestBed.inject(AppStateService).notice()!;
    expect(notice.message).toBe('Hidden Fort Lauderdale');
    notice.action!();
    await fixture.whenStable();
    expect(el.querySelector(`[data-rec="${id}"]`)).not.toBeNull();
  });

  it('an empty profile keeps only holidays and starred places, plus "Tell us what you like"', async () => {
    configure({ profile: null });
    const { el, text } = await render(ForYouComponent);
    const kinds = [...el.querySelectorAll('app-rec-row')].map(r => r.getAttribute('data-kind'));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every(k => k === 'holiday' || k === 'seasonEnding')).toBe(true);
    expect(text('[data-tell]')).toBe('Tell us what you like Travel profile');
    expect(el.querySelector('[data-more]')).toBeNull();
  });

  it('renders nothing when there is nothing to suggest', async () => {
    configure({ profile: null, favourites: [] });
    resetScheduleSource();
    setScheduleSource([], { ...RECS_META });
    const { el } = await render(ForYouComponent);
    expect(el.querySelector('[data-for-you]')).toBeNull();
  });
});

describe('TripIdeasComponent', () => {
  beforeEach(() => setScheduleSource(RECS_ROUTES, RECS_META));
  afterEach(() => {
    TestBed.resetTestingModule();
    resetScheduleSource();
  });

  it('shows "Ideas" with your log as counts when there is no active trip', async () => {
    configure({ outcomes: [outcome(0, 'allBoarded'), outcome(1, 'allBoarded'), outcome(2, 'allBoarded')] });
    const { el, text, all } = await render(TripIdeasComponent);
    expect(text('#h-ideas')).toBe('Ideas');
    expect(text('[data-profile-link]')).toBe('Profile');
    const cards = el.querySelectorAll('app-rec-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(3);
    const lis = el.querySelector('[data-rec="yourLog:LIS:"]')!;
    expect(all('[data-line]', lis)).toContain('You boarded 3 of 3 tries Saved by you');
    expect(text('[data-why]', lis.closest('article')!)).toMatch(/^Why this Your own outcome log/);
    expect(el.textContent).not.toContain('%');
  });

  it('says "Ideas for later" under an active trip and never suggests its places', async () => {
    configure({ withTrip: true, outcomes: [outcome(0, 'allBoarded'), outcome(1, 'allBoarded'), outcome(2, 'allBoarded')] });
    const { el, text } = await render(TripIdeasComponent);
    expect(text('#h-ideas')).toBe('Ideas for later');
    const codes = new Set(tripCodes(SEVILLE_TRIPS_FILE.trips));
    const shown = [...el.querySelectorAll('app-rec-row')].map(r => r.getAttribute('data-rec')!.split(':')[1]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter(c => codes.has(c))).toEqual([]);
  });
});

describe('SettingsProfileComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the summary and opens /profile after closing Settings', async () => {
    configure();
    const { el, text, fixture } = await render(SettingsProfileComponent);
    expect(text('[data-summary]')).toBe(TestBed.inject(ProfileService).summary());
    expect(text('[data-summary]')).not.toBe('Not set up');
    const state = TestBed.inject(AppStateService);
    state.openSettings();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('[data-profile-row]')!.click();
    await fixture.whenStable();
    expect(state.settingsOpen()).toBe(false);
    expect(nav).toHaveBeenCalledWith(['/profile'], expect.anything());
  });

  it('says "Not set up" for an empty profile', async () => {
    configure({ profile: null });
    const { text } = await render(SettingsProfileComponent);
    expect(text('[data-summary]')).toBe('Not set up');
  });
});
