import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { toUtcMs } from '../../utils/time';
import { FlightLog, emptyFlightLog, instanceKey } from '../model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from '../testing/seville-fixture';
import { activeTravelDay, pendingOutcomePrompts, placeName } from './today';

const yul = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');
const AC834_KEY = 'AC834|YUL|2026-10-08';

describe('outcome prompts', () => {
  beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
  afterEach(() => resetScheduleSource());

  it('waits until 30 min after departure, then asks about AC834', () => {
    const trips = [sevilleTrip()];
    const log = emptyFlightLog();
    expect(pendingOutcomePrompts(trips, log, yul('2026-10-08', '18:20'))).toEqual([]);
    expect(pendingOutcomePrompts(trips, log, yul('2026-10-08', '18:25'))).toEqual([]);
    const p = pendingOutcomePrompts(trips, log, yul('2026-10-08', '18:26'));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ key: AC834_KEY, tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, partySize: 2 });
    expect(p[0].ref.flightNumber).toBe('AC834');
    expect(instanceKey(p[0].ref)).toBe(AC834_KEY);
  });

  it('stops asking once recorded, dismissed or the leg is done', () => {
    const now = yul('2026-10-09', '09:00');
    const recorded: FlightLog = {
      ...emptyFlightLog(),
      outcomes: [{ id: 'o1', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', kind: 'allBoarded', partySize: 2, tripId: SEVILLE_IDS.trip, note: '', recordedAt: '2026-10-09T01:00:00Z' }],
    };
    expect(pendingOutcomePrompts([sevilleTrip()], recorded, now)).toEqual([]);
    expect(pendingOutcomePrompts([sevilleTrip()], { ...emptyFlightLog(), dismissed: [AC834_KEY] }, now)).toEqual([]);
    const boarded = sevilleTrip();
    boarded.legs[0].status = 'boarded';
    expect(pendingOutcomePrompts([boarded], emptyFlightLog(), now)).toEqual([]);
    const archived = { ...sevilleTrip(), archived: true };
    expect(pendingOutcomePrompts([archived], emptyFlightLog(), now)).toEqual([]);
  });

  it('asks about flights with load notes too, newest first, at most 3', () => {
    const log: FlightLog = {
      ...emptyFlightLog(),
      notes: [
        { id: 'n1', flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 14, listed: 9, text: '', at: '2026-10-09T18:05:00Z' },
        { id: 'n2', flightNumber: 'AC866', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 2, listed: 11, text: '', at: '2026-10-09T13:40:00Z' },
        { id: 'n3', flightNumber: 'AC999', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-09', open: 2, listed: 11, text: '', at: '2026-10-09T13:40:00Z' },
        { id: 'n4', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', open: 1, listed: 9, text: '', at: '2026-10-08T20:20:00Z' },
      ],
    };
    const p = pendingOutcomePrompts([sevilleTrip()], log, yul('2026-10-10', '09:00'));
    expect(p.map(x => x.key)).toEqual(['AC864|YUL|2026-10-09', 'AC866|YUL|2026-10-09', AC834_KEY]);
    expect(p[0]).toMatchObject({ tripId: null, legId: null, partySize: 1 });
    expect(p[2].tripId).toBe(SEVILLE_IDS.trip); // the trip's own prompt, not a duplicate from the note
  });
});

describe('activeTravelDay', () => {
  afterEach(() => resetScheduleSource());

  it('is the outbound on Thu Oct 8 at YUL', () => {
    const day = activeTravelDay([sevilleTrip()], yul('2026-10-08', '16:40'));
    expect(day).toEqual({ tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, at: 'YUL', title: 'Montréal → Madrid' });
    // Departed less than 2h ago and not marked: still the travel day.
    expect(activeTravelDay([sevilleTrip()], yul('2026-10-08', '19:30'))?.legId).toBe(SEVILLE_IDS.outbound);
  });

  it('is nothing the day before, and nothing once the leg is done', () => {
    expect(activeTravelDay([sevilleTrip()], yul('2026-10-07', '16:40'))).toBeNull();
    const done = sevilleTrip();
    done.legs[0].status = 'boarded';
    expect(activeTravelDay([done], yul('2026-10-08', '16:40'))).toBeNull();
  });

  it('is the return on Tue Oct 13 in Lisbon', () => {
    const day = activeTravelDay([sevilleTrip()], toUtcMs('2026-10-13', '08:00', 'Europe/Lisbon'));
    expect(day).toMatchObject({ legId: SEVILLE_IDS.ret, at: 'LIS', title: 'Lisbon → Montréal' });
  });

  it('names places', () => {
    expect(placeName('YUL')).toBe('Montréal');
    expect(placeName('MAD')).toBe('Madrid');
  });
});
