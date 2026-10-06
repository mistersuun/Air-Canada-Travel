import { describe, expect, it } from 'vitest';
import { icsUtc } from '../../utils/ics';
import { toUtcMs } from '../../utils/time';
import { sevilleTrip } from '../testing/seville-fixture';
import { buildTripIcs, tripIcsFilename } from './trip-ics';

const NOW = Date.UTC(2026, 9, 1, 13, 38);
const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('buildTripIcs', () => {
  it('exports every flight segment as a tentative standby with a 48h listing reminder', () => {
    const ics = unfold(buildTripIcs(sevilleTrip(), NOW));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics.match(/STATUS:TENTATIVE/g)!.length).toBeGreaterThanOrEqual(2);
    expect(ics).toContain('SUMMARY:Tentative standby · AC834 YUL→MAD');
    expect(ics).toContain('SUMMARY:Tentative standby · AC813 LIS→YUL');
    expect(ics).toContain(`DTSTART:${icsUtc(toUtcMs('2026-10-08', '17:55', 'America/Toronto'))}`);
    expect(ics.match(/TRIGGER:-PT48H/g)).toHaveLength(2);
    expect(ics).toContain('List for AC834 (check your pass rules)');
    expect(ics).toContain('not a booking');
    expect(ics).toContain(`DTSTAMP:${icsUtc(NOW)}`);
    expect(ics.match(/LAST-MODIFIED:/g)).toHaveLength(4);
    const seq = (t: number) => Number(/SEQUENCE:(\d+)/.exec(buildTripIcs(sevilleTrip(), t))![1]);
    expect(seq(NOW + 60_000)).toBeGreaterThan(seq(NOW));
    expect(seq(NOW)).toBeLessThan(2 ** 31);
  });

  it('exports ground legs: all-day when estimated, timed when saved; no alternates', () => {
    const ics = unfold(buildTripIcs(sevilleTrip(), NOW));
    expect(ics).toContain('SUMMARY:Estimated · Madrid → Seville train');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261009');
    expect(ics).toContain('SUMMARY:Seville → Lisbon bus');
    expect(ics).toContain(`DTSTART:${icsUtc(toUtcMs('2026-10-12', '09:00', 'Europe/Madrid'))}`);
    expect(ics).toContain(`DTEND:${icsUtc(toUtcMs('2026-10-12', '14:45', 'Europe/Lisbon'))}`);
    expect(ics).not.toContain('AC822');
    expect(ics).not.toContain('AC812');
  });

  it('leaves out replaced legs', () => {
    const trip = sevilleTrip();
    trip.legs[0].status = 'notBoarded';
    const ics = buildTripIcs(trip, NOW);
    expect(ics).not.toContain('AC834');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it('names the file after the goal and outbound date', () => {
    expect(tripIcsFilename(sevilleTrip())).toBe('routes-seville-2026-10-08.ics');
    expect(tripIcsFilename({ ...sevilleTrip(), goal: { ...sevilleTrip().goal, name: 'Kraków' } })).toBe('routes-krakow-2026-10-08.ics');
  });
});
