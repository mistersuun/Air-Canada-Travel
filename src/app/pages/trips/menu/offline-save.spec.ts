import { describe, expect, it } from 'vitest';
import type { Trip } from '../../../trips/model';
import { offlineFlash, offlineItems, offlineReportLabel, tripDestCode, warmOffline } from './offline-save';

function trip(legs: unknown[], acCode?: string): Trip {
  return { goal: { acCode }, legs } as unknown as Trip;
}
const ground = { kind: 'ground' };
const outbound = { kind: 'flight', role: 'outbound', refs: [{ dest: 'LIS' }] };

describe('offline save', () => {
  it('picks the destination code from the goal, else the outbound flight', () => {
    expect(tripDestCode(trip([outbound], 'MAD'))).toBe('MAD');
    expect(tripDestCode(trip([outbound]))).toBe('LIS');
    expect(tripDestCode(trip([ground]))).toBeNull();
  });

  it('lists ground only for trips with ground legs, photos only when one exists', () => {
    const ids = (t: Trip, has = true) => offlineItems(t, () => has).map(i => i.id);
    expect(ids(trip([outbound]))).toEqual(['schedules', 'cities', 'climate', 'photos']);
    expect(ids(trip([outbound, ground]))).toEqual(['schedules', 'ground', 'cities', 'climate', 'photos']);
    expect(ids(trip([outbound]), false)).toEqual(['schedules', 'cities', 'climate']);
    expect(offlineItems(trip([outbound]), () => true).find(i => i.id === 'photos')!.urls)
      .toEqual(['img/dest/LIS-400.webp', 'img/dest/LIS.webp']);
  });

  it('an item is ok only when every url answered ok; failures and throws are per item', async () => {
    const items = offlineItems(trip([outbound, ground]), () => true);
    const results = await warmOffline(items, async u => {
      if (u.includes('cities')) throw new Error('offline');
      return { ok: !u.endsWith('LIS.webp') };
    });
    expect(Object.fromEntries(results.map(r => [r.id, r.ok])))
      .toEqual({ schedules: true, ground: true, cities: false, climate: true, photos: false });
    expect(offlineReportLabel(results)).toBe('Schedules ✓ · Trains ✓ · City info ✗ · Weather ✓ · Photos ✗');
  });

  it('flash: all ok, schedules missing, or other items missing', () => {
    const r = (a: boolean, b: boolean) => [
      { id: 'schedules' as const, label: 'Schedules', ok: a },
      { id: 'cities' as const, label: 'City info', ok: b },
    ];
    expect(offlineFlash(r(true, true))).toBe('Saved for offline');
    expect(offlineFlash(r(false, true))).toContain('Schedules need a connection');
    expect(offlineFlash(r(true, false))).toBe('Saved for offline, but not yet: City info');
  });
});
