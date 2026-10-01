import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY } from 'rxjs';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { NOW } from '../state/app-state.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { SEVILLE_TRIP } from '../trips/testing/seville-fixture';
import { CLIMATE_FETCH } from './climate.service';
import { PROFILE_STORAGE, ProfileService } from './profile.service';
import { RecsService, tripCodes } from './recs.service';
import { CLIMATE_FIXTURE } from './testing/climate-fixture';
import { RECS_META, RECS_NOW, RECS_PROFILE, RECS_ROUTES } from './testing/recs-fixture';

describe('RecsService', () => {
  beforeEach(() => {
    setScheduleSource(RECS_ROUTES, RECS_META);
    const prefs = new MemoryStorage();
    prefs.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', favourites: ['OPO'] }));
    TestBed.configureTestingModule({
      providers: [
        { provide: NOW, useValue: () => RECS_NOW },
        { provide: PREFS_STORAGE, useValue: prefs },
        { provide: PROFILE_STORAGE, useValue: new MemoryStorage() },
        { provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE },
        { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: EMPTY, unrecoverable: EMPTY } },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    resetScheduleSource();
  });

  it('follows the profile and the climate load', async () => {
    const recs = TestBed.inject(RecsService);
    const profile = TestBed.inject(ProfileService);
    expect(recs.forExplore()).toEqual([]); // deferred until the first render
    TestBed.tick();
    // Empty profile: holiday and season only.
    expect(recs.forExplore().flatMap(g => g.items).every(r => r.kind === 'holiday' || r.kind === 'seasonEnding')).toBe(true);

    profile.update({ ...RECS_PROFILE });
    const first = recs.forExplore()[0];
    expect(first.title).toBe('Thanksgiving long weekend in 8 days');
    expect(first.items.every(r => r.weather === null)).toBe(true); // climate not loaded yet

    await recs.ensureClimate();
    const fll = recs.forExplore()[0].items.find(r => r.code === 'FLL')!;
    expect(fll.weather).toMatchObject({ tmaxC: 30, tminC: 23 });
    expect(recs.forExplore().some(g => g.id === 'season')).toBe(true);

    profile.dismiss(fll.id);
    expect(recs.forExplore()[0].items.map(r => r.code)).not.toContain('FLL');
  });

  it('collects the codes active trips already cover', () => {
    const codes = tripCodes([SEVILLE_TRIP]);
    expect(codes).toContain('MAD');
    expect(codes).toContain('YUL');
  });
});
