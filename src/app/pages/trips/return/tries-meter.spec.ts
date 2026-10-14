import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../../trips/testing/seville-fixture';
import { METER_MAX, triesHomeLeft, triesMeter } from './tries-meter';

describe('triesMeter', () => {
  it('draws up to six planes, then +N', () => {
    expect(triesMeter(3)).toEqual({ planes: 3, extra: 0, label: '3 tries home left', last: false });
    expect(triesMeter(METER_MAX)).toMatchObject({ planes: 6, extra: 0 });
    expect(triesMeter(9)).toMatchObject({ planes: 6, extra: 3, label: '9 tries home left' });
  });
  it('words one and none; amber only at one', () => {
    expect(triesMeter(1)).toMatchObject({ label: '1 try home left', last: true });
    expect(triesMeter(0)).toMatchObject({ planes: 0, label: '0 tries home left', last: false });
    expect(triesMeter(-2).planes).toBe(0);
  });
});

describe('triesHomeLeft', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());
  const C = { minConnect: 120 };
  const early = Date.UTC(2026, 9, 1);
  const late = Date.UTC(2026, 9, 14);

  it('counts the Return tab tries, and is null once the way home is boarded', () => {
    const t = sevilleTrip();
    expect(triesHomeLeft(t, C, early)).toBeGreaterThan(0);
    const ret = t.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    if (ret.kind === 'flight') ret.status = 'boarded';
    expect(triesHomeLeft(t, C, early)).toBeNull();
  });
  it('counts only tries that have not departed', () => {
    const t = sevilleTrip();
    const all = triesHomeLeft(t, C, early)!;
    const some = triesHomeLeft(t, C, Date.UTC(2026, 9, 13, 11))!;
    expect(some).toBeLessThan(all);
    expect(triesHomeLeft(t, C, Date.UTC(2026, 9, 14))).toBe(0);
    expect(late).toBeGreaterThan(early);
  });
  it('is null, not zero, when the schedules do not cover the days', () => {
    const t = sevilleTrip();
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.ret);
    t.homeBy = { dateKey: '2031-01-10', hhmm: '22:00' };
    expect(triesHomeLeft(t, C, early)).toBeNull();
  });
});
