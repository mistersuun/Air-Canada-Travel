import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { toUtcMs } from '../../utils/time';
import { FLIGHTLOG_KEY, Outcome, PendingChange, TRIPS_KEY } from '../model';
import { TRIPS_STORAGE } from '../storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../testing/seville-fixture';
import { TripsService } from '../trips.service';
import { OutcomePromptComponent, outcomeChoices } from './outcome-prompt.component';
import { SettingsHistoryComponent, historyRoutes } from './settings-history.component';
import { changeCard } from './trip-changes.component';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function outcome(p: Partial<Outcome>): Outcome {
  return {
    id: Math.random().toString(36).slice(2), flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-08-01',
    kind: 'allBoarded', partySize: 2, tripId: null, note: '', recordedAt: '2026-08-02T12:00:00.000Z', ...p,
  };
}

function change(p: Partial<PendingChange>): PendingChange {
  const old = sevilleTrip().legs.find(l => l.id === SEVILLE_IDS.ret)!;
  const ref = old.kind === 'flight' ? old.refs[0] : null!;
  return {
    id: 'c1', legId: SEVILLE_IDS.ret, refIndex: 0, kind: 'retimed', old: ref, next: null,
    generatedAt: null, detectedAt: '2026-10-01T00:00:00Z', state: 'open', ...p,
  };
}

describe('changeCard', () => {
  afterEach(() => resetScheduleSource());

  it('words retimes, late landings, not found and unpublished days without "cancelled"', () => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    const trip = sevilleTrip();
    const base = change({}).old;
    const early = changeCard(trip, change({ next: { ...base, depLocal: '11:10', arrLocal: '13:35' } }), 60)!;
    expect(early.title).toBe('AC813 retimed in the new schedules');
    expect(early.body).toBe('Tue Oct 13: 11:25 → 11:10, lands 13:50 → 13:35. Still home by your deadline.');
    expect(early.warn).toBe(false);
    expect(early.backups).toBe('return');

    const late = changeCard(trip, change({ next: { ...base, depLocal: '20:00', arrLocal: '22:25' } }), 60)!;
    expect(late.body).toContain('Now lands after your deadline.');
    expect(late.warn).toBe(true);

    const gone = changeCard(trip, change({ kind: 'notFound' }), 60)!;
    expect(gone.title).toBe('AC813 not found in the latest schedules · Tue Oct 13');
    const out = changeCard(trip, change({ kind: 'outsideCoverage' }), 60)!;
    expect(out.title).toBe("Schedules for Tue Oct 13 aren't published yet");
    for (const c of [early, late, gone, out]) expect(`${c.title} ${c.body}`).not.toMatch(/cancel/i);
  });
});

describe('outcome prompt and history', () => {
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('offers "Some of us" only to a group', () => {
    expect(outcomeChoices(2).map(c => c.label)).toEqual(['Everyone boarded', 'Some of us', "Didn't board", "Didn't try"]);
    expect(outcomeChoices(1).map(c => c.label)).toEqual(['I boarded', "Didn't board", "Didn't try"]);
  });

  it('counts boardings per route, leaving Didn\'t try out of the total', () => {
    const r = historyRoutes([
      outcome({ kind: 'allBoarded' }), outcome({ kind: 'allBoarded', dateKey: '2026-07-01' }),
      outcome({ kind: 'someBoarded', dateKey: '2026-06-01' }), outcome({ kind: 'noneBoarded', dateKey: '2026-05-01' }),
      outcome({ kind: 'didntTry', dateKey: '2026-04-01' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ route: 'YUL → LHR', summary: 'Boarded 3 of 4 recorded', some: 'Some of us 1', skipped: "Didn't try 1" });
    expect(r[0].records).toHaveLength(5);
    expect(JSON.stringify(r)).not.toContain('%');
  });

  it('records an outcome from the card, then Settings shows "Boarded 1 of 1 recorded"; Undo restores the leg', async () => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    const storage = new MemoryStorage();
    storage.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => toUtcMs('2026-10-08', '19:00', 'America/Toronto') },
        { provide: TRIPS_STORAGE, useValue: storage },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    const svc = TestBed.inject(TripsService);
    const state = TestBed.inject(AppStateService);
    const flash = vi.spyOn(state, 'flash');
    expect(svc.pendingOutcomes().map(p => p.key)).toEqual(['AC834|YUL|2026-10-08']);

    const card = TestBed.createComponent(OutcomePromptComponent);
    card.componentRef.setInput('prompt', svc.pendingOutcomes()[0]);
    await card.whenStable();
    (card.nativeElement.querySelector('[data-kind="someBoarded"]') as HTMLButtonElement).click();
    expect(svc.pendingOutcomes()).toEqual([]);
    expect(svc.trip(SEVILLE_IDS.trip)!.legs[0].status).toBe('boarded');
    expect(JSON.parse(storage.getItem(FLIGHTLOG_KEY)!).outcomes).toHaveLength(1);

    const hist = TestBed.createComponent(SettingsHistoryComponent);
    await hist.whenStable();
    const el = hist.nativeElement as HTMLElement;
    expect(clean(el.querySelector('[data-summary]')?.textContent)).toBe('Boarded 1 of 1 recorded · Some of us 1');
    expect(clean(el.textContent)).toContain('Kept on this device. Export from Trips.');

    const undo = flash.mock.calls[0][1]!;
    undo.run();
    expect(svc.outcomes()).toEqual([]);
    expect(svc.trip(SEVILLE_IDS.trip)!.legs[0].status).toBe('listed');
  });

  it('"Skip this flight" dismisses the prompt; Delete removes a history record', async () => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    const storage = new MemoryStorage();
    storage.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
    storage.setItem(FLIGHTLOG_KEY, JSON.stringify({ schema: 1, notes: [], dismissed: [], outcomes: [outcome({ id: 'o1' })] }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => toUtcMs('2026-10-08', '19:00', 'America/Toronto') },
        { provide: TRIPS_STORAGE, useValue: storage },
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    const svc = TestBed.inject(TripsService);
    const card = TestBed.createComponent(OutcomePromptComponent);
    card.componentRef.setInput('prompt', svc.pendingOutcomes()[0]);
    await card.whenStable();
    (card.nativeElement.querySelector('[data-skip]') as HTMLButtonElement).click();
    expect(svc.pendingOutcomes()).toEqual([]);
    expect(svc.dismissed()).toEqual(['AC834|YUL|2026-10-08']);

    const hist = TestBed.createComponent(SettingsHistoryComponent);
    await hist.whenStable();
    (hist.nativeElement.querySelector('.rec__rm') as HTMLButtonElement).click();
    hist.detectChanges();
    await hist.whenStable();
    expect(svc.outcomes()).toEqual([]);
    expect(hist.nativeElement.querySelector('[data-empty]')).toBeTruthy();
  });
});
