import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { airportEnd } from '../../places/ground';
import { placeFromDestination } from '../../places/place';
import { searchPlaces } from '../../places/ui/place-search.component';
import { directItineraries } from '../../utils/connections';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../testing/seville-fixture';
import { defaultStopDate, endOptions, groundLegBetween, outboundLeg, replanOutbound, roleForNewFlight } from './edit';

describe('trip edit helpers', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('finds the outbound leg, and re-plans it on another day between the same airports', () => {
    const t = sevilleTrip();
    expect(outboundLeg(t)!.id).toBe(SEVILLE_IDS.outbound);
    const it = replanOutbound(t, '2026-10-09', {}, false)!;
    expect(it.origin).toBe('YUL');
    expect(it.dest).toBe('MAD');
    expect(it.dateKey).toBe('2026-10-09');
    expect(replanOutbound(t, '2031-01-01', {}, false)).toBeNull();
    // A finished outbound is not re-planned.
    t.legs = t.legs.map(l => (l.id === SEVILLE_IDS.outbound ? { ...l, status: 'boarded' as const } : l));
    expect(outboundLeg(t)).toBeNull();
    expect(replanOutbound(t, '2026-10-09', {}, false)).toBeNull();
  });

  it('gives a flight added by hand the right role', () => {
    const t = sevilleTrip();
    expect(roleForNewFlight(t, directItineraries('LIS', 'YUL', '2026-10-13')[0])).toBe('return');
    expect(roleForNewFlight(t, directItineraries('YUL', 'LIS', '2026-10-09')[0])).toBe('onward');
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.outbound);
    expect(roleForNewFlight(t, directItineraries('YUL', 'LIS', '2026-10-09')[0])).toBe('outbound');
  });

  it('lists stops and airports once each, flights only need codes', () => {
    const t = { ...sevilleTrip(), stops: [{ id: 's', place: placeFromDestination('LIS'), arriveDate: '2026-10-12' }] };
    const opts = endOptions(t, ['MAD', 'LIS', 'YUL']);
    const keys = opts.map(o => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`place:${t.goal.id}`);
    expect(keys).toContain('place:ac-LIS');
    expect(keys).toContain('code:MAD');
    expect(opts.find(o => o.key === 'code:YUL')!.code).toBe('YUL');
  });

  it('builds ground legs: Estimated by default, Saved by you with times', () => {
    const t = sevilleTrip();
    const from = airportEnd('MAD')!;
    const to = { name: 'Seville', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid' };
    const est = groundLegBetween(from, to, '2026-10-09', null);
    expect(est).toMatchObject({ kind: 'ground', provenance: 'estimated', userTimes: null, dateKey: '2026-10-09' });
    const saved = groundLegBetween(from, to, '2026-10-09', 'train',
      { depDateKey: '2026-10-09', depLocal: '10:00', arrDateKey: '2026-10-09', arrLocal: '12:30' });
    expect(saved).toMatchObject({ mode: 'train', provenance: 'saved' });
    expect(t.legs).toHaveLength(4);
  });

  it('suggests the next stop two days after the last, never past home-by', () => {
    const t = sevilleTrip();
    expect(defaultStopDate(t)).toBe('2026-10-10');
    t.outboundDate = '2026-10-12';
    expect(defaultStopDate(t)).toBe('2026-10-12');
  });
});

describe('searchPlaces', () => {
  it('finds AC destinations by city start or code, once each, and merges city hits without duplicates', () => {
    expect(searchPlaces('l', [])).toEqual([]);
    expect(searchPlaces('lisb', []).map(p => p.id)).toEqual(['ac-LIS']);
    expect(searchPlaces('LIS', []).map(p => p.acCode)).toContain('LIS');
    const lisbonGn = { ...placeFromDestination('LIS'), id: 'gn-2267057', acCode: 'LIS' };
    const seville = { id: 'gn-2510911', name: 'Seville', country: 'Spain', iso2: 'ES', lat: 37.38, lng: -5.98, tz: 'Europe/Madrid' };
    const out = searchPlaces('lisb', [lisbonGn, seville]);
    expect(out.map(p => p.id)).toEqual(['ac-LIS', 'gn-2510911']);
  });
});
