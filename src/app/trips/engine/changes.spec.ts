import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleRoute, resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { rec, route } from '../../data/testing/schedule-fixtures';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../testing/seville-fixture';
import { changeKey, detectChanges, looksLikeBadData, refreshAircraft, scanTrip } from './changes';

const NOW = '2026-10-02T12:00:00.000Z';

/** The fixture with LIS→YUL replaced. */
function withLisYul(...rows: ReturnType<typeof rec>[]): ScheduleRoute[] {
  return SEVILLE_ROUTES.map(r => (r.originCode === 'LIS' && r.destinationCode === 'YUL' ? route('LIS', 'YUL', ...rows) : r));
}
const FROM = '2026-09-29', TO = '2027-09-26';
const MON_SAT = 'Mon,Tue,Wed,Thu,Fri,Sat';

describe('detectChanges', () => {
  afterEach(() => resetScheduleSource());

  it('finds nothing when the plan matches the schedules', () => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    expect(detectChanges(sevilleTrip(), NOW)).toEqual([]);
    expect(scanTrip(sevilleTrip()).checked).toBe(2); // AC834 (listed) and AC813 (planned)
  });

  it('reports AC813 retimed to 11:10 as one change, never applied', () => {
    setScheduleSource(withLisYul(rec('AC813', '11:10', '13:35', FROM, TO, MON_SAT, '333')), SEVILLE_META);
    const trip = sevilleTrip();
    const found = detectChanges(trip, NOW);
    expect(found).toHaveLength(1);
    const c = found[0];
    expect(c.kind).toBe('retimed');
    expect(c.legId).toBe(SEVILLE_IDS.ret);
    expect(c.refIndex).toBe(0);
    expect(c.old.depLocal).toBe('11:25');
    expect(c.next!.depLocal).toBe('11:10');
    expect(c.next!.arrLocal).toBe('13:35');
    expect(c.state).toBe('open');
    expect(c.generatedAt).toBe(SEVILLE_META.generatedAt);
    expect(c.detectedAt).toBe(NOW);
    // The trip itself is untouched.
    const ret = trip.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    expect(ret.kind === 'flight' && ret.refs[0].depLocal).toBe('11:25');
    // Stored changes (any state) are not raised again.
    expect(detectChanges({ ...trip, changes: [{ ...c, state: 'kept' }] }, NOW)).toEqual([]);
  });

  it('reports a missing AC813 as notFound, never as cancelled', () => {
    setScheduleSource(withLisYul(), SEVILLE_META);
    const found = detectChanges(sevilleTrip(), NOW);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('notFound');
    expect(found[0].next).toBeNull();
    expect(JSON.stringify(found).toLowerCase()).not.toContain('cancel');
    expect(looksLikeBadData([sevilleTrip()], found)).toBe(false);
  });

  it('flags data with every route gone as bad, not as changes to apply', () => {
    setScheduleSource([], SEVILLE_META);
    const found = detectChanges(sevilleTrip(), NOW);
    expect(found.map(c => c.kind)).toEqual(['notFound', 'notFound']);
    expect(looksLikeBadData([sevilleTrip()], found)).toBe(true);
  });

  it('reports dates beyond the published window as outsideCoverage', () => {
    const trip = sevilleTrip();
    // Per-airport windows come from the rows: end every LIS row on Oct 10.
    setScheduleSource(SEVILLE_ROUTES.map(r => r.originCode === 'LIS' || r.destinationCode === 'LIS'
      ? route(r.originCode, r.destinationCode, ...r.schedules.map(s => ({ ...s, toDate: '2026-10-10' }))) : r), SEVILLE_META);
    const found = detectChanges(trip, NOW);
    expect(found.map(c => c.kind)).toEqual(['outsideCoverage']);
    expect(found[0].legId).toBe(SEVILLE_IDS.ret);
  });

  it('ignores legs that are done', () => {
    setScheduleSource([], SEVILLE_META);
    const trip = sevilleTrip();
    trip.legs.forEach(l => (l.status = 'boarded'));
    expect(detectChanges(trip, NOW)).toEqual([]);
    expect(looksLikeBadData([trip], [])).toBe(false);
  });

  it('refreshes an aircraft-only change silently', () => {
    setScheduleSource(withLisYul(rec('AC813', '11:25', '13:50', FROM, TO, MON_SAT, '789')), SEVILLE_META);
    const trip = sevilleTrip();
    expect(detectChanges(trip, NOW)).toEqual([]);
    const next = refreshAircraft(trip);
    const ret = next.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    expect(ret.kind === 'flight' && ret.refs[0].aircraft).toBe('789');
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    expect(refreshAircraft(trip)).toBe(trip);
  });

  it('keys changes by leg, segment, kind and new times', () => {
    const base = { legId: 'a', refIndex: 0, kind: 'retimed' as const };
    const n = { flightNumber: 'AC1', origin: 'LIS', dest: 'YUL', dateKey: '2026-10-13', depLocal: '11:10', arrLocal: '13:35', arrDateKey: '2026-10-13', aircraft: null };
    expect(changeKey({ ...base, next: n })).not.toBe(changeKey({ ...base, next: { ...n, depLocal: '11:00' } }));
    expect(changeKey({ ...base, kind: 'notFound', next: null })).toBe('a|0|notFound|');
  });
});
