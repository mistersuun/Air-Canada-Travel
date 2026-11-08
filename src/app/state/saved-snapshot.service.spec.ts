import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../data/testing/schedule-fixtures';
import { snapshotFor } from '../pages/saved/saved-changes';
import { NOW } from './app-state.service';
import { PREFS_STORAGE } from './prefs.service';
import { SAVED_SNAPSHOT_KEY, SAVED_SNAPSHOT_STORAGE, SavedSnapshotService } from './saved-snapshot.service';
import { MemoryStorage } from './testing';

const CLOCK = Date.parse('2026-10-01T16:00:00Z');

describe('SavedSnapshotService', () => {
  let snaps: MemoryStorage;
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    snaps = new MemoryStorage();
    const prefs = new MemoryStorage();
    prefs.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', favourites: ['ATH'] }));
    TestBed.configureTestingModule({
      providers: [
        { provide: PREFS_STORAGE, useValue: prefs }, { provide: SAVED_SNAPSHOT_STORAGE, useValue: snaps },
        { provide: NOW, useValue: () => CLOCK },
      ],
    });
  });
  afterEach(() => resetScheduleSource());

  it('baselines a starred destination (so only later changes count) and stores it per destination', () => {
    const s = TestBed.inject(SavedSnapshotService);
    TestBed.tick();
    expect(Object.keys(s.seen())).toEqual(['ATH']);
    expect(Object.keys(JSON.parse(snaps.getItem(SAVED_SNAPSHOT_KEY)!))).toEqual(['ATH']);
    expect(s.unseenCount()).toBe(0);
  });

  it('counts a destination whose schedule changed since it was stored', () => {
    snaps.setItem(SAVED_SNAPSHOT_KEY, JSON.stringify({ ATH: snapshotFor('ATH', '2026-10-01', ['YUL']) }));
    const s = TestBed.inject(SavedSnapshotService);
    expect(s.unseenCount()).toBe(0);
    setScheduleSource(FIXTURE_ROUTES.filter(r => r.destinationCode !== 'ATH'), FIXTURE_META);
    // a fresh service sees the new schedules
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PREFS_STORAGE, useValue: (() => { const m = new MemoryStorage(); m.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', favourites: ['ATH'] })); return m; })() },
        { provide: SAVED_SNAPSHOT_STORAGE, useValue: snaps }, { provide: NOW, useValue: () => CLOCK },
      ],
    });
    expect(TestBed.inject(SavedSnapshotService).unseenCount()).toBe(1);
  });

  it('ignores corrupt or blocked storage', () => {
    snaps.setItem(SAVED_SNAPSHOT_KEY, '{nope');
    expect(TestBed.inject(SavedSnapshotService).seen()).toEqual({});
  });
});
