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
    expect(listingChip(planned, DEP - 60 * H, 48)!.label).toMatch(/^Listing opens (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2}( YUL time)?$/);
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

  it('uses the earliest segment that has not left, and skips Estimated segments', () => {
    const second = { ...out.refs[0], flightNumber: 'AC900', dateKey: '2026-10-09', depLocal: '10:00' };
    const multi = { ...out, status: 'planned', refs: [out.refs[0], second] } as FlightLeg;
    const c = listingChip(multi, DEP + H, 48)!;           // first segment has left: the chip is about the second
    expect(c).toMatchObject({ label: 'Listing open', refIndex: 1 });
    const est = { ...out, status: 'planned', refs: [{ ...out.refs[0], flightNumber: 'EST' }] } as FlightLeg;
    expect(listingChip(est, DEP - 10 * H, 48)).toBeNull();
    const t = sevilleTrip();
    t.legs[0] = { ...multi };
    const opens2 = listingOpensUtc(refDepUtc(second), 48);
    expect(listingOpenedSince([t], opens2 - H, opens2 + H, 48).map(x => x.refIndex)).toContain(1);
  });

  it('adds the airport zone to "Listing opens" only when the device clock differs', () => {
    const planned = { ...out, status: 'planned' } as FlightLeg;
    const label = listingChip(planned, DEP - 60 * H, 48)!.label;
    const same = new Date(DEP - 48 * H).getTimezoneOffset() === 240 || new Date(DEP - 48 * H).getTimezoneOffset() === 300;
    expect(label.endsWith(' YUL time')).toBe(!same);
  });
});
