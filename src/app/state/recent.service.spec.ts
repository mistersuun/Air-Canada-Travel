import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RECENT_KEY, RECENT_MAX, RECENT_STORAGE, RecentService, pushRecent } from './recent.service';
import { MemoryStorage } from './testing';

function make(store: Storage | null) {
  TestBed.configureTestingModule({ providers: [{ provide: RECENT_STORAGE, useValue: store }] });
  return TestBed.inject(RecentService);
}

describe('RecentService', () => {
  it('pushRecent puts the newest first, drops duplicates and keeps the last 6', () => {
    expect(pushRecent(['LHR', 'ATH'], 'ath')).toEqual(['ATH', 'LHR']);
    const many = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];
    expect(pushRecent(many, 'ZZZ')).toEqual(['ZZZ', 'AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
    expect(pushRecent(many, 'ZZZ')).toHaveLength(RECENT_MAX);
  });

  it('persists to its own key and reloads', () => {
    const store = new MemoryStorage();
    const svc = make(store);
    svc.add('LHR');
    svc.add('ATH');
    svc.add('LHR');
    expect(svc.codes()).toEqual(['LHR', 'ATH']);
    expect(JSON.parse(store.getItem(RECENT_KEY)!)).toEqual(['LHR', 'ATH']);
    TestBed.resetTestingModule();
    expect(make(store).codes()).toEqual(['LHR', 'ATH']);
  });

  it('ignores corrupt storage and works with storage blocked or throwing', () => {
    const bad = new MemoryStorage();
    bad.setItem(RECENT_KEY, '{nope');
    expect(make(bad).codes()).toEqual([]);
    TestBed.resetTestingModule();
    const svc = make(null);
    svc.add('LIS');
    expect(svc.codes()).toEqual(['LIS']);
    TestBed.resetTestingModule();
    const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } as unknown as Storage;
    const s2 = make(throwing);
    s2.add('MAD');
    expect(s2.codes()).toEqual(['MAD']);
  });
});
