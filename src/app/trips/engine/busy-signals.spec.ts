import { describe, expect, it } from 'vitest';
import { breakLegend, daySignals, holidaysOnFor, signalText, windowSignalLines } from './busy-signals';
import {
  HUB_PROVINCE, SCHOOL_BREAKS, breakLabel, hubProvince, schoolBreakOn, schoolBreaksBetween, schoolBreaksFor,
} from './school-breaks';
import { HUBS } from '../../data/destinations';

describe('school breaks table', () => {
  it('maps every hub to a province', () => {
    for (const h of HUBS) expect(hubProvince(h.code), h.code).not.toBeNull();
    expect(HUB_PROVINCE['YTZ']).toBe('ON');
    expect(hubProvince('XXX')).toBeNull();
  });

  it('keeps a source and a review date on every row, and well-formed ranges', () => {
    for (const b of SCHOOL_BREAKS) {
      expect(b.source).toMatch(/^https:\/\//);
      expect(b.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.from <= b.to).toBe(true);
    }
  });

  it('looks breaks up by the hub province', () => {
    expect(schoolBreaksFor('YYZ').map(b => b.kind)).toEqual(['winter', 'march']);
    expect(schoolBreaksFor('YOW')).toEqual(schoolBreaksFor('YYZ'));
    expect(schoolBreakOn('YYZ', '2027-03-17')?.board).toBe('Toronto District School Board');
    expect(schoolBreakOn('YYZ', '2027-03-22')).toBeNull();
    expect(schoolBreakOn('YUL', '2027-03-03')?.kind).toBe('relache');
    expect(schoolBreakOn('YUL', '2027-03-17')).toBeNull();
    expect(schoolBreakOn('YVR', '2027-03-24')?.kind).toBe('spring');
    expect(schoolBreakOn('YEG', '2027-03-28')?.board).toBe('Calgary Board of Education');
    expect(schoolBreakOn('YHZ', '2027-03-10')?.board).toBe('Nova Scotia');
    expect(schoolBreakOn('YWG', '2027-04-01')?.board).toBe('Winnipeg School Division');
    expect(schoolBreakOn('XXX', '2027-03-17')).toBeNull();
  });

  it('finds breaks overlapping a window', () => {
    expect(schoolBreaksBetween('YYZ', '2027-03-19', '2027-03-21')).toHaveLength(1);
    expect(schoolBreaksBetween('YYZ', '2027-03-20', '2027-03-21')).toHaveLength(0);
  });

  it('names the board in the label', () => {
    expect(breakLabel(schoolBreakOn('YYZ', '2027-03-17')!)).toBe('Toronto District School Board March break');
    expect(breakLabel(schoolBreakOn('YUL', '2027-03-03')!)).toBe('CSSDM spring break (relâche)');
  });
});

describe('busy signals', () => {
  it('lists the holidays that apply in the hub province', () => {
    expect(holidaysOnFor('YYZ', '2027-02-15').map(h => h.name)).toEqual(['Family Day']);
    expect(holidaysOnFor('YUL', '2027-02-15')).toEqual([]);
    expect(holidaysOnFor('YWG', '2027-02-15').map(h => h.name)).toEqual(['Louis Riel Day']);
    expect(holidaysOnFor('YUL', '2027-06-24').map(h => h.name)).toEqual(['Fête nationale']);
    expect(holidaysOnFor('YYZ', '2026-12-25').map(h => h.name)).toEqual(['Christmas Day']);
    // Not statutory everywhere: no marker.
    expect(holidaysOnFor('YYZ', '2027-03-29')).toEqual([]);
  });

  it('writes neutral text, never busy or full', () => {
    const s = daySignals('YYZ', '2027-03-15');
    expect(signalText('YYZ', s)).toEqual(['School break (Ontario): Toronto District School Board March break']);
    expect(breakLegend('YYZ')).toBe('School break (Ontario)');
    expect(signalText('YYZ', daySignals('YYZ', '2027-02-15'))).toEqual(['Holiday: Family Day']);
    for (const line of windowSignalLines('YYZ', '2026-12-01', '2027-04-30')) expect(line).not.toMatch(/busy|full|crowd/i);
  });

  it('lists holidays then breaks inside a window', () => {
    expect(windowSignalLines('YYZ', '2027-03-12', '2027-03-21')).toEqual([
      'School break (Ontario): Toronto District School Board March break, Mar 15 – 19',
    ]);
    expect(windowSignalLines('YYZ', '2027-02-12', '2027-02-16')).toEqual(['Holiday: Family Day (Mon, Feb 15)']);
    expect(windowSignalLines('YYZ', '2027-05-01', '2027-05-03')).toEqual([]);
  });
});
