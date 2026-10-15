import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import { NOW } from '../../../state/app-state.service';
import { PREFS_STORAGE } from '../../../state/prefs.service';
import { MemoryStorage } from '../../../state/testing';
import { TRIPS_KEY } from '../../../trips/model';
import { TRIPS_STORAGE } from '../../../trips/storage';
import { SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../../trips/testing/seville-fixture';
import { toUtcMs } from '../../../utils/time';
import { PlanTabComponent } from './plan-tab.component';

async function render(schema: number) {
  const store = new MemoryStorage();
  store.setItem(TRIPS_KEY, JSON.stringify({ ...SEVILLE_TRIPS_FILE, schema }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => toUtcMs('2026-10-01', '09:41', 'America/Toronto') },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
    ],
  });
  const fixture = TestBed.createComponent(PlanTabComponent);
  fixture.componentRef.setInput('trip', sevilleTrip());
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Plan tab Edit toggle', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('is there on a normal file and gone when the trips are read-only (saved by a newer app)', async () => {
    expect((await render(1)).querySelector('[data-edit-toggle]')).not.toBeNull();
    TestBed.resetTestingModule();
    expect((await render(3)).querySelector('[data-edit-toggle]')).toBeNull();
  });
});
