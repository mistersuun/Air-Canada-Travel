import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { toUtcMs } from '../../utils/time';
import { PendingChange, Trip, emptyFlightLog } from '../model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../testing/seville-fixture';
import { badgeCount, comingUp } from './coming-up';

const yul = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');
const log = emptyFlightLog();

function planned(): Trip {
  const t = sevilleTrip();
  t.legs[0].status = 'planned';
  return t;
}
let n = 0;
const change = (state: PendingChange['state'] = 'open'): PendingChange => {
  const ref = (sevilleTrip().legs[0] as { refs: PendingChange['old'][] }).refs[0];
  return { id: `c${n++}`, legId: SEVILLE_IDS.outbound, refIndex: 0, kind: 'retimed', old: ref, next: ref, generatedAt: null, detectedAt: '2026-10-01T00:00:00Z', state };
};

describe('comingUp', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('names the trip, the days and the open actions', () => {
    const t = planned();
    t.changes = [change()];
    const c = comingUp([t], log, yul('2026-10-04', '09:00'));
    expect(c).toMatchObject({ tripId: SEVILLE_IDS.trip, days: 4 });
    expect(c!.text).toContain('Seville in 4 days · List AC834');
    expect(c!.text.endsWith('1 schedule change')).toBe(true);
  });

  it('says tomorrow, and pluralises changes', () => {
    const t = planned();
    t.changes = [change(), change(), change('accepted')];
    const c = comingUp([t], log, yul('2026-10-07', '20:00'))!;
    expect(c.text.startsWith('Seville tomorrow · List AC834')).toBe(true);
    expect(c.text.endsWith('2 schedule changes')).toBe(true);
  });

  it('leaves out done items', () => {
    const c = comingUp([sevilleTrip()], log, yul('2026-10-04', '09:00'))!;
    expect(c.actions).not.toContain('List AC834');
    expect(c.text.startsWith('Seville in 4 days')).toBe(true);
  });

  it('is null on the travel day, past 7 days, archived or empty', () => {
    const t = planned();
    expect(comingUp([t], log, yul('2026-10-08', '09:00'))).toBeNull();
    expect(comingUp([t], log, yul('2026-09-30', '09:00'))).toBeNull();
    expect(comingUp([t], log, yul('2026-10-01', '09:00'))).not.toBeNull();
    expect(comingUp([{ ...t, archived: true }], log, yul('2026-10-04', '09:00'))).toBeNull();
    expect(comingUp([], log, yul('2026-10-04', '09:00'))).toBeNull();
  });

  it('adds the return reminder', () => {
    expect(comingUp([planned()], log, yul('2026-10-04', '09:00'))!.actions).toContain('Return not listed');
  });

  it('skips a leg that is already done', () => {
    const t = planned();
    t.legs[0].status = 'boarded';
    expect(comingUp([t], log, yul('2026-10-04', '09:00'))).toBeNull();
  });

  it('picks the soonest trip', () => {
    const later = { ...planned(), id: 'later' };
    for (const l of later.legs) if (l.kind === 'flight') l.refs = l.refs.map(r => ({ ...r, dateKey: '2026-10-09' }));
    expect(comingUp([later, planned()], log, yul('2026-10-04', '09:00'))!.tripId).toBe(SEVILLE_IDS.trip);
  });
});

describe('comingUp mid-trip', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('names the way home once the outbound is boarded, without a duplicate return reminder', () => {
    const t = sevilleTrip();
    t.legs[0].status = 'boarded';
    const ret = t.legs.find(l => l.kind === 'flight' && l.role === 'return')!;
    const dep = (ret as { refs: { dateKey: string }[] }).refs[0].dateKey;
    const now = toUtcMs(dep, '09:00', 'Europe/Madrid') - 3 * 86_400_000;
    const c = comingUp([t], log, now)!;
    expect(c.text.startsWith('Home to ')).toBe(true);
    expect(c.text).toContain('in 3 days');
    expect(c.actions.filter(a => a.startsWith('List ')).length).toBeGreaterThan(0);
    expect(c.actions).not.toContain('Return not listed');
  });

  it('skips a trip on its travel day', () => {
    expect(comingUp([planned()], log, yul('2026-10-08', '09:00'))).toBeNull();
  });
});

describe('badgeCount', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('counts prep within 72h, open changes and outcome prompts', () => {
    const t = planned();
    t.changes = [change(), change('kept')];
    expect(badgeCount([t], 2, yul('2026-10-06', '12:00'))).toBe(1 + 1 + 2);
  });

  it('ignores prep further than 72h out but keeps changes and prompts', () => {
    const t = planned();
    t.changes = [change()];
    expect(badgeCount([t], 1, yul('2026-10-04', '09:00'))).toBe(2);
  });

  it('is 0 when nothing waits, and ignores archived trips', () => {
    expect(badgeCount([sevilleTrip()], 0, yul('2026-10-06', '12:00'))).toBe(0);
    expect(badgeCount([{ ...planned(), archived: true }], 0, yul('2026-10-06', '12:00'))).toBe(0);
  });

  it('drops finished trips, departed changes and shared copies', () => {
    const t = planned();
    t.changes = [change()];
    expect(badgeCount([t], 0, yul('2026-12-10', '12:00'))).toBe(0);
    expect(badgeCount([t], 0, yul('2026-10-08', '19:30'))).toBe(0);
    expect(badgeCount([{ ...t, sharedFrom: { at: '2026-10-01T00:00:00Z' } }], 0, yul('2026-10-06', '12:00'))).toBe(0);
  });
});
