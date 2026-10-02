import { describe, expect, it } from 'vitest';
import { sevilleTrip, SEVILLE_IDS } from '../trips/testing/seville-fixture';
import { parseBcbp } from './bcbp';
import { matchPassLeg, matchingAlternate, passAlternate, swapOfferText, unmatchedDateKey } from './match';
import type { BcbpLeg } from './model';
import { BCBP_MINIMAL, minimalOnDay, minimalPass } from './testing/bcbp-fixtures';

function leg(raw: string): BcbpLeg {
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('not bcbp');
  return r.legs[0];
}

describe('matchPassLeg', () => {
  it('matches the minimal pass to the AC834 leg', () => {
    const c = matchPassLeg(leg(BCBP_MINIMAL), null, sevilleTrip());
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, dateKey: '2026-10-08', deltaDays: 0 });
    expect(c[0].ref.flightNumber).toBe('AC834');
  });

  it('allows one day either way, not two', () => {
    expect(matchPassLeg(leg(minimalOnDay(282)), null, sevilleTrip())[0]?.deltaDays).toBe(1);
    expect(matchPassLeg(leg(minimalOnDay(280)), null, sevilleTrip())[0]?.deltaDays).toBe(-1);
    expect(matchPassLeg(leg(minimalOnDay(283)), null, sevilleTrip())).toEqual([]);
  });

  it('needs the same origin and destination', () => {
    expect(matchPassLeg(leg(minimalPass({ from: 'LIS', to: 'MAD', flight: '0834', julian: 281 })), null, sevilleTrip())).toEqual([]);
  });

  it('matches the return leg', () => {
    const c = matchPassLeg(leg(minimalPass({ from: 'LIS', to: 'YUL', flight: '0813', julian: 286 })), null, sevilleTrip());
    expect(c.map(x => x.legId)).toEqual([SEVILLE_IDS.ret]);
    expect(c[0].dateKey).toBe('2026-10-13');
  });

  it('puts open legs before finished ones, then the closest date', () => {
    const t = sevilleTrip();
    const out = t.legs[0];
    const copy = { ...structuredClone(out), id: 'leg-copy', status: 'boarded' as const };
    const later = structuredClone(out);
    later.id = 'leg-later';
    if (later.kind === 'flight') later.refs[0].dateKey = '2026-10-09';
    t.legs = [copy, later, ...t.legs];
    const ids = matchPassLeg(leg(BCBP_MINIMAL), null, t).map(c => c.legId);
    expect(ids).toEqual([SEVILLE_IDS.outbound, 'leg-later', 'leg-copy']);
  });

  it('never matches a backup; matchingAlternate names it instead', () => {
    const l = leg(minimalPass({ from: 'YUL', to: 'LIS', flight: '0812', julian: 281 }));
    expect(matchPassLeg(l, null, sevilleTrip())).toEqual([]);
    expect(matchingAlternate(l, sevilleTrip())).toMatchObject({
      legId: SEVILLE_IDS.outbound, altId: SEVILLE_IDS.altLis, refIndex: 0, ref: { flightNumber: 'AC812' },
    });
    expect(matchingAlternate(leg(minimalPass({ from: 'YUL', to: 'LIS', flight: '0812', julian: 284 })), sevilleTrip())).toBeNull();
    expect(matchingAlternate(leg(BCBP_MINIMAL), sevilleTrip())).toBeNull();
  });

  it('anchors an unmatched pass on the trip start (null for an impossible day 366)', () => {
    expect(unmatchedDateKey(leg(minimalOnDay(290)), null, sevilleTrip())).toBe('2026-10-17');
    expect(unmatchedDateKey(leg(minimalOnDay(366)), null, sevilleTrip())).toBeNull();
  });
});

describe('passAlternate (saved passes)', () => {
  const base = { tripId: SEVILLE_IDS.trip, legId: null as string | null, flightNumber: 'AC812', from: 'YUL', to: 'LIS', julian: 281 };

  it('a pass for a backup, saved to no leg or to the planned leg, offers the swap', () => {
    expect(passAlternate(base, sevilleTrip())).toMatchObject({ legId: SEVILLE_IDS.outbound, altId: SEVILLE_IDS.altLis });
    expect(passAlternate({ ...base, legId: SEVILLE_IDS.outbound }, sevilleTrip())).not.toBeNull();
    expect(swapOfferText('AC812')).toBe('This pass is for AC812 (your backup). Swap this leg to AC812?');
  });

  it('no offer for the planned flight, another trip, another day or a leg already flying it', () => {
    expect(passAlternate({ ...base, flightNumber: 'AC834', to: 'MAD' }, sevilleTrip())).toBeNull();
    expect(passAlternate({ ...base, tripId: 'other' }, sevilleTrip())).toBeNull();
    expect(passAlternate({ ...base, julian: 290 }, sevilleTrip())).toBeNull();
    const t = sevilleTrip();
    const out = t.legs.find(l => l.id === SEVILLE_IDS.outbound)!;
    if (out.kind !== 'flight') throw new Error('flight');
    const swapped = { ...t, legs: [...t.legs, { ...out, id: 'leg-812', refs: out.alternates[1].refs, alternates: [] }] };
    expect(passAlternate(base, swapped)).toBeNull();
  });
});
