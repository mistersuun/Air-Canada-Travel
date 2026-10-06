import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_GROUND_FILE } from '../../places/testing/ground-fixture';
import { decodeGround, setGroundTimetables } from '../../places/timetable';
import type { PrepItem } from '../../places/prep';
import type { FlightLeg, FlightRef } from '../../trips/model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { travelTimeline } from './timeline-model';

const BEFORE = toUtcMs('2026-10-08', '12:00', 'America/Toronto');
const AFTER_DEP = toUtcMs('2026-10-08', '18:30', 'America/Toronto');

const TODO: PrepItem = { id: 'checkin:leg-out834', title: 'Check in', detail: 'Opens 24h before', link: null, critical: true, source: 'legStatus', done: false };

function leg(t = sevilleTrip(), id: string = SEVILLE_IDS.outbound): FlightLeg {
  return t.legs.find(l => l.id === id) as FlightLeg;
}

describe('travelTimeline', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => { resetScheduleSource(); setGroundTimetables(null); });

  it('returns nothing for a missing or ground leg', () => {
    const t = sevilleTrip();
    expect(travelTimeline({ trip: t, leg: undefined, left: [], nowMs: BEFORE, fmt: '24h' })).toEqual([]);
    expect(travelTimeline({ trip: t, leg: leg(t, SEVILLE_IDS.train), left: [], nowMs: BEFORE, fmt: '24h' })).toEqual([]);
  });

  it('orders to-dos, departure, arrival with the time difference, ground and the goal', () => {
    const t = sevilleTrip();
    const rows = travelTimeline({ trip: t, leg: leg(t), left: [TODO], nowMs: BEFORE, fmt: '24h' });
    expect(rows.map(r => r.kind)).toEqual(['prep', 'depart', 'arrive', 'ground', 'final']);
    expect(rows[0]).toMatchObject({ title: 'Check in', time: null, past: false });
    expect(rows[1]).toMatchObject({ time: '17:55', title: 'AC834 departs Montréal (YUL)' });
    expect(rows[2].time).toBe('06:50');
    expect(rows[2].detail).toContain('Fri Oct 9');
    expect(rows[2].detail).toContain('+6h vs Montréal');
    expect(rows[3].title).toBe('Train Madrid → Seville');
    expect(rows[4].title).toBe('Reach Seville');
    expect(rows.every(r => !r.past)).toBe(true);
  });

  it('lists the next two trains from the timetable once the traveller is out of the airport', () => {
    setGroundTimetables(decodeGround(structuredClone(FIXTURE_GROUND_FILE)));
    const t = sevilleTrip();
    const ground = travelTimeline({ trip: t, leg: leg(t), left: [], nowMs: BEFORE, fmt: '24h' }).find(r => r.kind === 'ground')!;
    expect(ground.detail).toBe('next 10:00, 16:00');
  });

  it('says the last one is likely gone when landing after the usual last departure', () => {
    setGroundTimetables(decodeGround(structuredClone(FIXTURE_GROUND_FILE)));
    const t = sevilleTrip();
    const l = leg(t);
    l.refs[0] = { ...l.refs[0], arrLocal: '21:30', arrDateKey: '2026-10-09' } as FlightRef;
    const ground = travelTimeline({ trip: t, leg: l, left: [], nowMs: BEFORE, fmt: '24h' }).find(r => r.kind === 'ground')!;
    expect(ground.detail).toContain('last one likely gone');
    expect(ground.detail).toContain('next Sat Oct 10 08:00');
  });

  it('uses the 12-hour clock when asked', () => {
    const t = sevilleTrip();
    const rows = travelTimeline({ trip: t, leg: leg(t), left: [], nowMs: BEFORE, fmt: '12h' });
    expect(rows.find(r => r.kind === 'depart')!.time).toBe('5:55 PM');
  });

  it('dims rows already behind the clock', () => {
    const t = sevilleTrip();
    const rows = travelTimeline({ trip: t, leg: leg(t), left: [TODO], nowMs: AFTER_DEP, fmt: '24h' });
    expect(rows.find(r => r.kind === 'depart')!.past).toBe(true);
    expect(rows.find(r => r.kind === 'arrive')!.past).toBe(false);
    expect(rows[0].past).toBe(false); // to-dos have no time
  });

  it('shows the layover minutes between segments and flags one under the minimum', () => {
    const t = sevilleTrip();
    const l = leg(t);
    l.refs = [
      { flightNumber: 'AC421', origin: 'YUL', dest: 'YYZ', dateKey: '2026-10-08', depLocal: '17:30', arrLocal: '18:53', arrDateKey: '2026-10-08', aircraft: '223' },
      { flightNumber: 'AC824', origin: 'YYZ', dest: 'MAD', dateKey: '2026-10-08', depLocal: '19:15', arrLocal: '08:50', arrDateKey: '2026-10-09', aircraft: '333' },
    ];
    const rows = travelTimeline({ trip: t, leg: l, left: [], nowMs: BEFORE, fmt: '24h', minConnect: 60 });
    const lay = rows.find(r => r.kind === 'layover')!;
    expect(lay.title).toBe('Layover at YYZ · 22m');
    expect(lay.tight).toBe(true);
    expect(lay.detail).toContain('60 min');
    const roomy = travelTimeline({ trip: t, leg: l, left: [], nowMs: BEFORE, fmt: '24h', minConnect: 20 });
    expect(roomy.find(r => r.kind === 'layover')!.tight).toBe(false);
    expect(roomy.filter(r => r.kind === 'depart')).toHaveLength(2);
  });

  it('ends a return day with the home-by deadline and the time to spare', () => {
    const t = sevilleTrip();
    const rows = travelTimeline({ trip: t, leg: leg(t, SEVILLE_IDS.ret), left: [], nowMs: toUtcMs('2026-10-13', '09:00', 'Europe/Lisbon'), fmt: '24h' });
    expect(rows.map(r => r.kind)).toEqual(['depart', 'arrive', 'final']);
    expect(rows[2]).toMatchObject({ time: '22:00', title: 'Home by Tue Oct 13' });
    expect(rows[2].detail).toBe('YUL time · 8h10 after landing');
  });

  it('falls back to an onward-not-found row when the ride is unknown', () => {
    const t = sevilleTrip();
    t.goal = { ...t.goal, id: 'gn-5856195', iso2: 'US', lat: 21.3, lng: -157.85, tz: 'Pacific/Honolulu' };
    const rows = travelTimeline({ trip: t, leg: leg(t), left: [], nowMs: BEFORE, fmt: '24h' });
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'final', title: 'Onward to Seville' });
  });
});
