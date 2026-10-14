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
});
