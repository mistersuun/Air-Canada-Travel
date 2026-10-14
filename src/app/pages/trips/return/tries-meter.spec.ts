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
  it('counts the Return tab tries, and is null once the way home is boarded', () => {
    const t = sevilleTrip();
    expect(triesHomeLeft(t, { minConnect: 120 })).toBeGreaterThan(0);
    const ret = t.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    if (ret.kind === 'flight') ret.status = 'boarded';
    expect(triesHomeLeft(t, { minConnect: 120 })).toBeNull();
  });
});
