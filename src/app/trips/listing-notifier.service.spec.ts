import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlightLeg } from './model';
import { refDepUtc } from './engine/legs';
import { listingOpensUtc } from './engine/listing';
import { LISTING_SEEN_KEY, ListingNotifierService } from './listing-notifier.service';
import { sevilleTrip } from './testing/seville-fixture';
import { TripsService } from './trips.service';

const trip = sevilleTrip();
(trip.legs[0] as FlightLeg).status = 'planned';
const OPENS = listingOpensUtc(refDepUtc((trip.legs[0] as FlightLeg).refs[0]), 48);

describe('ListingNotifierService', () => {
  const shown = vi.fn();
  beforeEach(() => {
    shown.mockClear();
    localStorage.removeItem(LISTING_SEEN_KEY);
    class N { static permission = 'granted'; constructor(t: string, o: unknown) { shown(t, o); } }
    vi.stubGlobal('Notification', N);
    TestBed.configureTestingModule({
      providers: [{ provide: TripsService, useValue: { readOnly: () => false, trips: () => [trip] } }],
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('notifies once for a window opened since the last open', () => {
    localStorage.setItem(LISTING_SEEN_KEY, String(OPENS - 3_600_000));
    const s = TestBed.inject(ListingNotifierService);
    expect(s.check(OPENS + 3_600_000)).toBe(1);
    expect(shown).toHaveBeenCalledWith('Listing open for AC834', expect.objectContaining({ tag: expect.stringMatching(/^listing-.+-0$/) }));
    expect(s.check(OPENS + 7_200_000)).toBe(0);
  });

  it('does nothing on a first open or without permission', () => {
    const s = TestBed.inject(ListingNotifierService);
    expect(s.check(OPENS + 3_600_000)).toBe(0);
    localStorage.setItem(LISTING_SEEN_KEY, String(OPENS - 3_600_000));
    (Notification as unknown as { permission: string }).permission = 'default';
    expect(s.check(OPENS + 3_600_000)).toBe(0);
    expect(shown).not.toHaveBeenCalled();
  });
});
