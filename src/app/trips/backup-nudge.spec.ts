import { describe, expect, it } from 'vitest';
import { backupNudge } from './backup-nudge';
import { SEVILLE_TRIP } from './testing/seville-fixture';
import { toUtcMs } from '../utils/time';

const at = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');
// SEVILLE_TRIP: updatedAt 2026-10-01T13:38Z, first flight leaves 2026-10-08 17:55 Toronto.
const trips = [SEVILLE_TRIP];

describe('backupNudge', () => {
  it('is silent with no trips', () => {
    expect(backupNudge([], null, null, at('2026-10-01', '09:00'))).toBeNull();
  });
  it('says so when there has never been a backup and a trip departs within 72 h', () => {
    expect(backupNudge(trips, null, null, at('2026-10-06', '09:00'))).toContain('leaves within 3 days');
  });
  it('mentions no backup yet when never exported and the trip is far off', () => {
    expect(backupNudge(trips, null, null, at('2026-10-01', '15:00'))).toContain('No backup yet');
  });
  it('is silent when the backup is recent and nothing departs soon', () => {
    expect(backupNudge(trips, null, '2026-10-01T14:00:00Z', at('2026-10-05', '09:00'))).toBeNull();
  });
  it('nudges when the last backup is over 14 days old and trips changed since', () => {
    expect(backupNudge(trips, null, '2026-09-01T00:00:00Z', at('2026-10-02', '09:00'))).toContain('31 days ago');
  });
  it('is silent when trips have not changed since the backup, however old', () => {
    expect(backupNudge(trips, null, '2026-10-02T00:00:00Z', at('2026-12-01', '09:00'))).toBeNull();
  });
  it('is silent for a departing trip that was backed up after its last change', () => {
    expect(backupNudge(trips, null, '2026-10-05T00:00:00Z', at('2026-10-06', '09:00'))).toBeNull();
  });
  it('ignores archived and already departed trips for the 72 h rule', () => {
    expect(backupNudge([{ ...SEVILLE_TRIP, archived: true }], null, '2026-10-01T00:00:00Z', at('2026-10-06', '09:00'))).toBeNull();
    expect(backupNudge(trips, null, '2026-10-01T00:00:00Z', at('2026-10-09', '09:00'))).toBeNull();
  });
  it('treats a newer flight-log entry as a change', () => {
    const log = { schema: 1 as const, notes: [], dismissed: [], outcomes: [{
      id: 'o', flightNumber: 'AC1', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-01', kind: 'allBoarded' as const,
      partySize: 1, tripId: null, note: '', recordedAt: '2026-10-04T00:00:00Z' }] };
    expect(backupNudge(trips, log, '2026-10-02T00:00:00Z', at('2026-12-01', '09:00'))).toContain('Changes since');
  });
  it('never-backed-up archived trips do not nudge', () => {
    expect(backupNudge([{ ...SEVILLE_TRIP, archived: true }], null, null, at('2026-10-01', '15:00'))).toBeNull();
  });
  it('counts whole days, rounded down', () => {
    expect(backupNudge(trips, null, '2026-09-17T13:00:00Z', at('2026-10-01', '09:00'))).toBeNull();
  });
});
