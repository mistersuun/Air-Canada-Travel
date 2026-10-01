import { describe, expect, it } from 'vitest';
import type { DecodedRead } from '../../passes/model';
import { BCBP_LEAPDAY, BCBP_MINIMAL, BCBP_MULTILEG, minimalOnDay, minimalPass } from '../../passes/testing/bcbp-fixtures';
import { SEVILLE_IDS, SEVILLE_TRIP } from '../../trips/testing/seville-fixture';
import { legPassesMeta } from '../../passes/ui/leg-passes.component';
import {
  alternateText, barcodeLabel, buildDrafts, draftDateKey, flightLegs, initialChoice, julianLabel, legOptionLabel, matchLine,
  offersCheckIn, passName, pickLeg, savedText, toNewPass,
} from './add-pass-model';
import { fitSvg } from './pass-view.page';

const read = (text: string, over: Partial<DecodedRead> = {}): DecodedRead => ({ text, format: 'PDF417', step: 'as-is', page: null, ...over });

describe('add-pass model', () => {
  it('the minimal sample becomes one draft matched to the AC834 leg on Thu Oct 8', () => {
    const [d, ...rest] = buildDrafts([read(BCBP_MINIMAL)], SEVILLE_TRIP);
    expect(rest).toHaveLength(0);
    expect(d.flightNumber).toBe('AC834');
    expect(d.candidates.map(c => [c.legId, c.refIndex, c.deltaDays])).toEqual([[SEVILLE_IDS.outbound, 0, 0]]);
    expect(d.dateKey).toBe('2026-10-08');
    expect(d.alternate).toBeNull();
    expect(julianLabel(d.leg.julian, d.dateKey)).toEqual({ day: 'Day 281', date: '= Oct 8' });
    expect(barcodeLabel(d.format, d.legCount)).toBe('PDF417 · 1 leg');
    expect(passName(d.passenger)).toBe('DOE/JOHN');
    expect(matchLine(SEVILLE_TRIP, d.candidates[0].ref, '24h')).toBe('Seville trip · Thu Oct 8 · YUL 17:55 → MAD 06:50⁺¹');
  });

  it('a single candidate is the initial choice (confirmed on save); none or several are not', () => {
    const [d] = buildDrafts([read(BCBP_MINIMAL)], SEVILLE_TRIP);
    expect(initialChoice(d, null)).toEqual({ legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed' });
    const [none] = buildDrafts([read(minimalOnDay(283))], SEVILLE_TRIP);
    expect(none.candidates).toHaveLength(0);
    expect(initialChoice(none, SEVILLE_IDS.outbound)).toBeNull(); // the ?leg hint never matches silently
  });

  it('a pass for a backup flight names it and is not matched', () => {
    const [d] = buildDrafts([read(minimalPass({ from: 'YUL', to: 'LIS', flight: '0812', julian: 281 }))], SEVILLE_TRIP);
    expect(d.candidates).toHaveLength(0);
    expect(d.alternate?.ref.flightNumber).toBe('AC812');
    expect(alternateText(d.flightNumber)).toBe(
      'This pass is for AC812, one of your backups. Swap the leg in the trip first, or save the pass to a leg yourself.');
  });

  it('picking a leg by hand is "manual" unless the leg is a candidate', () => {
    const [d] = buildDrafts([read(BCBP_MINIMAL)], SEVILLE_TRIP);
    expect(pickLeg(d, SEVILLE_TRIP, SEVILLE_IDS.outbound)).toEqual({ legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed' });
    expect(pickLeg(d, SEVILLE_TRIP, SEVILLE_IDS.ret)).toEqual({ legId: SEVILLE_IDS.ret, refIndex: 0, matched: 'manual' });
    expect(pickLeg(d, SEVILLE_TRIP, null)).toEqual({ legId: null });
  });

  it('builds the PassRecord input with the full fields, the chosen leg and the resolved date', () => {
    const [d] = buildDrafts([read(BCBP_MINIMAL)], SEVILLE_TRIP);
    const p = toNewPass(d, SEVILLE_TRIP, initialChoice(d, null), { source: 'image', deleteAfterTrip: true, userDate: null });
    expect(p).toEqual({
      tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw: BCBP_MINIMAL, format: 'PDF417',
      bcbpLeg: 0, lastName: 'DOE', firstName: 'JOHN', pnr: 'ABC123', from: 'YUL', to: 'MAD', flightNumber: 'AC834', julian: 281,
      dateKey: '2026-10-08', cabin: 'Y', seat: '12A', sequence: '45', source: 'image', page: null, deleteAfterTrip: true,
    });
    const kept = toNewPass(d, SEVILLE_TRIP, { legId: null }, { source: 'camera', deleteAfterTrip: false, userDate: null });
    expect([kept.legId, kept.refIndex, kept.matched]).toEqual([null, null, 'none']);
  });

  it('day 366 outside a leap year asks the user for the date', () => {
    const [d] = buildDrafts([read(BCBP_LEAPDAY)], SEVILLE_TRIP);
    expect(d.dateKey).toBeNull();
    expect(julianLabel(366, null)).toEqual({ day: 'Day 366', date: '= ?' });
    expect(draftDateKey(d, { legId: null }, SEVILLE_TRIP, null)).toBeNull();
    expect(draftDateKey(d, { legId: null }, SEVILLE_TRIP, '2026-10-09')).toBe('2026-10-09');
  });

  it('a two-leg barcode gives one draft per leg; repeated reads are kept once; non-BCBP reads are dropped', () => {
    const drafts = buildDrafts([read(BCBP_MULTILEG), read(BCBP_MULTILEG), read('https://example.com')], SEVILLE_TRIP);
    expect(drafts.map(d => `${d.leg.from}-${d.leg.to}`)).toEqual(['YVR-YUL', 'YUL-CDG']);
    expect(drafts.every(d => d.legCount === 2)).toBe(true);
    expect(barcodeLabel('Aztec', 2)).toBe('Aztec · 2 legs');
    expect(barcodeLabel('QRCode', 1)).toBe('QR code · 1 leg');
  });

  it('leg options, check-in offer and toasts', () => {
    expect(flightLegs(SEVILLE_TRIP).map(l => legOptionLabel(l))).toEqual([
      'AC834 · YUL → MAD · Thu Oct 8', 'AC813 · LIS → YUL · Tue Oct 13',
    ]);
    expect(offersCheckIn(SEVILLE_TRIP, SEVILLE_IDS.outbound)).toBe(true); // listed
    expect(offersCheckIn(SEVILLE_TRIP, SEVILLE_IDS.ret)).toBe(true); // planned
    expect(offersCheckIn(SEVILLE_TRIP, null)).toBe(false);
    const base = { flightNumber: 'AC834', legId: 'x' } as never;
    expect(savedText([base])).toBe('Pass saved to AC834');
    expect(savedText([{ flightNumber: 'AC834', legId: null } as never])).toBe('Pass saved to the trip');
    expect(savedText([base, base])).toBe('2 passes saved');
    expect(legPassesMeta(['34K', '34J'])).toBe('2 passes · seat 34K, 34J');
    expect(legPassesMeta([null])).toBe('1 pass');
  });

  it('fitSvg lets the barcode fill its box', () => {
    expect(fitSvg('<svg viewBox="0 0 10 10"></svg>')).toBe('<svg preserveAspectRatio="none" viewBox="0 0 10 10"></svg>');
  });
});
