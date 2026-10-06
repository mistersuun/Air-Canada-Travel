import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_GROUND_FILE } from '../../places/testing/ground-fixture';
import { decodeGround, setGroundTimetables } from '../../places/timetable';
import type { FlightLeg, FlightRef, GroundLeg, Trip } from '../../trips/model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { markPast, travelTimeline } from './timeline-model';

const BEFORE = toUtcMs('2026-10-08', '12:00', 'America/Toronto');
const AFTER_DEP = toUtcMs('2026-10-08', '18:30', 'America/Toronto');

function leg(t: Trip, id: string = SEVILLE_IDS.outbound): FlightLeg {
  return t.legs.find(l => l.id === id) as FlightLeg;
}
function train(t: Trip): GroundLeg {
  return t.legs.find(l => l.id === SEVILLE_IDS.train) as GroundLeg;
}
const run = (t: Trip, l: FlightLeg, fmt: '24h' | '12h' = '24h', minConnect?: number) => travelTimeline({ trip: t, leg: l, fmt, minConnect });

describe('travelTimeline', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => { resetScheduleSource(); setGroundTimetables(null); });

  it('returns nothing for a missing or ground leg', () => {
    const t = sevilleTrip();
    expect(travelTimeline({ trip: t, leg: undefined, fmt: '24h' })).toEqual([]);
    expect(travelTimeline({ trip: t, leg: train(t), fmt: '24h' })).toEqual([]);
  });

  it('orders departure, arrival with the time difference, the trip\'s ground leg and the goal', () => {
    const t = sevilleTrip();
    const rows = run(t, leg(t));
    expect(rows.map(r => r.kind)).toEqual(['depart', 'arrive', 'ground', 'final']);
    expect(rows[0]).toMatchObject({ time: '17:55', title: 'AC834 departs Montréal (YUL)' });
    expect(rows[1].time).toBe('06:50');
    expect(rows[1].detail).toContain('Fri Oct 9');
    expect(rows[1].detail).toContain('+6h vs Montréal');
    expect(rows[2].title).toBe('Train Madrid → Seville');
    expect(rows[3].title).toBe('Reach Seville');
    expect(rows[3].detail).toContain('estimated');
  });

  it('uses the saved times of the trip\'s ground leg for the ride and the arrival', () => {
    const t = sevilleTrip();
    train(t).userTimes = { depDateKey: '2026-10-09', depLocal: '10:05', arrDateKey: '2026-10-09', arrLocal: '13:00' };
    const rows = run(t, leg(t));
    expect(rows[2]).toMatchObject({ kind: 'ground', time: '10:05' });
    expect(rows[2].detail).toContain('saved by you');
    expect(rows[3]).toMatchObject({ kind: 'final', time: '13:00', title: 'Reach Seville' });
    expect(rows[3].detail).toContain('saved by you');
  });

  it('lists the next two trains from the timetable and calls the arrival scheduled', () => {
    setGroundTimetables(decodeGround(structuredClone(FIXTURE_GROUND_FILE)));
    const t = sevilleTrip();
    const rows = run(t, leg(t));
    expect(rows.find(r => r.kind === 'ground')!.detail).toBe('next 10:00, 16:00');
    expect(rows.find(r => r.kind === 'final')!.detail).toContain('scheduled');
  });

  it('falls back to an estimate to the goal when the trip has no ground leg', () => {
    const t = sevilleTrip();
    t.legs = t.legs.filter(l => l.kind !== 'ground');
    const rows = run(t, leg(t));
    expect(rows.map(r => r.kind)).toEqual(['depart', 'arrive', 'ground', 'final']);
    expect(rows[2].title).toBe('Train Madrid → Seville');
  });

  it('says the last one is likely gone when landing after the usual last departure', () => {
    setGroundTimetables(decodeGround(structuredClone(FIXTURE_GROUND_FILE)));
    const t = sevilleTrip();
    const l = leg(t);
    l.refs[0] = { ...l.refs[0], arrLocal: '21:30', arrDateKey: '2026-10-09' } as FlightRef;
    const ground = run(t, l).find(r => r.kind === 'ground')!;
    expect(ground.detail).toContain('last one likely gone');
    expect(ground.detail).toContain('next Sat Oct 10 08:00');
  });

  it('uses the 12-hour clock when asked', () => {
    const t = sevilleTrip();
    expect(run(t, leg(t), '12h')[0].time).toBe('5:55 PM');
  });

  it('dims rows already behind the clock', () => {
    const t = sevilleTrip();
    const rows = markPast(run(t, leg(t)), AFTER_DEP);
    expect(rows.find(r => r.kind === 'depart')!.past).toBe(true);
    expect(rows.find(r => r.kind === 'arrive')!.past).toBe(false);
    expect(markPast(run(t, leg(t)), BEFORE).every(r => !r.past)).toBe(true);
  });

  it('dims the ground row by its train departure', () => {
    setGroundTimetables(decodeGround(structuredClone(FIXTURE_GROUND_FILE)));
    const t = sevilleTrip();
    const rows = run(t, leg(t));
    const at = toUtcMs('2026-10-09', '10:00', 'Europe/Madrid');
    expect(rows.find(r => r.kind === 'ground')!.atUtc).toBe(at);
    expect(markPast(rows, at + 60_000).find(r => r.kind === 'ground')!.past).toBe(true);
    expect(markPast(rows, at - 60_000).find(r => r.kind === 'ground')!.past).toBe(false);
  });

  describe('layovers', () => {
    function connection(depLocal: string): { t: Trip; l: FlightLeg } {
      const t = sevilleTrip();
      const l = leg(t);
      l.refs = [
        { flightNumber: 'AC421', origin: 'YUL', dest: 'YYZ', dateKey: '2026-10-08', depLocal: '17:30', arrLocal: '18:53', arrDateKey: '2026-10-08', aircraft: '223' },
        { flightNumber: 'AC824', origin: 'YYZ', dest: 'MAD', dateKey: '2026-10-08', depLocal, arrLocal: '08:50', arrDateKey: '2026-10-09', aircraft: '333' },
      ];
      return { t, l };
    }

    it('shows minutes and a tight-connection reason under the minimum', () => {
      const { t, l } = connection('19:15');
      const lay = run(t, l, '24h', 60).find(r => r.kind === 'layover')!;
      expect(lay).toMatchObject({ title: 'Layover at YYZ · 22m', detail: 'Tight connection', alert: true });
      expect(run(t, l, '24h', 20).find(r => r.kind === 'layover')).toMatchObject({ detail: null, alert: false });
    });

    it('flags a long wait', () => {
      const { t, l } = connection('23:59');
      l.refs[0] = { ...l.refs[0], depLocal: '14:00', arrLocal: '16:00' };
      expect(run(t, l).find(r => r.kind === 'layover')).toMatchObject({ detail: 'Long wait', alert: true });
    });

    it('says so when the next flight leaves before this one lands', () => {
      const { t, l } = connection('18:30');
      expect(run(t, l).find(r => r.kind === 'layover')).toMatchObject({
        title: 'Layover at YYZ', detail: 'Next flight leaves before this one lands', alert: true,
      });
    });
  });

  describe('return days', () => {
    const NOW = toUtcMs('2026-10-13', '09:00', 'Europe/Lisbon');

    it('ends with the home-by deadline and the time after landing', () => {
      const t = sevilleTrip();
      const rows = run(t, leg(t, SEVILLE_IDS.ret));
      expect(rows.map(r => r.kind)).toEqual(['depart', 'arrive', 'final']);
      expect(rows[2]).toMatchObject({ time: '22:00', title: 'Home by Tue Oct 13' });
      expect(rows[2].detail).toBe('YUL time · 8h10 after landing');
      expect(markPast(rows, NOW)[2].past).toBe(false);
    });

    it('does not say "after landing" when the flight lands elsewhere than home', () => {
      const t = sevilleTrip();
      const l = leg(t, SEVILLE_IDS.ret);
      l.refs[0] = { ...l.refs[0], dest: 'YYZ', arrLocal: '16:05' };
      expect(run(t, l)[2].detail).toBe('YUL time · landing at YYZ, 5h55 before your YUL deadline');
    });
  });

  describe('onward legs', () => {
    function onwardFlight(): FlightLeg {
      return {
        kind: 'flight', id: 'leg-next', role: 'onward', status: 'planned', statusAt: null, note: '', provenance: 'scheduled', alternates: [],
        refs: [{ flightNumber: 'AC825', origin: 'MAD', dest: 'YYZ', dateKey: '2026-10-09', depLocal: '13:30', arrLocal: '16:05', arrDateKey: '2026-10-09', aircraft: '333' }],
      };
    }

    it('ends with the next flight, not the goal, when another flight comes before the ride', () => {
      const t = sevilleTrip();
      t.legs.splice(1, 0, onwardFlight());
      const rows = run(t, leg(t));
      expect(rows.map(r => r.kind)).toEqual(['depart', 'arrive', 'next']);
      expect(rows[2]).toMatchObject({ time: '13:30', title: 'Next: AC825 MAD → YYZ' });
    });

    it('ends a positioning leg with the next flight, or nothing', () => {
      const t = sevilleTrip();
      leg(t).role = 'positioning';
      expect(run(t, leg(t)).map(r => r.kind)).toEqual(['depart', 'arrive']);
      t.legs.splice(1, 0, onwardFlight());
      expect(run(t, leg(t)).map(r => r.kind)).toEqual(['depart', 'arrive', 'next']);
    });

    it('shows the ride then the next flight when a flight follows the ride', () => {
      const t = sevilleTrip();
      t.legs.splice(2, 0, onwardFlight());
      expect(run(t, leg(t)).map(r => r.kind)).toEqual(['depart', 'arrive', 'ground', 'next']);
    });
  });

  it('ends with an onward-not-found row when the ride is unknown', () => {
    const t = sevilleTrip();
    t.legs = t.legs.filter(l => l.kind !== 'ground');
    t.goal = { ...t.goal, id: 'gn-5856195', iso2: 'US', lat: 21.3, lng: -157.85, tz: 'Pacific/Honolulu' };
    const rows = run(t, leg(t));
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'final', title: 'Onward to Seville' });
  });
});
