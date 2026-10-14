import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { directItineraries } from '../../utils/connections';
import { buildIcs } from '../../utils/ics';
import type { FlightRef } from '../model';
import { sevilleTrip } from '../testing/seville-fixture';
import { refArrUtc, refDepUtc } from './legs';
import { buildTripIcs } from './trip-ics';

/**
 * utils/ics.ts (one itinerary) and trips/engine/trip-ics.ts (a whole trip) write the same file
 * format with different event content. These checks keep the shared parts from drifting apart.
 */
const NOW = Date.UTC(2026, 9, 1, 13, 38);
const unfold = (s: string) => s.replace(/\r\n /g, '');
const lines = (s: string) => unfold(s).split('\r\n').filter(Boolean);
const field = (ics: string, name: string) => lines(ics).filter(l => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe('itinerary export and trip export agree', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  const itinerary = () => directItineraries('YUL', 'LHR', '2026-10-07')[0];
  const itineraryIcs = () => buildIcs(itinerary(), 'London', { now: NOW });

  it('share the calendar envelope (version, scale, method, CRLF endings)', () => {
    const a = itineraryIcs();
    const b = buildTripIcs(sevilleTrip(), NOW);
    for (const ics of [a, b]) {
      expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:')).toBe(true);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
      expect(field(ics, 'CALSCALE')).toEqual(['CALSCALE:GREGORIAN']);
      expect(field(ics, 'METHOD')).toEqual(['METHOD:PUBLISH']);
      expect(field(ics, 'X-WR-CALNAME')).toHaveLength(1);
      expect(field(ics, 'DTSTAMP').every(l => l === 'DTSTAMP:20261001T133800Z')).toBe(true);
    }
  });

  it('fold every line to 75 octets', () => {
    const trip = sevilleTrip();
    trip.name = 'A very long trip name, with commas; semicolons and accents: Évora, Köln, Zürich, Málaga, Kraków and more places to see';
    for (const ics of [buildIcs(itinerary(), trip.name, { now: NOW }), buildTripIcs(trip, NOW)]) {
      for (const l of ics.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
      // Folding is lossless: unfolded, the long name is intact (escaped) in the calendar name.
      expect(unfold(ics)).toContain('A very long trip name\\, with commas\\; semicolons');
    }
  });

  it('time the same flight at the same UTC instants', () => {
    const f = itinerary().legs[0];
    const ref: FlightRef = {
      flightNumber: f.flightNumber!, origin: f.origin, dest: f.dest, dateKey: f.dateKey, depLocal: f.depLocal,
      arrLocal: f.arrLocal, arrDateKey: f.arrDateKey, aircraft: f.aircraft,
    };
    expect(refDepUtc(ref)).toBe(f.depUtc);
    expect(refArrUtc(ref)).toBe(f.arrUtc);

    const trip = sevilleTrip();
    const flightLeg = trip.legs.find(l => l.kind === 'flight')!;
    if (flightLeg.kind !== 'flight') throw new Error('fixture has no flight leg');
    flightLeg.refs = [ref];
    const tripEvent = buildTripIcs(trip, NOW);
    const itinEvent = itineraryIcs();
    expect(field(tripEvent, 'DTSTART')).toContain(field(itinEvent, 'DTSTART')[0]);
    expect(field(tripEvent, 'DTEND')).toContain(field(itinEvent, 'DTEND')[0]);
    // Same place text for the departure airport.
    expect(field(tripEvent, 'LOCATION')).toContain(field(itinEvent, 'LOCATION')[0]);
  });

  it('say it is not a booking', () => {
    expect(unfold(itineraryIcs())).toContain('not a booking');
    expect(unfold(buildTripIcs(sevilleTrip(), NOW))).toContain('not a booking');
  });
});
