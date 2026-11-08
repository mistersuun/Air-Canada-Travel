import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { decodeClimate } from '../../recs/climate';
import { CLIMATE_FIXTURE } from '../../recs/testing/climate-fixture';
import { decodeVisa } from '../../reference/visa';
import {
  MAX_COMPARE, bestIndexes, compareColumn, compareParam, compareRows, parseCompareCodes, weatherMonth, type CompareInput,
} from './compare-model';

/** Tue Oct 6 2026, 09:00 in Montréal; the week starts Mon Oct 5. */
const BASE: CompareInput = {
  hub: 'YUL', nowMs: Date.parse('2026-10-06T13:00:00Z'), todayKey: '2026-10-06', weekStart: '2026-10-05', dayKey: null,
  showConnections: false, timeFormat: '24h', climate: null, advisories: null, fx: null, visa: null, passports: [],
};

describe('parseCompareCodes', () => {
  it('keeps valid codes, upper-cased and de-duplicated, ignoring the rest', () => {
    expect(parseCompareCodes('lhr, ATH,LHR,ZZZ,,')).toEqual(['LHR', 'ATH']);
    expect(parseCompareCodes('YYZ,LHR,yul')).toEqual(['LHR']); // hubs are not destinations
    expect(parseCompareCodes(null)).toEqual([]);
    expect(parseCompareCodes('')).toEqual([]);
  });
  it('stops at three', () => {
    expect(parseCompareCodes('LHR,ATH,LIS,SVQ,OPO')).toHaveLength(MAX_COMPARE);
  });
  it('builds the param, null when empty', () => {
    expect(compareParam(['LHR', 'ATH'])).toBe('LHR,ATH');
    expect(compareParam([])).toBeNull();
  });
});

describe('bestIndexes', () => {
  it('marks the best only when at least two values differ', () => {
    expect([...bestIndexes([5, 7, 7], 'high')]).toEqual([1, 2]);
    expect([...bestIndexes([300, 200], 'low')]).toEqual([1]);
    expect(bestIndexes([4, 4], 'high').size).toBe(0);
    expect(bestIndexes([4, null], 'high').size).toBe(0);
  });
});

describe('compare columns and rows', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  it('counts nonstops out and home for the week', () => {
    const lhr = compareColumn(BASE, 'LHR');
    expect(lhr.nonstopWeek).toBe(7);
    expect(lhr.homeCount).toBe(7);
    expect(lhr.oneStopWeek).toBeNull();
    const ath = compareColumn(BASE, 'ATH');
    expect(ath.nonstopWeek).toBeGreaterThan(0);
    expect(ath.nonstopWeek).toBeLessThan(7);
    expect(ath.homeCount).toBe(0);
    expect(ath.lastHome).toBeNull();
  });

  it('reports the next departure and the last flight home from today (or the picked day)', () => {
    const lhr = compareColumn(BASE, 'LHR');
    expect(lhr.next?.when).toBe('Today · 22:10');
    expect(lhr.lastHome).toBe('Tue 12:10');
    const picked = compareColumn({ ...BASE, dayKey: '2026-10-09' }, 'LHR');
    expect(picked.next?.when).toContain('Oct 9');
    expect(picked.lastHome).toBe('Fri 12:10');
    expect(compareColumn(BASE, 'ATH').next?.when).toBe('Tomorrow · 17:25');
  });

  it('uses the shortest scheduled nonstop, the time-zone difference and the season', () => {
    const lhr = compareColumn(BASE, 'LHR');
    expect(lhr.flightMin).toBeGreaterThan(300);
    expect(lhr.tz).toMatch(/^\+5h/);
    expect(typeof lhr.season).toBe('string');
  });

  it('adds one-stop counts only when connections are shown', () => {
    const c = compareColumn({ ...BASE, showConnections: true }, 'LHR');
    expect(c.oneStopWeek).toBeGreaterThanOrEqual(0);
    const rows = compareRows([c, compareColumn({ ...BASE, showConnections: true }, 'ATH')], { ...BASE, showConnections: true });
    expect(rows.find(r => r.id === 'flights')!.cells[0].text).toMatch(/7 nonstops · \d+ one-stops?/);
  });

  it('highlights more flights and the shorter flight only; no verdict row', () => {
    const cols = [compareColumn(BASE, 'LHR'), compareColumn(BASE, 'ATH')];
    const rows = compareRows(cols, BASE);
    const best = (id: string) => rows.find(r => r.id === id)!.cells.map(c => !!c.best);
    expect(best('flights')).toEqual([true, false]);
    expect(best('home')).toEqual([true, false]);
    expect(best('duration').filter(Boolean)).toHaveLength(1);
    for (const id of ['next', 'lastHome', 'tz', 'weather', 'currency', 'advisory', 'season']) {
      expect(best(id).some(Boolean)).toBe(false);
    }
    expect(rows.map(r => r.id)).not.toContain('entry');
  });

  it('weather follows the picked day or mid-week, from the climate normals', () => {
    expect(weatherMonth(BASE)).toBe(10);
    expect(weatherMonth({ ...BASE, dayKey: '2026-12-01' })).toBe(12);
    const climate = decodeClimate(CLIMATE_FIXTURE);
    const lis = compareColumn({ ...BASE, climate }, 'LIS');
    expect(lis.weather).toMatchObject({ tmaxC: 30, tminC: 23 });
    const rows = compareRows([lis, compareColumn({ ...BASE, climate }, 'LHR')], { ...BASE, climate });
    const w = rows.find(r => r.id === 'weather')!;
    expect(w.label).toBe('Typical in October');
    expect(w.cells[0].text).toBe('30° / 23°');
  });

  it('shows the entry row only with a passport, labelled with the source and date', () => {
    const visa = decodeVisa({
      v: 1, asOf: '2026-09-01', attribution: 'Passport Index', licenseUrl: 'https://example.org/license',
      cols: ['GB', 'GR'], rows: { CA: 'F180,F90' },
    });
    const input = { ...BASE, visa, passports: ['CA'] };
    const cols = [compareColumn(input, 'LHR'), compareColumn(input, 'ATH')];
    const entry = compareRows(cols, input).find(r => r.id === 'entry')!;
    expect(entry.cells[0].text).toBe('Canada passport: visa-free, up to 180 days, as listed by Passport Index');
    expect(entry.cells[0].sub).toContain('not official');
    expect(compareRows(cols, { ...BASE, visa }).find(r => r.id === 'entry')).toBeUndefined();
    // No listing for that passport: a dash, never a guess.
    const fr = { ...input, passports: ['FR'] };
    const none = compareRows([compareColumn(fr, 'LHR'), compareColumn(fr, 'ATH')], fr).find(r => r.id === 'entry')!;
    expect(none.cells[0].text).toBe('—');
  });
});
