import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';
import { FlightLeg, GroundLeg } from '../../trips/model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../../trips/testing/seville-fixture';
import { toUtcMs } from '../../utils/time';
import { FIXTURE_GROUND_FILE } from '../../places/testing/ground-fixture';
import { decodeGround, setGroundTimetables } from '../../places/timetable';
import {
  groundRide,
  compactSummary, countdown, deadlineNote, groundLabel, homeLabel, legRows, needsReturn, offlineAirports, offlineAirportsLabel,
  offlineUntil, partyLabel, returnNotListed, savedAtLabel, sharedLabel, tripDatesLabel, tripSubtitle,
} from './trips-model';

const yul = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');
const NOW = yul('2026-10-01', '09:41');

describe('trips-model', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('labels the dates, the party and home', () => {
    const t = sevilleTrip();
    expect(tripDatesLabel(t)).toBe('Thu Oct 8 → home by Tue Oct 13, 22:00');
    expect(tripDatesLabel(t, '12h')).toBe('Thu Oct 8 → home by Tue Oct 13, 10:00 PM');
    expect(partyLabel(t.party)).toBe('2 travellers · stay together');
    expect(partyLabel({ ...t.party, stayTogether: false })).toBe('2 travellers');
    expect(partyLabel({ ...t.party, count: 1 })).toBe('1 traveller');
    expect(homeLabel(t)).toBe('Home, Montréal');
    expect(tripSubtitle(t)).toBe('Spain and Portugal · 2 travellers');
    expect(compactSummary(t)).toBe('4 legs · 2 backups');
  });

  it('counts down to the outbound: days, tomorrow, today, under way, done', () => {
    const t = sevilleTrip();
    expect(countdown(t, NOW)).toEqual({ text: 'In 7 days', tone: 'blue' });
    expect(countdown(t, yul('2026-10-07', '12:00')).text).toBe('Tomorrow');
    expect(countdown(t, yul('2026-10-08', '09:00')).text).toBe('Today');
    expect(countdown(t, yul('2026-10-08', '18:00')).text).toBe('Under way');
    expect(countdown(t, yul('2026-10-13', '22:01')).text).toBe('Done');
  });

  it('builds the g2 timeline rows with status and provenance', () => {
    const rows = legRows(sevilleTrip());
    expect(rows.map(r => r.title)).toEqual([
      'Thu · YUL → MAD · AC834', 'Fri · Madrid → Seville', 'Mon · Seville → Lisbon', 'Tue · LIS → YUL · AC813',
    ]);
    expect(rows.map(r => r.meta)).toEqual([
      '17:55 → 06:50⁺¹ · 2 backups',
      'Train about 2h40 · not booked',
      'Bus 09:00 → 14:45 · your note',
      '11:25 → 13:50 · home 8h before your deadline',
    ]);
    expect(rows.map(r => r.status ?? r.provenance)).toEqual(['listed', 'estimated', 'saved', 'planned']);
    expect(rows.map(r => r.provenance)).toEqual(['scheduled', 'estimated', 'saved', 'scheduled']);
    expect(rows.map(r => r.icon)).toEqual(['plane', 'train', 'bus', 'plane']);
  });

  it('says honestly when a flight is not found or lands after the deadline', () => {
    const t = sevilleTrip();
    const out = t.legs[0];
    if (out.kind === 'flight') out.provenance = 'unknown';
    expect(legRows(t)[0].meta).toBe('17:55 → 06:50⁺¹ · not found in our schedule data · 2 backups');
    const ref = (t.legs[3] as FlightLeg).refs[0];
    expect(deadlineNote(t, { ...ref, arrLocal: '22:30' })).toBe('lands after your deadline');
    expect(deadlineNote(t, { ...ref, arrLocal: '21:20' })).toBe('home 40m before your deadline');
    expect(deadlineNote(t, (t.legs[0] as FlightLeg).refs[0])).toBeNull();
  });

  it('says a route the network lists is flown, with times not in our data (still Unknown)', () => {
    const t = sevilleTrip();
    const out = t.legs[0];
    if (out.kind === 'flight') out.provenance = 'unknown';
    setRouteNetworkSource({ ...ROUTE_NETWORK_FIXTURE, routes: { 'YUL-MAD': ['A', 0, null, null, null] } });
    try {
      const row = legRows(t)[0];
      expect(row.meta).toBe('17:55 → 06:50⁺¹ · flies this route · times not in our data · 2 backups');
      expect(row.provenance).toBe('unknown');
      expect(row.meta).not.toMatch(/%|no flight/i);
    } finally {
      resetRouteNetworkSource();
    }
  });

  it('describes ground legs: estimate label, unknown, or the mode and minutes', () => {
    const t = sevilleTrip();
    const train = t.legs[1] as GroundLeg;
    expect(groundLabel(train)).toBe('Train about 2h40');
    expect(groundLabel({ ...train, estMinutes: 200 })).toBe('Train about 3h20');
    expect(groundLabel({ ...train, provenance: 'unknown', estMinutes: null })).toBe('Onward travel unknown');
    t.legs[1] = { ...train, provenance: 'unknown', estMinutes: null };
    expect(legRows(t)[1].meta).toBe('Onward travel unknown · find it yourself');
  });

  it('an Estimated ground leg whose ride now comes from a timetable shows the ride as Scheduled, the exit as Estimated', () => {
    const t = sevilleTrip();
    const train = t.legs[1] as GroundLeg;
    // No timetable loaded: the stored leg reads exactly as before.
    expect(groundRide(train)).toEqual({ label: 'Train about 2h40', provenance: 'estimated', exit: null });
    expect(legRows(t)[1].provenance).toBe('estimated');
    setGroundTimetables(decodeGround(structuredClone(FIXTURE_GROUND_FILE)));
    try {
      expect(groundRide(train)).toEqual({
        label: 'Train 2h39', provenance: 'scheduled', exit: { label: 'Passport, exit, get to Atocha', min: 90 },
      });
      expect(legRows(t)[1]).toMatchObject({ meta: 'Train 2h39 · not booked', provenance: 'scheduled' });
      // The stored schema is untouched: still 'estimated' with its minutes.
      expect(train).toMatchObject({ provenance: 'estimated', estMinutes: 250 });
      // Saved and unknown legs keep their own tags.
      const saved: GroundLeg = { ...train, provenance: 'saved', userTimes: { depDateKey: '2026-10-09', depLocal: '10:05', arrDateKey: '2026-10-09', arrLocal: '12:45' } };
      t.legs[1] = saved;
      expect(legRows(t)[1].provenance).toBe('saved');
      expect(groundRide({ ...train, provenance: 'unknown', estMinutes: null }).provenance).toBe('unknown');
      // Another mode than the timetable's: still Estimated.
      expect(groundRide({ ...train, mode: 'bus' }).provenance).toBe('estimated');
    } finally {
      setGroundTimetables(null);
    }
  });

  it('shows the return reminder within 14 days while a return is only Planned', () => {
    const t = sevilleTrip();
    expect(returnNotListed(t, NOW)).toBe(true);
    expect(returnNotListed(t, yul('2026-09-20', '12:00'))).toBe(false);
    const listed = sevilleTrip();
    listed.legs[3].status = 'listed';
    expect(returnNotListed(listed, NOW)).toBe(false);
  });

  it('lists the offline airports and the date range (g8)', () => {
    const t = sevilleTrip();
    expect(offlineAirports(t, { minConnect: 120 })).toEqual(['BCN', 'LIS', 'MAD', 'YYZ']);
    expect(offlineAirportsLabel(t, { minConnect: 120 })).toBe('Barcelona, Lisbon, Madrid, Toronto');
    expect(offlineUntil(t, '2027-09-26')).toBe('2026-10-20');
    expect(offlineUntil(t, '2026-10-15')).toBe('2026-10-15');
    expect(savedAtLabel(t.offlineSavedAt, 'YUL')).toBe('Saved Thu Oct 1, 09:38');
    expect(savedAtLabel(null, 'YUL')).toBeNull();
    expect(sharedLabel('2026-10-01T13:38:00.000Z', 'America/Toronto')).toBe('Shared plan · Thu Oct 1');
  });

  it('marks replaced legs as done', () => {
    const t = sevilleTrip();
    t.legs[0].status = 'abandoned';
    const rows = legRows(t);
    expect(rows[0].done).toBe(true);
    expect(rows.find(r => r.id === SEVILLE_IDS.ret)!.done).toBe(false);
  });

  it('knows when the trip still needs a return flight', () => {
    const t = sevilleTrip();
    expect(needsReturn(t)).toBe(false);
    const ret = t.legs.find(l => l.id === SEVILLE_IDS.ret) as FlightLeg;
    ret.status = 'notBoarded';
    expect(needsReturn(t)).toBe(true);
    t.legs = t.legs.filter(l => l.id !== SEVILLE_IDS.ret);
    expect(needsReturn(t)).toBe(true);
  });
});
