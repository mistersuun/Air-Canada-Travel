import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEVILLE_PLACE } from '../trips/testing/seville-fixture';
import { toUtcMs, utcToLocal } from '../utils/time';
import { CORRIDORS } from './corridors';
import { airportEnd, arrivalAtGoal, groundEstimate, placeEnd } from './ground';
import { GROUND_FETCH, GroundTimetableService } from './ground-timetable.service';
import { FIXTURE_GROUND_FILE } from './testing/ground-fixture';
import {
  GroundTimetables, dayKind, decodeGround, departuresOn, groundTimetables, nextDeparture, setGroundTimetables, shortDate,
  timetableFor, typicalRide,
} from './timetable';

const fixture = () => decodeGround(structuredClone(FIXTURE_GROUND_FILE))!;
const MAD = airportEnd('MAD')!;
const TZ = 'Europe/Madrid';
const madOut = () => timetableFor(fixture(), 'MAD', 2510911, false)!;

afterEach(() => setGroundTimetables(null));

describe('decodeGround', () => {
  it('reads the fixture: sources, both directions, products and no-service dates', () => {
    const t = fixture();
    expect(t.license).toBe('ODbL-1.0');
    expect(t.sources['renfe']).toMatchObject({ name: 'Renfe', licence: 'CC BY 4.0' });
    const out = madOut();
    expect(out).toMatchObject({ op: 'Renfe', tz: TZ, validFrom: '2026-10-01', validTo: '2026-12-12' });
    expect(out.wk.map(d => d.depMin)).toEqual([420, 600, 960, 1265]);
    expect(out.wk[3]).toEqual({ depMin: 1265, rideMin: 170, product: 'ALVIA' });
    expect(out.noService.has('2026-10-12')).toBe(true);
    expect(out.note).toContain('Iryo');
    expect(timetableFor(t, 'MAD', 2510911, true)!.wk.length).toBe(2);
    expect(timetableFor(t, 'LIS', 2510911, false)).toBeNull();
  });

  it('is null for anything that is not a v1 file, and skips bad corridors', () => {
    expect(decodeGround(null)).toBeNull();
    expect(decodeGround('x')).toBeNull();
    expect(decodeGround({ v: 2, corridors: {} })).toBeNull();
    const raw = structuredClone(FIXTURE_GROUND_FILE) as Record<string, any>;
    raw['corridors']['BAD'] = { mode: 'train', out: raw['corridors']['MAD-2510911'].out };
    raw['corridors']['LIS-1'] = { mode: 'plane', out: raw['corridors']['MAD-2510911'].out };
    raw['corridors']['BCN-2'] = { mode: 'train', out: { ...raw['corridors']['MAD-2510911'].out, wk: [[2000, 10, 0]] } };
    raw['corridors']['BCN-3'] = { mode: 'train', out: { ...raw['corridors']['MAD-2510911'].out, validTo: '2026-09-01' } };
    raw['corridors']['BCN-4'] = { mode: 'train', out: { ...raw['corridors']['MAD-2510911'].out, wk: [[600, 10, 5]] } };
    raw['corridors']['BCN-5'] = { mode: 'train', out: { ...raw['corridors']['MAD-2510911'].out, tz: 'Europe/Nowhere' } };
    expect([...decodeGround(raw)!.corridors.keys()]).toEqual(['MAD-2510911']);
  });
});

describe('timetable lookups', () => {
  it('picks weekday, Saturday or Sunday by the local date', () => {
    expect(['2026-10-09', '2026-10-10', '2026-10-11'].map(dayKind)).toEqual(['wk', 'sat', 'sun']);
    const out = madOut();
    expect(departuresOn(out, '2026-10-09')!.length).toBe(4);
    expect(departuresOn(out, '2026-10-10')!.map(d => d.depMin)).toEqual([480]);
    expect(departuresOn(out, '2026-10-11')).toEqual([]);
    expect(departuresOn(out, '2026-10-12')).toEqual([]); // a no-service Monday
  });

  it('is null outside the valid dates, both ends inclusive', () => {
    const out = madOut();
    expect(departuresOn(out, '2026-09-30')).toBeNull();
    expect(departuresOn(out, '2026-10-01')!.length).toBe(4);
    expect(departuresOn(out, '2026-12-11')!.length).toBe(4);
    expect(departuresOn(out, '2026-12-12')!.length).toBe(1); // a Saturday
    expect(departuresOn(out, '2026-12-13')).toBeNull();
  });

  it('finds the next departure the same day, else the next running day, else null past validTo', () => {
    const out = madOut();
    expect(nextDeparture(out, '2026-10-09', 8 * 60 + 20)).toMatchObject({ dateKey: '2026-10-09', hhmm: '10:00', sameDay: true });
    expect(nextDeparture(out, '2026-10-09', 600)!.hhmm).toBe('10:00');
    expect(nextDeparture(out, '2026-10-09', 21 * 60 + 30)).toMatchObject({ dateKey: '2026-10-10', hhmm: '08:00', sameDay: false });
    // Saturday evening: nothing on Sunday, none on Monday Oct 12 either → Tuesday 07:00.
    expect(nextDeparture(out, '2026-10-10', 20 * 60)).toMatchObject({ dateKey: '2026-10-13', hhmm: '07:00' });
    expect(nextDeparture(out, '2026-12-12', 20 * 60)).toBeNull();
  });

  it('typical ride and short dates', () => {
    expect(typicalRide(madOut().wk)).toBe(159);
    expect(shortDate('2026-12-20')).toBe('Dec 20');
  });
});

describe('groundEstimate with a timetable', () => {
  it('keeps the Estimated corridor row until the timetables load', () => {
    expect(groundTimetables()).toBeNull();
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' });
    expect(g).toMatchObject({ source: 'corridor', provenance: 'estimated', label: 'Train about 2h40' });
    expect(g.timetable).toBeUndefined();
  });

  it('a covered weekday is Scheduled: real ride, trips that day, first and last; exit stays the same', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' });
    expect(g).toMatchObject({
      mode: 'train', source: 'timetable', provenance: 'scheduled', label: 'Train 2h39', rideMin: 159, exitMin: 90,
      totalMin: 249, lastDepLocal: '21:05', exitLabel: 'Passport, exit, get to Atocha',
      frequency: '4 Renfe trains on weekdays, 07:00 to 21:05',
    });
    expect(g.timetable).toMatchObject({ state: 'ok', operator: 'Renfe', validTo: '2026-12-12', rideText: '2h39' });
  });

  it('one departure says "at", and a wide spread of rides is a range', () => {
    const raw = structuredClone(FIXTURE_GROUND_FILE);
    raw.corridors['MAD-2510911'].out.wk = [[420, 159, 0], [600, 230, 0]];
    setGroundTimetables(decodeGround(raw));
    expect(groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' }).label).toBe('Train 2h39 to 3h50');
    expect(groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-10' }).frequency).toBe('1 Renfe train on Saturdays, at 08:00');
  });

  it('a day with nothing running stays Estimated and says so', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-11' });
    expect(g).toMatchObject({ source: 'corridor', provenance: 'estimated', label: 'Train about 2h40' });
    expect(g.timetable?.state).toBe('empty');
  });

  it('after validTo it is the Estimated row, flagged as ended', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-12-20' });
    expect(g).toMatchObject({ source: 'corridor', provenance: 'estimated', frequency: 'trains roughly hourly' });
    expect(g.timetable?.state).toBe('ended');
    expect(groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-09-20' }).timetable?.state).toBe('notYet');
  });

  it('towards the airport uses the back direction, with no last departure', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(placeEnd(SEVILLE_PLACE), MAD, { dateKey: '2026-10-09' });
    expect(g).toMatchObject({ provenance: 'scheduled', label: 'Train 2h40', lastDepLocal: null, frequency: '2 Renfe trains on weekdays, 06:05 to 18:00' });
  });

  it('corridors without a timetable are unchanged', () => {
    setGroundTimetables(fixture());
    expect(groundEstimate(airportEnd('LIS')!, SEVILLE_PLACE, { dateKey: '2026-10-09' })).toMatchObject({ source: 'corridor', provenance: 'estimated' });
  });
});

describe('arrivalAtGoal with a timetable', () => {
  const land = (key: string, hhmm: string) => toUtcMs(key, hhmm, TZ);
  const local = (utc: number | null) => utcToLocal(utc!, TZ);

  it('takes the first train after the airport exit, with that train\'s ride', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' });
    const r = arrivalAtGoal(land('2026-10-09', '06:50'), g, TZ); // out 08:20
    expect(r.departure).toEqual({ dateKey: '2026-10-09', hhmm: '10:00', rideMin: 160, sameDay: true });
    expect(local(r.utc)).toEqual({ dateKey: '2026-10-09', hhmm: '12:40' });
    expect(r).toMatchObject({ overnightLikely: false, lastDepMissed: false });
  });

  it('the last train uses its own (slower) ride', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' });
    const r = arrivalAtGoal(land('2026-10-09', '19:00'), g, TZ); // out 20:30 → 21:05 ALVIA
    expect(r.departure?.hhmm).toBe('21:05');
    expect(local(r.utc)).toEqual({ dateKey: '2026-10-09', hhmm: '23:55' });
    expect(r.overnightLikely).toBe(true); // arrives after 23:30
  });

  it('missing the last train means the first one next morning, not an 08:00 guess', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' });
    const r = arrivalAtGoal(land('2026-10-09', '21:00'), g, TZ); // out 22:30
    expect(r).toMatchObject({ lastDepMissed: true, overnightLikely: true });
    expect(r.departure).toMatchObject({ dateKey: '2026-10-10', hhmm: '08:00', sameDay: false });
    expect(local(r.utc)).toEqual({ dateKey: '2026-10-10', hhmm: '10:48' });
  });

  it('a no-service day is not a missed last train, but a night on the way', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-11' });
    const r = arrivalAtGoal(land('2026-10-11', '09:00'), g, TZ);
    expect(r).toMatchObject({ lastDepMissed: false, overnightLikely: true });
    expect(r.departure).toMatchObject({ dateKey: '2026-10-13', hhmm: '07:00' });
  });

  it('out of the airport in the small hours waits for the morning train', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' });
    const r = arrivalAtGoal(land('2026-10-09', '01:00'), g, TZ);
    // Out at 02:30: the previous evening's last train (Thu 21:05) is gone, as the estimate path says.
    expect(r).toMatchObject({ lastDepMissed: true, overnightLikely: true });
    expect(r.departure?.hhmm).toBe('07:00');
  });

  it('landing late and out after midnight missed the previous evening\'s last train', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-08' });
    const r = arrivalAtGoal(land('2026-10-08', '23:00'), g, TZ); // out 00:30 Fri
    expect(r).toMatchObject({ lastDepMissed: true, overnightLikely: true });
    expect(r.departure).toMatchObject({ dateKey: '2026-10-09', hhmm: '07:00', sameDay: true });
  });

  it('days covered but with nothing running: arrival unknown, not an 08:00 guess', () => {
    const raw = structuredClone(FIXTURE_GROUND_FILE) as Record<string, any>;
    const out = raw['corridors']['MAD-2510911'].out;
    out.x = [...(out.x ?? []), '2026-10-13'];
    setGroundTimetables(decodeGround(raw));
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-10' });
    const r = arrivalAtGoal(land('2026-10-10', '20:00'), g, TZ); // Sat after 08:00; Sun, Mon, Tue no trains
    expect(r).toMatchObject({ utc: null, departure: null, noService: true, overnightLikely: true, lastDepMissed: true });
    expect(nextDeparture(timetableFor(groundTimetables(), 'MAD', 2510911, false)!, '2026-10-10', 20 * 60)).toBe('none');
  });

  it('past the timetable it falls back to the estimate', () => {
    setGroundTimetables(fixture());
    const g = groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-12-20' });
    const r = arrivalAtGoal(land('2026-12-20', '06:50'), g, TZ);
    expect(r.departure).toBeNull();
    expect(local(r.utc)).toEqual({ dateKey: '2026-12-20', hhmm: '11:00' }); // 06:50 + 1h30 + 2h40
  });
});

describe('GroundTimetableService', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(fetcher: () => Promise<unknown>): GroundTimetableService {
    TestBed.configureTestingModule({ providers: [{ provide: GROUND_FETCH, useValue: fetcher }] });
    return TestBed.inject(GroundTimetableService);
  }

  it('loads once and publishes the timetables to groundEstimate', async () => {
    const fetcher = vi.fn(async () => structuredClone(FIXTURE_GROUND_FILE));
    const s = setup(fetcher);
    await Promise.all([s.ensureLoaded(), s.ensureLoaded()]);
    await s.ensureLoaded();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('ready');
    expect(s.timetables()?.corridors.size).toBe(1);
    expect(groundEstimate(MAD, SEVILLE_PLACE, { dateKey: '2026-10-09' }).provenance).toBe('scheduled');
  });

  it('a missing or broken file is final and keeps the estimates', async () => {
    const s = setup(async () => ({ v: 9 }));
    await s.ensureLoaded();
    expect(s.status()).toBe('missing');
    expect(groundTimetables()).toBeNull();
  });

  it('offline goes back to idle and tries again later', async () => {
    let n = 0;
    const s = setup(async () => {
      if (n++ === 0) throw new Error('offline');
      return structuredClone(FIXTURE_GROUND_FILE);
    });
    await s.ensureLoaded();
    expect(s.status()).toBe('idle');
    await s.ensureLoaded();
    expect(s.status()).toBe('ready');
  });

  it('the real fetcher treats a service worker 504 as offline (retry), a 404 as missing', async () => {
    TestBed.configureTestingModule({});
    const fetchFn = vi.fn(async () => new Response('', { status: 504 }));
    vi.stubGlobal('fetch', fetchFn);
    try {
      const s = TestBed.inject(GroundTimetableService);
      await s.ensureLoaded();
      expect(s.status()).toBe('idle');
      fetchFn.mockImplementation(async () => new Response(JSON.stringify(FIXTURE_GROUND_FILE), { status: 200 }));
      await s.ensureLoaded();
      expect(s.status()).toBe('ready');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      fetchFn.mockImplementation(async () => new Response('', { status: 404 }));
      const s2 = TestBed.inject(GroundTimetableService);
      await s2.ensureLoaded();
      expect(s2.status()).toBe('missing');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const PATH = resolve(process.cwd(), 'public/data/ground.json');
const present = existsSync(PATH);

describe.skipIf(!present)('public/data/ground.json', () => {
  const raw = present ? readFileSync(PATH) : Buffer.from('');
  const t: GroundTimetables | null = present ? decodeGround(JSON.parse(raw.toString('utf8'))) : null;

  it('decodes in full, is small, ODbL, and every source is credited', () => {
    const file = JSON.parse(raw.toString('utf8'));
    expect(raw.length).toBeLessThanOrEqual(150_000);
    expect(t).not.toBeNull();
    expect(t!.license).toBe('ODbL-1.0');
    expect(t!.corridors.size).toBe(Object.keys(file.corridors).length);
    for (const [key, c] of t!.corridors) {
      for (const dir of [c.out, c.back]) {
        if (!dir) continue;
        expect(t!.sources[dir.src], `${key} source`).toBeDefined();
        expect(dir.op).not.toBe('');
      }
    }
    for (const s of Object.values(t!.sources)) {
      expect(s.licence).not.toBe('');
      expect(s.credit).not.toBe('');
    }
  });

  it('every key joins a corridor row', () => {
    const keys = new Set(CORRIDORS.map(c => `${c.code}-${c.geonameId}`));
    for (const key of t!.corridors.keys()) expect(keys.has(key), key).toBe(true);
  });
});
