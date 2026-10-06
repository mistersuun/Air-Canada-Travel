import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import type { Outcome, OutcomeKind } from '../trips/model';
import { decodeClimate } from './climate';
import {
  RecInput, dayItineraries, holidayRecs, pairable, holidayGroupAside, holidayGroupTitle, logRecs, onwardRecs, recommend, seasonEndingRecs,
  scheduleLine, seasonWindow, shortDuration, styleRecs, whyText,
} from './engine';
import { longWeekends } from './long-weekends';
import type { RecGroup, Recommendation, TravelProfile } from './model';
import { EMPTY_PROFILE } from './profile';
import { CLIMATE_FIXTURE } from './testing/climate-fixture';
import { RECS_META, RECS_NOW, RECS_PROFILE, RECS_ROUTES, RECS_TODAY } from './testing/recs-fixture';

function outcome(i: number, dest: string, kind: OutcomeKind, origin = 'YUL'): Outcome {
  return {
    id: `o${i}`, flightNumber: 'AC812', origin, dest, dateKey: `2026-09-0${i + 1}`, kind,
    partySize: 2, tripId: null, note: '', recordedAt: '2026-09-10T00:00:00Z',
  };
}

function input(over: Partial<RecInput> = {}): RecInput {
  return {
    profile: RECS_PROFILE, hub: 'YUL', todayKey: RECS_TODAY, nowMs: RECS_NOW,
    favourites: [], outcomes: [], activeGoalCodes: [],
    climate: decodeClimate(CLIMATE_FIXTURE), showConnections: true, connect: {}, context: 'explore', fmt: '24h',
    ...over,
  };
}

const allRecs = (groups: RecGroup[]): Recommendation[] => groups.flatMap(g => g.items);
const texts = (lines: Recommendation['lines']) => lines.map(l => l.text);

beforeEach(() => setScheduleSource(RECS_ROUTES, RECS_META));
afterEach(() => resetScheduleSource());

describe('dayItineraries: departed flights', () => {
  it('drops flights already gone today, keeps all on other days', () => {
    const all = dayItineraries(input(), 'YUL', 'FLL', '2026-10-09');
    expect(all.length).toBeGreaterThan(1);
    const cut = all[0].departUtc;
    const today = input({ todayKey: '2026-10-08', nowMs: cut });
    expect(dayItineraries(today, 'YUL', 'FLL', '2026-10-09').map(i => i.departUtc)).toEqual(
      all.map(i => i.departUtc).filter(u => u > cut),
    );
    expect(dayItineraries(input({ todayKey: '2026-10-09', nowMs: cut }), 'YUL', 'FLL', '2026-10-09', true)).toHaveLength(all.length);
    expect(dayItineraries(input({ nowMs: cut - 1 }), 'YUL', 'FLL', '2026-10-09')).toHaveLength(all.length);
  });
});

describe('holiday out day with all flights gone', () => {
  it('falls back to the next acceptable out day, with title and aside to match', () => {
    const lw = longWeekends('2026-10-01', 60, 'YUL')[0];
    const day1 = dayItineraries(input(), 'YUL', 'FLL', '2026-10-09');
    const lastUtc = Math.max(...['LGA', 'FLL'].flatMap(c => dayItineraries(input(), 'YUL', c, '2026-10-09').map(i => i.departUtc)), ...day1.map(i => i.departUtc));
    const late = input({ todayKey: '2026-10-09', nowMs: lastUtc });
    const rec = holidayRecs(late, lw);
    expect(rec.length).toBeGreaterThan(0);
    expect(rec[0].out?.dateKey).toBe('2026-10-10');
    const g = recommend(late).find(x => x.id === lw.id)!;
    expect(g.aside).toBe(holidayGroupAside('2026-10-10', '2026-10-12'));
  });
});

describe('recommend: Thanksgiving 2026 (real schedule rows, see recs-fixture)', () => {
  it('opens with the Thanksgiving long weekend: LGA by counts, FLL by times', () => {
    const groups = recommend(input());
    const g = groups[0];
    expect(g.id).toBe('lw:2026-10-12');
    expect(g.title).toBe('Thanksgiving long weekend in 8 days');
    expect(g.aside).toBe('Fri Oct 9 → Mon Oct 12');
    expect(g.items.map(r => r.code)).toEqual(['LGA', 'FLL']);

    const [lga, fll] = g.items;
    expect(lga.lines).toEqual([
      { text: '6 flights out Fri · 6 back Mon', label: 'scheduled' },
      { text: 'About 1h30 each way', label: null },
    ]);
    expect(fll.lines).toEqual([
      { text: 'Out Fri 08:10, 18:05', label: 'scheduled' },
      { text: 'Back Mon 12:40, 20:55', label: 'scheduled' },
    ]);
    expect(fll.out!.flights.map(f => f.flightNumber)).toEqual(['AC1602', 'AC1606']);
    expect(fll.back!.flights.map(f => f.flightNumber)).toEqual(['AC1605', 'AC1611']);
    expect(fll.weather).toMatchObject({ month: 10, tmaxC: 30, tminC: 23 });
    expect(fll.link).toEqual({ path: ['/flight', 'FLL', '2026-10-09'], query: {} });
    expect(fll.id).toBe('holiday:FLL:2026-10-09');
    for (const r of g.items) {
      expect(whyText(r)).toBe('Holiday Monday. You travel Thu to Mon, like City and Sun, flights under 7h.');
    }
  });

  it('formats times in 12h when asked', () => {
    const fll = recommend(input({ fmt: '12h' }))[0].items[1];
    expect(fll.lines[0].text).toMatch(/^Out Fri 8:10\sAM, 6:05\sPM$/);
  });

  it('says "tomorrow" and "today" in the group title', () => {
    expect(holidayGroupTitle('Thanksgiving', '2026-10-08', '2026-10-09')).toBe('Thanksgiving long weekend tomorrow');
    expect(holidayGroupTitle('Thanksgiving', '2026-10-09', '2026-10-09')).toBe('Thanksgiving long weekend today');
    expect(holidayGroupAside('2026-10-09', '2026-10-12')).toBe('Fri Oct 9 → Mon Oct 12');
  });

  it('uses the holiday name for day trips', () => {
    const [lw] = longWeekends(RECS_TODAY, 60, 'YUL');
    const g = recommend(input({ profile: { ...RECS_PROFILE, length: 'day' } }))[0];
    expect(g.aside).toBe('Mon Oct 12 → Mon Oct 12');
    expect(lw.name).toBe('Thanksgiving');
    expect(g.items[0].reason[0]).toEqual({ kind: 'holiday', text: 'Thanksgiving' });
  });

  it('season ends soon for a starred Porto: last AC928 Fri Oct 23, last home AC929 Sat Oct 24, back Jun 1, 2027', () => {
    const groups = recommend(input({ favourites: ['OPO'] }));
    const season = groups.find(g => g.id === 'season')!;
    expect(season.title).toBe('Season ends soon');
    const [opo] = season.items;
    expect(opo.code).toBe('OPO');
    expect(opo.title).toBe('Porto');
    expect(texts(opo.lines)).toEqual([
      'Last flight there AC928 Fri Oct 23 · last home AC929 Sat Oct 24',
      'Back from Jun 1, 2027',
    ]);
    expect(opo.lines.every(l => l.label === 'scheduled')).toBe(true);
    expect(whyText(opo)).toBe('You starred Porto.');
    expect(opo.link.path).toEqual(['/to', 'OPO']);
  });

  it('season window: the current run of filings and the restart after the break', () => {
    expect(seasonWindow('YUL', 'OPO', RECS_TODAY)).toEqual({ last: '2026-10-23', resume: '2027-06-01' });
    expect(seasonWindow('YUL', 'OPO', '2026-11-15')).toBeNull();
  });

  it('a starred route that flies on past 45 days is not ending', () => {
    expect(seasonEndingRecs(input({ favourites: ['LGA', 'FLL'] }))).toEqual([]);
  });
});

describe('your own log', () => {
  it('3 allBoarded YUL→LIS → "You boarded 3 of 3 tries", Saved by you', () => {
    const outcomes = [0, 1, 2].map(i => outcome(i, 'LIS', 'allBoarded'));
    const [lis] = logRecs(input({ outcomes }));
    expect(lis.kind).toBe('yourLog');
    expect(lis.lines).toContainEqual({ text: 'You boarded 3 of 3 tries', label: 'saved' });
    expect(lis.lines[0]).toEqual({ text: 'AC812 21:45 most evenings · about 6h35', label: 'scheduled' });
    expect(whyText(lis)).toBe("Your own outcome log, and it's a City trip under 7h.");
  });

  it('1 boarded and 2 not boarded → nothing; didntTry is not a try; other hubs ignored', () => {
    expect(logRecs(input({ outcomes: [outcome(0, 'LIS', 'allBoarded'), outcome(1, 'LIS', 'noneBoarded'), outcome(2, 'LIS', 'noneBoarded')] }))).toEqual([]);
    const mixed = [outcome(0, 'LIS', 'someBoarded'), outcome(1, 'LIS', 'allBoarded'), outcome(2, 'LIS', 'didntTry'), outcome(3, 'LIS', 'noneBoarded')];
    expect(texts(logRecs(input({ outcomes: mixed }))[0].lines)).toContain('You boarded 2 of 3 tries');
    expect(logRecs(input({ outcomes: [0, 1, 2].map(i => outcome(i, 'LIS', 'allBoarded', 'YYZ')) }))).toEqual([]);
  });
});

describe('filters', () => {
  it('maxFlightHours 5 drops flights over 5h', () => {
    const p: TravelProfile = { ...RECS_PROFILE, maxFlightHours: 5 };
    const codes = allRecs(recommend(input({ profile: p }))).map(r => r.code);
    expect(codes).not.toContain('LIS');
    expect(codes).not.toContain('CDG');
    expect(dayItineraries(input({ profile: p }), 'YUL', 'LIS', '2026-10-09')).toEqual([]);
    expect(dayItineraries(input({ profile: p }), 'YUL', 'FLL', '2026-10-09')).toHaveLength(2);
  });

  it('style: Sun only keeps Sun places', () => {
    const p: TravelProfile = { ...RECS_PROFILE, styles: ['Sun'] };
    const recs = allRecs(recommend(input({ profile: p }))).filter(r => r.kind !== 'yourLog' && r.kind !== 'seasonEnding');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(r => ['FLL', 'CUN'].includes(r.code!))).toBe(true);
    const style = styleRecs(input({ profile: p }), new Set());
    expect(style.map(r => r.code).sort()).toEqual(['CUN', 'FLL']);
    expect(whyText(style.find(r => r.code === 'CUN')!)).toBe('Matches Sun, under 7h.');
  });

  it('dismissed ids are dropped', () => {
    const p: TravelProfile = { ...RECS_PROFILE, dismissed: ['holiday:LGA:2026-10-09'] };
    const g = recommend(input({ profile: p }))[0];
    expect(g.items.map(r => r.code)).not.toContain('LGA');
    expect(g.items.map(r => r.code)).toContain('FLL');
  });

  it('an empty profile gives only holiday and seasonEnding kinds, up to 7h, every day', () => {
    const outcomes = [0, 1, 2].map(i => outcome(i, 'LIS', 'allBoarded'));
    for (const context of ['explore', 'trips'] as const) {
      const recs = allRecs(recommend(input({ profile: EMPTY_PROFILE, favourites: ['OPO'], outcomes, context })));
      expect(recs.length).toBeGreaterThan(0);
      expect(recs.every(r => r.kind === 'holiday' || r.kind === 'seasonEnding')).toBe(true);
    }
    const holiday = allRecs(recommend(input({ profile: EMPTY_PROFILE }))).filter(r => r.kind === 'holiday');
    expect(holiday.every(r => whyText(r) === 'Holiday Monday.')).toBe(true);
  });

  it('one-stops only when connections are on and the day has no nonstop', () => {
    expect(dayItineraries(input({ showConnections: false }), 'YUL', 'XXX', '2026-10-09')).toEqual([]);
    // FLL has nonstops on Oct 9: no connection rows even with connections on.
    expect(dayItineraries(input(), 'YUL', 'FLL', '2026-10-09').every(it => it.legs.length === 1)).toBe(true);
    // Outside coverage nothing counts.
    expect(dayItineraries(input(), 'YUL', 'FLL', '2028-01-07')).toEqual([]);
  });
});

describe('onward (P2)', () => {
  it('suggests one city past a gateway with Any, and nothing with Low', () => {
    const [r] = onwardRecs(input(), new Set());
    expect(r.kind).toBe('onward');
    expect(r.placeId).toMatch(/^gn-\d+$/);
    expect(r.lines[0].label).toBe('estimated');
    expect(r.link.path[0]).toBe('/reach');
    expect(r.link.query['dep']).toMatch(/^2026-10-/);
    expect(whyText(r)).toBe('Onward travel set to Any, City trip.');
    expect(onwardRecs(input({ profile: { ...RECS_PROFILE, onwardBudget: 'low' } }), new Set())).toEqual([]);
    expect(onwardRecs(input({ profile: { ...RECS_PROFILE, styles: ['Sun'] } }), new Set())).toEqual([]);
  });
});

describe('assembly', () => {
  it('explore: holiday, then season, then More for you; at most 7, no place twice', () => {
    const outcomes = [0, 1, 2].map(i => outcome(i, 'LIS', 'allBoarded'));
    const groups = recommend(input({ favourites: ['OPO'], outcomes }));
    expect(groups.map(g => g.id)).toEqual(['lw:2026-10-12', 'season', 'more']);
    const recs = allRecs(groups);
    expect(recs.length).toBeLessThanOrEqual(7);
    const keys = recs.map(r => r.code ?? r.placeId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groups[2].items[0].kind).toBe('yourLog');
  });

  it('trips: one "Ideas for later" group, log first, never an active trip goal', () => {
    const outcomes = [0, 1, 2].map(i => outcome(i, 'LIS', 'allBoarded'));
    const groups = recommend(input({ context: 'trips', outcomes }));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'ideas', title: 'Ideas for later', aside: null });
    expect(groups[0].items.length).toBeLessThanOrEqual(3);
    expect(groups[0].items[0].code).toBe('LIS');

    const excluded = recommend(input({ context: 'trips', outcomes, activeGoalCodes: ['LIS', 'LGA'] }));
    const codes = allRecs(excluded).map(r => r.code);
    expect(codes).not.toContain('LIS');
    expect(codes).not.toContain('LGA');
  });

  it('is deterministic', () => {
    const a = recommend(input({ favourites: ['OPO'] }));
    const b = recommend(input({ favourites: ['OPO'] }));
    expect(a).toEqual(b);
  });
});

describe('honesty', () => {
  const BANNED = [/%/, /chance/i, /likely/i, /odds/i, /guarantee/i, /available seat/i];
  const profiles: TravelProfile[] = [
    EMPTY_PROFILE,
    RECS_PROFILE,
    { ...RECS_PROFILE, styles: ['Sun'], party: 9, maxFlightHours: 12, days: [] },
    { ...RECS_PROFILE, styles: ['Adventure', 'City'], length: 'day', maxFlightHours: null, party: 1 },
    { ...RECS_PROFILE, length: 'week', onwardBudget: 'low', days: [6] },
  ];

  it('no rec string ever shows odds, percentages or seats, and rank is never rendered', () => {
    const outcomes = [0, 1, 2].map(i => outcome(i, 'LIS', 'allBoarded'));
    let seen = 0;
    for (const profile of profiles) {
      for (const context of ['explore', 'trips'] as const) {
        for (const fmt of ['24h', '12h'] as const) {
          const groups = recommend(input({ profile, context, fmt, favourites: ['OPO', 'LIS'], outcomes }));
          for (const g of groups) {
            const strings = [g.title, g.aside ?? '', ...g.items.flatMap(r => [r.title, whyText(r), ...r.lines.map(l => l.text), ...r.reason.map(x => x.text)])];
            for (const s of strings) for (const rx of BANNED) expect(s, s).not.toMatch(rx);
            for (const r of g.items) {
              seen++;
              expect(r.reason.length).toBeGreaterThan(0);
              expect(whyText(r)).not.toContain(String(r.rank));
              expect(r.lines.every(l => l.label === null || ['scheduled', 'estimated', 'saved', 'typical', 'unknown'].includes(l.label))).toBe(true);
            }
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('shortDuration rounds to 5 minutes', () => {
    expect(shortDuration(87)).toBe('1h25');
    expect(shortDuration(88)).toBe('1h30');
    expect(shortDuration(420)).toBe('7h');
    expect(shortDuration(42)).toBe('40min');
  });
});

describe('scheduleLine wording', () => {
  // Itineraries spread across the two weeks, so no "most evenings" line applies.
  const it1 = (day: number, legs: number) => ({
    dateKey: `2026-10-${String(day).padStart(2, '0')}`, totalMin: 475,
    legs: Array.from({ length: legs }, (_, i) => ({ flightNumber: `AC${100 + day * 10 + i}`, depLocal: '08:00' })),
  });
  type U = Parameters<typeof scheduleLine>[0];
  it('calls nonstops flights and connections one-stop options, never flights', () => {
    const non = { count: 2, its: [it1(2, 1), it1(9, 1)] } as unknown as U;
    const one = { count: 2, its: [it1(2, 2), it1(9, 2)] } as unknown as U;
    const mix = { count: 2, its: [it1(2, 1), it1(9, 2)] } as unknown as U;
    expect(scheduleLine(non, '2026-10-01')).toBe('2 flights in the next 2 weeks · about 7h55');
    expect(scheduleLine(one, '2026-10-01')).toBe('2 one-stop options in the next 2 weeks · about 7h55');
    expect(scheduleLine(mix, '2026-10-01')).toBe('2 options, some with a stop, in the next 2 weeks · about 7h55');
  });
});

describe('holiday recs never suggest the past, and pair out and back', () => {
  it('during the Thanksgiving weekend itself (Sun Oct 11) nothing departs before today', () => {
    const groups = recommend(input({ todayKey: '2026-10-11', nowMs: Date.parse('2026-10-11T12:00:00-04:00') }));
    for (const r of allRecs(groups)) if (r.out) expect(r.out.dateKey >= '2026-10-11').toBe(true);
    expect(groups.some(g => g.id === 'lw:2026-10-12')).toBe(false);
  });

  it('pairable drops returns that leave before the outbound lands (plus a 3h stay)', () => {
    const h = 3_600_000;
    const it = (dep: number, arr: number) => ({ departUtc: dep * h, arriveUtc: arr * h }) as never;
    const { out, back } = pairable([it(8, 10), it(14, 16)], [it(9, 11), it(13, 15), it(18, 20)]);
    expect(out.map((x: { departUtc: number }) => x.departUtc / h)).toEqual([8]);
    expect(back.map((x: { departUtc: number }) => x.departUtc / h)).toEqual([13, 18]);
    const none = pairable([it(12, 15)], [it(9, 11)]);
    expect(none.out).toEqual([]);
    expect(none.back).toEqual([]);
  });
});
