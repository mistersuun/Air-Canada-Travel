import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import { placeFromDestination } from '../../../places/place';
import type { Trip } from '../../../trips/model';
import { SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../../trips/testing/seville-fixture';
import { directItineraries } from '../../../utils/connections';
import { groundToGateway, returnGateway } from './return-model';

describe('return model on a multi-stop trip', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('plans home from the last stop, not the goal', () => {
    const t: Trip = { ...sevilleTrip(), legs: [] };
    expect(returnGateway(t)).not.toBe('LIS');
    const multi: Trip = { ...t, stops: [{ id: 'stop-lis', place: placeFromDestination('LIS'), arriveDate: '2026-10-12' }] };
    expect(returnGateway(multi)).toBe('LIS');
    // No ground leg is needed when the last stop is the airport city itself.
    const lis = directItineraries('LIS', 'YUL', '2026-10-13')[0];
    expect(groundToGateway(multi, lis)).toBeNull();
    expect(groundToGateway(t, lis)).not.toBeNull();
  });

  it('ignores the airport you flew into when the last stop is somewhere else', () => {
    const single: Trip = { ...sevilleTrip(), legs: sevilleTrip().legs.slice(0, 2) };   // AC834 into Madrid, train to Seville
    expect(returnGateway(single)).toBe('MAD');
    const multi: Trip = { ...single, stops: [{ id: 'stop-lis', place: placeFromDestination('LIS'), arriveDate: '2026-10-12' }] };
    expect(returnGateway(multi)).toBe('LIS');
    // A planned return flight still decides.
    expect(returnGateway({ ...multi, legs: sevilleTrip().legs })).toBe('LIS');
  });

  it('uses the last stop\'s own airport, and the far end of a ground leg that starts at it', () => {
    const lisbon = placeFromDestination('LIS');
    const train = {
      kind: 'ground' as const, id: 'g-opo', status: 'planned' as const, statusAt: null, note: '', mode: 'train' as const,
      from: { name: 'Lisbon', code: 'LIS', lat: lisbon.lat, lng: lisbon.lng, tz: lisbon.tz },
      to: { name: 'Porto', code: 'OPO', lat: 41.24, lng: -8.68, tz: 'Europe/Lisbon' },
      dateKey: '2026-10-12', estMinutes: 180, provenance: 'estimated' as const, userTimes: null,
    };
    const t: Trip = { ...sevilleTrip(), legs: [train], stops: [{ id: 's', place: lisbon, arriveDate: '2026-10-11' }] };
    expect(returnGateway(t)).toBe('OPO');
    // Without stops the same leg is just a leg.
    expect(returnGateway({ ...t, stops: undefined })).toBe('OPO');
    // A train between earlier stops (Madrid to Seville) does not decide for a Lisbon ending.
    expect(returnGateway({ ...t, legs: sevilleTrip().legs.slice(1, 2) })).toBe('LIS');
  });
});
