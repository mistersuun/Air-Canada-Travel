import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlatformLocation } from '@angular/common';
import { PROFILE_KEY } from '../recs/model';
import { PROFILE_STORAGE } from '../recs/profile.service';
import { PREFS_KEY, PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { ONBOARDED_KEY, OnboardingService } from './onboarding.service';

function setup(o: { prefs?: boolean; profile?: boolean; flag?: boolean; path?: string; storage?: Storage | null } = {}) {
  const store = o.storage === undefined ? new MemoryStorage() : o.storage;
  if (store && o.prefs) store.setItem(PREFS_KEY, '{}');
  if (store && o.profile) store.setItem(PROFILE_KEY, JSON.stringify({ updatedAt: '2026-10-01T00:00:00Z' }));
  if (store && o.flag) store.setItem(ONBOARDED_KEY, '1');
  TestBed.configureTestingModule({
    providers: [
      { provide: PREFS_STORAGE, useValue: store },
      { provide: PROFILE_STORAGE, useValue: store },
      { provide: PlatformLocation, useValue: { pathname: o.path ?? '/' } },
    ],
  });
  return { svc: TestBed.inject(OnboardingService), store };
}

describe('OnboardingService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows on a clean first visit to / and never again after finish()', () => {
    const { svc, store } = setup();
    expect(svc.visible()).toBe(true);
    svc.finish();
    expect(svc.visible()).toBe(false);
    expect(store!.getItem(ONBOARDED_KEY)).toBe('1');
    TestBed.resetTestingModule();
    expect(setup({ flag: true }).svc.visible()).toBe(false);
  });

  it.each([
    ['saved prefs', { prefs: true }],
    ['a set-up profile', { profile: true }],
    ['a deep link', { path: '/to/LHR' }],
    ['blocked storage', { storage: null }],
  ])('stays hidden with %s', (_n, o) => {
    expect(setup(o).svc.visible()).toBe(false);
  });
});
