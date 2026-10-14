import { describe, expect, it } from 'vitest';
import type { FlightLeg } from '../model';
import { sevilleTrip } from '../testing/seville-fixture';
import { DEFAULT_LISTING_HOURS, listingChip, listingOpenedSince, listingOpensUtc } from './listing';
import { refDepUtc } from './legs';

const trip = sevilleTrip();
const out = trip.legs[0] as FlightLeg;       // AC834 YUL → MAD, Oct 8 17:55 Toronto
const DEP = refDepUtc(out.refs[0]);
const H = 3_600_000;

describe('listing windows', () => {
  it('defaults to 48 hours before departure', () => {
    expect(DEFAULT_LISTING_HOURS).toBe(48);
    expect(listingOpensUtc(DEP, 48)).toBe(DEP - 48 * H);
  });

  it('shows Listing open once the window has opened for a planned leg', () => {
    const planned = { ...out, status: 'planned' } as FlightLeg;
    expect(listingChip(planned, DEP - 47 * H, 48)).toMatchObject({ label: 'Listing open', open: true });
    expect(listingChip(planned, DEP - 60 * H, 48)).toMatchObject({ open: false });
    expect(listingChip(planned, DEP - 60 * H, 48)!.label).toMatch(/^Listing opens (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2}$/);
  });

  it('shows nothing when far ahead, listed, or departed', () => {
    const planned = { ...out, status: 'planned' } as FlightLeg;
    expect(listingChip(planned, DEP - 100 * H, 48)).toBeNull();
    expect(listingChip({ ...out, status: 'listed' } as FlightLeg, DEP - 10 * H, 48)).toBeNull();
    expect(listingChip(planned, DEP + H, 48)).toBeNull();
  });

  it('follows the setting', () => {
    const planned = { ...out, status: 'planned' } as FlightLeg;
    expect(listingChip(planned, DEP - 60 * H, 72)).toMatchObject({ label: 'Listing open' });
    expect(listingChip(planned, DEP - 60 * H, 24)).toBeNull();
  });

  it('finds windows that opened since the last open', () => {
    const t = sevilleTrip();
    (t.legs[0] as FlightLeg).status = 'planned';
    const opens = listingOpensUtc(DEP, 48);
    expect(listingOpenedSince([t], opens - H, opens + H, 48)).toHaveLength(1);
    expect(listingOpenedSince([t], opens + 1, opens + H, 48)).toHaveLength(0);
    expect(listingOpenedSince([t], opens - 2 * H, opens - H, 48)).toHaveLength(0);
    (t.legs[0] as FlightLeg).status = 'listed';
    expect(listingOpenedSince([t], opens - H, opens + H, 48)).toHaveLength(0);
  });
});
