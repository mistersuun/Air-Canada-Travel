import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { placeFromDestination } from '../../places/place';
import type { Trip } from '../../trips/model';
import { SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { midTripView } from './today-model';

describe('mid-trip day on a multi-stop trip', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('names the stop you are in and counts days from arriving there', () => {
    const trip: Trip = { ...sevilleTrip(), stops: [{ id: 'stop-lis', place: placeFromDestination('LIS'), arriveDate: '2026-10-12' }] };
    expect(midTripView([trip], toUtcMs('2026-10-10', '12:00', 'Europe/Madrid'), '24h')!.title).toBe('Day 2 in Seville');
    expect(midTripView([trip], toUtcMs('2026-10-12', '20:00', 'Europe/Madrid'), '24h')!.title).toBe('Day 1 in Lisbon');
    expect(midTripView([trip], toUtcMs('2026-10-13', '08:00', 'Europe/Madrid'), '24h')!.title).toBe('Day 2 in Lisbon');
  });
});
