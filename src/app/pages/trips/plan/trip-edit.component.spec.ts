import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component, computed, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import { AppStateService, NOW } from '../../../state/app-state.service';
import { PREFS_STORAGE } from '../../../state/prefs.service';
import { MemoryStorage } from '../../../state/testing';
import { TRIPS_KEY } from '../../../trips/model';
import { TRIPS_STORAGE } from '../../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE } from '../../../trips/testing/seville-fixture';
import { TripsService } from '../../../trips/trips.service';
import { toUtcMs } from '../../../utils/time';
import { TripEditComponent } from './trip-edit.component';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');

@Component({
  selector: 'app-host',
  standalone: true,
  imports: [TripEditComponent],
  template: `@if (trip(); as t) { <app-trip-edit [trip]="t" (deleted)="deleted = true" /> }`,
})
class HostComponent {
  private readonly trips = inject(TripsService);
  deleted = false;
  readonly trip = computed(() => this.trips.trip(SEVILLE_IDS.trip));
}

async function render() {
  const store = new MemoryStorage();
  store.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const type = async (sel: string, value: string, event = 'input') => {
    const i = q<HTMLInputElement | HTMLSelectElement>(sel);
    i.value = value;
    i.dispatchEvent(new Event(event, { bubbles: true }));
    await fixture.whenStable();
  };
  const click = async (sel: string) => {
    q(sel).click();
    await fixture.whenStable();
  };
  return {
    fixture, el, q, type, click,
    trips: TestBed.inject(TripsService), state: TestBed.inject(AppStateService),
    host: fixture.componentInstance,
  };
}

describe('TripEditComponent', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('renames the trip', async () => {
    const { type, click, trips } = await render();
    await type('[data-name]', 'Spain in October');
    await click('[data-name-save]');
    expect(trips.trip(SEVILLE_IDS.trip)!.name).toBe('Spain in October');
  });

  it('lists every leg and removes one with Undo', async () => {
    const { el, click, trips, state, fixture } = await render();
    expect(el.querySelectorAll('[data-leg-edit]')).toHaveLength(4);
    await click(`[data-leg-edit="${SEVILLE_IDS.train}"] [data-leg-remove]`);
    expect(el.querySelectorAll('[data-leg-edit]')).toHaveLength(3);
    expect(state.notice()?.message).toBe('Leg removed');
    state.notice()!.action!();
    await fixture.whenStable();
    expect(trips.trip(SEVILLE_IDS.trip)!.legs).toHaveLength(4);
    expect(el.querySelectorAll('[data-leg-edit]')).toHaveLength(4);
  });

  it('refuses one time without the other, then adds a ground leg saved by you', async () => {
    const { q, type, click, trips } = await render();
    const goalId = trips.trip(SEVILLE_IDS.trip)!.goal.id;
    await click('[data-leg-open]');
    await click('[data-kind-ground]');
    await type('[data-from]', `place:${goalId}`, 'change');
    await type('[data-to]', 'code:MAD', 'change');
    await type('[data-leg-date]', '2026-10-11');
    await type('[data-dep-time]', '08:30');
    await click('[data-ground-add]');
    expect(q('.te__err').textContent).toContain('both times');
    await type('[data-arr-time]', '12:45');
    await click('[data-ground-add]');
    const leg = trips.trip(SEVILLE_IDS.trip)!.legs.find(l => l.kind === 'ground' && l.to.code === 'MAD' && l.from.name === 'Seville');
    expect(leg).toMatchObject({ kind: 'ground', provenance: 'saved', dateKey: '2026-10-11' });
    expect(leg!.kind === 'ground' && leg!.userTimes).toEqual({ depDateKey: '2026-10-11', depLocal: '08:30', arrDateKey: '2026-10-11', arrLocal: '12:45' });
  });

  it('adds a flight picked from the schedule', async () => {
    const { el, q, type, click, trips } = await render();
    await click('[data-leg-open]');
    await type('[data-from]', 'code:YUL', 'change');
    await type('[data-to]', 'code:MAD', 'change');
    await type('[data-leg-date]', '2026-10-09');
    expect(el.querySelectorAll('[data-flight-add]').length).toBeGreaterThan(0);
    expect(q('[data-flights]').textContent).toContain('AC834');
    await click('[data-flight-add]');
    const flights = trips.trip(SEVILLE_IDS.trip)!.legs.filter(l => l.kind === 'flight');
    expect(flights).toHaveLength(3);
    expect(el.querySelector('[data-leg-form]')).toBeNull();
  });

  it('says so when no flight is found', async () => {
    const { q, type, click } = await render();
    await click('[data-leg-open]');
    await type('[data-from]', 'code:YUL', 'change');
    await type('[data-to]', 'code:MAD', 'change');
    await type('[data-leg-date]', '2031-01-01');   // outside the schedule
    expect(q('[data-flights-none]').textContent).toContain('No flight found');
  });

  it('adds a stop through the place search and offers the way there', async () => {
    const { el, q, type, click, trips } = await render();
    await click('[data-stop-open]');
    await type('[data-place-search]', 'lis');
    await click('[data-place="ac-LIS"]');
    await type('[data-stop-date]', '2026-10-12');
    await click('[data-stop-add]');
    const t = trips.trip(SEVILLE_IDS.trip)!;
    expect(t.stops).toHaveLength(1);
    expect(t.stops![0]).toMatchObject({ arriveDate: '2026-10-12' });
    expect(t.stops![0].place.name).toBe('Lisbon');
    expect(t.goal.name).toBe('Seville');
    // The ground-leg form opens prefilled Seville -> Lisbon on the arrival day.
    expect(q<HTMLSelectElement>('[data-from]').value).toBe(`place:${t.goal.id}`);
    expect(q<HTMLSelectElement>('[data-to]').value).toBe(`place:${t.stops![0].place.id}`);
    expect(q<HTMLInputElement>('[data-leg-date]').value).toBe('2026-10-12');
    expect(el.querySelectorAll('[data-stop]')).toHaveLength(2);
    await click('[data-stop-remove]');
    expect(trips.trip(SEVILLE_IDS.trip)!.stops).toBeUndefined();
  });

  it('changes the outbound date and re-plans the outbound flight', async () => {
    const { type, click, trips } = await render();
    await type('[data-outbound]', '2026-10-09');
    await click('[data-outbound-save]');
    const t = trips.trip(SEVILLE_IDS.trip)!;
    expect(t.outboundDate).toBe('2026-10-09');
    const out = t.legs.find(l => l.kind === 'flight' && l.role === 'outbound' && l.status === 'planned');
    expect(out && out.kind === 'flight' && out.refs[0].dateKey).toBe('2026-10-09');
  });

  it('deletes the trip and tells the page', async () => {
    const { click, trips, host, state } = await render();
    await click('[data-edit-delete]');
    expect(host.deleted).toBe(true);
    expect(trips.trip(SEVILLE_IDS.trip)).toBeNull();
    expect(state.notice()?.actionLabel).toBe('Undo');
  });
});
