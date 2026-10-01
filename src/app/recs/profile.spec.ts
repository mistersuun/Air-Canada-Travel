import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BlockedStorage, MemoryStorage } from '../state/testing';
import { PROFILE_KEY } from './model';
import { EMPTY_PROFILE, daysRange, profileSummary, sanitizeProfile } from './profile';
import { PROFILE_STORAGE, ProfileService } from './profile.service';
import { RECS_PROFILE } from './testing/recs-fixture';

function setup(storage: Storage | null): ProfileService {
  TestBed.configureTestingModule({ providers: [{ provide: PROFILE_STORAGE, useValue: storage }] });
  const s = TestBed.inject(ProfileService);
  s.now = () => Date.parse('2026-10-01T13:41:00Z');
  return s;
}

describe('sanitizeProfile', () => {
  it('gives the empty profile for garbage and never throws', () => {
    for (const raw of [null, undefined, 'x', 42, [1], { styles: 'Sun' }]) {
      expect(sanitizeProfile(raw)).toEqual(EMPTY_PROFILE);
    }
  });

  it('clamps party and max flight, sorts and de-duplicates days, drops unknown styles', () => {
    const p = sanitizeProfile({
      styles: ['Sun', 'Hub', 'Beach', 'City', 'Sun'], length: 'month', maxFlightHours: 40, party: 0,
      days: [7, 1, 1, 9, 0, 4.5, 4], onwardBudget: 'lots', updatedAt: 'not a date',
    });
    expect(p.styles).toEqual(['Sun', 'City']);
    expect(p.length).toBeNull();
    expect(p.maxFlightHours).toBe(12);
    expect(p.party).toBe(1);
    expect(p.days).toEqual([1, 4, 7]);
    expect(p.onwardBudget).toBe('any');
    expect(p.updatedAt).toBeNull();
    expect(sanitizeProfile({ maxFlightHours: 0, party: 30 })).toMatchObject({ maxFlightHours: 1, party: 9 });
    expect(sanitizeProfile({ maxFlightHours: null }).maxFlightHours).toBeNull();
  });

  it('caps dismissed at 200, newest kept', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `style:X${i}:`);
    const p = sanitizeProfile({ dismissed: ids });
    expect(p.dismissed).toHaveLength(200);
    expect(p.dismissed[199]).toBe('style:X249:');
  });

  it('round-trips a valid profile unchanged', () => {
    expect(sanitizeProfile(JSON.parse(JSON.stringify(RECS_PROFILE)))).toEqual({ ...RECS_PROFILE, days: [1, 4, 5, 6, 7] });
  });
});

describe('profile summary', () => {
  it('reads like the Settings row', () => {
    expect(profileSummary(EMPTY_PROFILE)).toBe('Not set up');
    expect(profileSummary(RECS_PROFILE)).toBe('City, Sun · long weekends · up to 7h · Thu–Mon');
    expect(profileSummary({ ...EMPTY_PROFILE, updatedAt: '2026-10-01T00:00:00Z' })).toBe('Any trip');
    expect(profileSummary({ ...RECS_PROFILE, styles: ['Adventure'], length: 'day', maxFlightHours: null, days: [1, 3, 5] }))
      .toBe('Adventure · day trips · Mon, Wed, Fri');
  });

  it('turns consecutive days (wrapping the week) into a range', () => {
    expect(daysRange([1, 4, 5, 6, 7])).toBe('Thu–Mon');
    expect(daysRange([1, 4, 5, 6, 7], ' to ')).toBe('Thu to Mon');
    expect(daysRange([6, 7])).toBe('Sat–Sun');
    expect(daysRange([3])).toBe('Wed');
    expect(daysRange([])).toBeNull();
    expect(daysRange([1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });
});

describe('ProfileService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts empty, then update marks it set up and persists', () => {
    const storage = new MemoryStorage();
    const s = setup(storage);
    expect(s.isEmpty()).toBe(true);
    expect(s.summary()).toBe('Not set up');
    s.update({ styles: ['City', 'Sun'], length: 'weekend', maxFlightHours: 7, days: [4, 5, 6, 7, 1] });
    expect(s.isEmpty()).toBe(false);
    expect(s.profile().updatedAt).toBe('2026-10-01T13:41:00.000Z');
    expect(JSON.parse(storage.getItem(PROFILE_KEY)!).days).toEqual([1, 4, 5, 6, 7]);
    expect(s.summary()).toBe('City, Sun · long weekends · up to 7h · Thu–Mon');

    TestBed.resetTestingModule();
    const again = setup(storage);
    expect(again.profile().styles).toEqual(['City', 'Sun']);
    expect(again.isEmpty()).toBe(false);
  });

  it('dismiss and undismiss keep ids unique without setting up the profile', () => {
    const s = setup(new MemoryStorage());
    s.dismiss('holiday:LGA:2026-10-09');
    s.dismiss('holiday:LGA:2026-10-09');
    expect(s.profile().dismissed).toEqual(['holiday:LGA:2026-10-09']);
    expect(s.isEmpty()).toBe(true);
    s.undismiss('holiday:LGA:2026-10-09');
    expect(s.profile().dismissed).toEqual([]);
  });

  it('reset clears everything', () => {
    const storage = new MemoryStorage();
    const s = setup(storage);
    s.update({ styles: ['Sun'], party: 3 });
    s.reset();
    expect(s.profile()).toEqual(EMPTY_PROFILE);
    expect(JSON.parse(storage.getItem(PROFILE_KEY)!)).toEqual(EMPTY_PROFILE);
  });

  it('keeps working in memory when storage is blocked or missing', () => {
    for (const storage of [new BlockedStorage(), null]) {
      TestBed.resetTestingModule();
      const s = setup(storage);
      s.update({ styles: ['Adventure'] });
      expect(s.profile().styles).toEqual(['Adventure']);
      expect(s.isEmpty()).toBe(false);
    }
  });

  it('ignores a corrupt stored value', () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, '{not json');
    expect(setup(storage).profile()).toEqual(EMPTY_PROFILE);
  });
});
