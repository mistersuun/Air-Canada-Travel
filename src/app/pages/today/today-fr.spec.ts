import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { STATUS_FETCH } from '../../live/flight-status.service';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FORECAST_FETCH, FORECAST_STORAGE } from '../../recs/forecast.service';
import { GROUND_FETCH } from '../../places/ground-timetable.service';
import { AIRPORT_INFO_FETCH } from '../../places/airport-info';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../trips/testing/seville-fixture';
import { setLocale } from '../../i18n/locale';
import { toUtcMs } from '../../utils/time';
import { RecoverPage } from './recover.page';
import { TodayBannerComponent } from './today-banner.component';
import { TodayPage } from './today.page';
import { bannerText, leavesLabel, legStatusLabel, noteText, recoverView, todayView, upcomingTripView } from './today-model';
import { travelTimeline } from './timeline-model';

const AT_1640 = toUtcMs('2026-10-08', '16:40', 'America/Toronto');
const AT_1805 = toUtcMs('2026-10-08', '18:05', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function configure(nowMs: number) {
  const store = new MemoryStorage();
  store.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => nowMs },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: STATUS_FETCH, useValue: async () => ({ status: 503, body: { error: 'not-configured' } }) },
      { provide: GROUND_FETCH, useValue: vi.fn(async () => null) },
      { provide: AIRPORT_INFO_FETCH, useValue: async () => null },
      { provide: FORECAST_STORAGE, useValue: new MemoryStorage() },
      { provide: FORECAST_FETCH, useValue: vi.fn(async () => ({})) },
    ],
  });
}

async function render<T>(cmp: new (...a: never[]) => T, nowMs: number, inputs: Record<string, string> = {}) {
  configure(nowMs);
  const fixture = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Today in French', () => {
  beforeEach(() => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    setLocale('fr');
  });
  afterEach(() => {
    setLocale('en');
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('model text: departures, notes, statuses, banner', () => {
    expect(leavesLabel(AT_1640 + 75 * 60_000, AT_1640)).toMatch(/^part dans /);
    expect(leavesLabel(AT_1640, AT_1640)).toBe('part maintenant');
    expect(leavesLabel(AT_1640 - 25 * 60_000, AT_1640)).toMatch(/^parti il y a /);
    expect(noteText({ id: 'n', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', open: 14, listed: 9, text: '', at: '' })).toBe('14 disponibles, 9 inscrits');
    expect(legStatusLabel('notBoarded')).toBe('Non embarqué');
    const banner = bannerText([sevilleTrip()], AT_1640, '24h');
    expect(banner?.title).toBe('Aujourd\'hui · Montréal → Madrid');
    expect(banner?.detail).toContain('heure de YUL');
    expect(banner?.detail).toContain('Inscrit');
  });

  it('upcoming trip and the day view use French words', () => {
    const up = upcomingTripView([sevilleTrip()], AT_1640 - 3 * 86_400_000);
    expect(up?.title).toBe('Prochain voyage dans 3 jours');
    const v = todayView({ trip: sevilleTrip(), legId: SEVILLE_IDS.outbound, nowMs: AT_1640, notes: [], outcomes: [], connect: { minConnect: 60 }, fmt: '24h' });
    expect(v?.eyebrow).toContain('à YUL');
    expect(v?.zone).toBe('heure de YUL');
  });

  it('timeline rows and the recovery view', () => {
    const trip = sevilleTrip();
    const rows = travelTimeline({ trip, leg: trip.legs.find(l => l.id === SEVILLE_IDS.outbound), fmt: '24h' });
    expect(rows[0].title).toMatch(/^AC834 part de /);
    expect(rows[1].title).toMatch(/^Arrivée à /);
    const r = recoverView({ trip, at: 'YUL', legId: SEVILLE_IDS.outbound, nowMs: AT_1805, connect: { minConnect: 60 }, fmt: '24h' });
    expect(r.subtitle).toBe('Au départ de YUL · il est 18:05');
  });

  it('the Today page renders in French', async () => {
    const el = await render(TodayPage, AT_1640);
    const text = clean(el.textContent);
    expect(text).toContain('J\'ai embarqué');
    expect(text).toContain('Je n\'ai pas embarqué');
    expect(text).toContain('Changement de plans');
    expect(text).toContain('Votre journée');
    expect(text).not.toContain('Left to do');
    expect(el.querySelector('[data-boarded]')).not.toBeNull();
  });

  it('the banner and the recovery page render in French', async () => {
    const banner = await render(TodayBannerComponent, AT_1640);
    expect(clean(banner.querySelector('[data-today-banner]')?.textContent)).toContain('Aujourd\'hui · Montréal → Madrid');
    TestBed.resetTestingModule();
    const rec = await render(RecoverPage, AT_1805, { id: SEVILLE_IDS.trip, at: 'YUL', leg: SEVILLE_IDS.outbound });
    const text = clean(rec.textContent);
    expect(text).toContain('Encore accessible');
    expect(text).toContain('Ce soir');
    expect(text).toContain('Demain');
    expect(text).not.toContain('Tonight');
  });
});
