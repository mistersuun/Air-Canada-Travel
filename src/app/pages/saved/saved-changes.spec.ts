import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { setLocale } from '../../i18n/locale';
import { changeLabel, diffSnapshots, isSnapshot, snapshotFor, type DestSnapshot } from './saved-changes';

beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
afterEach(() => { resetScheduleSource(); setLocale('en'); });

const TODAY = '2026-10-01'; // Thursday; its week starts Mon Sep 28

function snap(season: Record<string, [string, string]>, weeks: Record<string, Record<string, number>> = {}): DestSnapshot {
  return { v: 1, season, weeks };
}

describe('snapshotFor', () => {
  it('records 8 weeks of nonstop-day counts and the season per hub with a route', () => {
    const s = snapshotFor('ATH', TODAY, ['YUL', 'YYZ']);
    expect(Object.keys(s.season)).toEqual(['YUL']);
    expect(s.season['YUL']).toEqual(['2026-10-01', '2026-10-31']);
    expect(Object.keys(s.weeks['YUL'])).toHaveLength(8);
    expect(s.weeks['YUL']['2026-09-28']).toBe(1); // only Fri Oct 2 of that week
    expect(isSnapshot(s)).toBe(true);
    expect(isSnapshot({ v: 2 })).toBe(false);
  });
});

describe('diffSnapshots', () => {
  it('has nothing to say without a previous snapshot or when nothing moved', () => {
    const now = snapshotFor('LHR', TODAY, ['YUL']);
    expect(diffSnapshots(null, now, TODAY)).toEqual([]);
    expect(diffSnapshots(now, now, TODAY, 'YUL')).toEqual([]);
  });

  it('reports a new nonstop from a hub, with its first date', () => {
    const prev = snap({});
    const next = snap({ YUL: ['2027-03-02', '2027-10-30'] });
    const c = diffSnapshots(prev, next, TODAY, 'YUL');
    expect(c).toEqual([{ kind: 'new', hub: 'YUL', from: '2027-03-02' }]);
    expect(changeLabel(c[0], TODAY, 'YUL')).toBe('New: nonstop from YUL from Mar 2');
  });

  it('reports when the last nonstop moves earlier, or the route is gone', () => {
    const prev = snap({ YUL: ['2026-09-01', '2027-03-31'] });
    const earlier = diffSnapshots(prev, snap({ YUL: ['2026-09-01', '2026-10-28'] }), TODAY, 'YUL');
    expect(changeLabel(earlier[0], TODAY, 'YUL')).toBe('Ends: last nonstop Oct 28');
    const gone = diffSnapshots(prev, snap({}), TODAY, 'YUL');
    expect(gone).toEqual([{ kind: 'ends', hub: 'YUL', last: '2027-03-31' }]);
    // a later end (the window simply rolled forward) is not news
    expect(diffSnapshots(snap({ YUL: ['2026-09-01', '2026-10-28'] }), snap({ YUL: ['2026-09-01', '2027-03-31'] }), TODAY, 'YUL')).toEqual([]);
  });

  it('reports the first upcoming week whose nonstop days changed', () => {
    const season: Record<string, [string, string]> = { YUL: ['2026-09-01', '2027-03-31'] };
    const prev = snap(season, { YUL: { '2026-09-21': 5, '2026-09-28': 3, '2026-10-05': 3 } });
    const next = snap(season, { YUL: { '2026-09-28': 2, '2026-10-05': 1 } });
    const c = diffSnapshots(prev, next, TODAY, 'YUL');
    expect(c).toEqual([{ kind: 'fewer', hub: 'YUL', weekStart: '2026-09-28', from: 3, to: 2 }]);
    expect(changeLabel(c[0], TODAY, 'YUL')).toBe('Fewer days this week: 3 → 2');
    const later = diffSnapshots(snap(season, { YUL: { '2026-09-28': 3, '2026-10-05': 3 } }), snap(season, { YUL: { '2026-09-28': 3, '2026-10-05': 5 } }), TODAY, 'YUL');
    expect(changeLabel(later[0], TODAY, 'YUL')).toBe('More days the week of Oct 5: 3 → 5');
  });

  it('does not compare weeks past either end of the published window (coverage extended)', () => {
    const prev = snap({ YUL: ['2026-09-01', '2026-10-14'] }, { YUL: { '2026-10-05': 3, '2026-10-12': 0, '2026-10-19': 0 } });
    // schedules now run further: the later weeks gained days, the partial week too
    const next = snap({ YUL: ['2026-09-01', '2026-10-31'] }, { YUL: { '2026-10-05': 3, '2026-10-12': 3, '2026-10-19': 4 } });
    expect(diffSnapshots(prev, next, TODAY, 'YUL')).toEqual([]);
    // a real removal inside the shared window still shows
    const cut = snap({ YUL: ['2026-09-01', '2026-10-31'] }, { YUL: { '2026-10-05': 2, '2026-10-12': 3, '2026-10-19': 4 } });
    expect(diffSnapshots(prev, cut, TODAY, 'YUL')).toEqual([{ kind: 'fewer', hub: 'YUL', weekStart: '2026-10-05', from: 3, to: 2 }]);
  });

  it('respects the stored coverage end', () => {
    const season: Record<string, [string, string]> = { YUL: ['2026-09-01', '2027-03-31'] };
    const prev: DestSnapshot = { ...snap(season, { YUL: { '2026-10-05': 3, '2026-10-12': 0 } }), cover: { YUL: '2026-10-11' } };
    const next: DestSnapshot = { ...snap(season, { YUL: { '2026-10-05': 3, '2026-10-12': 3 } }), cover: { YUL: '2026-10-25' } };
    expect(diffSnapshots(prev, next, TODAY, 'YUL')).toEqual([]);
  });

  it('puts the selected hub first and names other hubs', () => {
    const prev = snap({ YUL: ['2026-09-01', '2027-03-31'], YYZ: ['2026-09-01', '2027-03-31'] });
    const next = snap({ YUL: ['2026-09-01', '2027-03-31'], YYZ: ['2026-09-01', '2026-11-02'] });
    const c = diffSnapshots(prev, next, TODAY, 'YUL');
    expect(changeLabel(c[0], TODAY, 'YUL')).toBe('Ends: last nonstop Nov 2 (from YYZ)');
  });

  it('works on live fixtures: a route added since the snapshot shows as new', () => {
    const before = snapshotFor('DEL', TODAY, ['YYZ', 'YUL']);
    setScheduleSource([...FIXTURE_ROUTES, route('YUL', 'DEL', rec('AC880', '20:00', '10:00', '2026-10-05', '2027-03-27', 'Mon,Fri', '789'))], FIXTURE_META);
    const c = diffSnapshots(before, snapshotFor('DEL', TODAY, ['YYZ', 'YUL']), TODAY, 'YUL');
    expect(c.map(x => x.kind)).toEqual(['new']);
    expect(changeLabel(c[0], TODAY, 'YUL')).toBe('New: nonstop from YUL from Oct 5');
  });

  it('is in French', () => {
    setLocale('fr');
    expect(changeLabel({ kind: 'ends', hub: 'YUL', last: '2026-10-28' }, TODAY, 'YUL')).toBe('Fin : dernier vol sans escale le 28 oct.');
  });
});
