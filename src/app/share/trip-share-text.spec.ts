import { describe, expect, it } from 'vitest';
import type { FlightLeg, GroundLeg } from '../trips/model';
import { SEVILLE_IDS, SEVILLE_TRIP, sevilleTrip } from '../trips/testing/seville-fixture';
import {
  SHARE_FOOTER, backupsSummary, hasBackups, shareFilename, shareSubtitle, splitNote, tripShareRows, tripShareText,
} from './trip-share-text';

const ALL = { includeSplitNote: true, includeBackups: true, fmt: '24h' as const };
const NONE = { includeSplitNote: false, includeBackups: false, fmt: '24h' as const };

describe('tripShareText', () => {
  it('writes the Seville plan with the split note and backups, exactly', () => {
    expect(tripShareText(SEVILLE_TRIP, ALL)).toBe([
      'Seville · Thu Oct 8 → Tue Oct 13',
      'Thu AC834 YUL 17:55 → MAD 06:50+1 (scheduled, standby)',
      'Fri Madrid → Seville, train about 2h40 (estimated)',
      'Mon Seville → Lisbon, bus 09:00 → 14:45 (saved by me)',
      'Tue AC813 LIS 11:25 → YUL 13:50 (scheduled, standby)',
      'If we split up: Meet at Seville Santa Justa station. Whoever arrives first books the room.',
      'Backups for Thu: AC822 to BCN 18:35, AC812 to LIS 21:45',
      'Times are local. A standby plan, not a booking.',
    ].join('\n'));
  });

  it('has 6 lines with both switches off (header, 4 legs, footer)', () => {
    const lines = tripShareText(SEVILLE_TRIP, NONE).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe(SHARE_FOOTER);
    expect(lines.join('\n')).not.toContain('split up');
    expect(lines.join('\n')).not.toContain('Backups');
  });

  it('uses the 12-hour clock when asked', () => {
    const text = tripShareText(SEVILLE_TRIP, { ...NONE, fmt: '12h' });
    expect(text).toContain('Thu AC834 YUL 5:55 PM → MAD 6:50 AM+1 (scheduled, standby)');
    expect(text).toContain('bus 9:00 AM → 2:45 PM (saved by me)');
  });

  it('leaves out replaced legs and never adds leg notes or booking codes', () => {
    const t = sevilleTrip();
    const out = t.legs.find(l => l.id === SEVILLE_IDS.outbound) as FlightLeg;
    out.status = 'notBoarded';
    for (const l of t.legs) l.note = 'PNR ABC123 seat 14C';
    const text = tripShareText(t, ALL);
    expect(text).not.toContain('AC834');
    expect(text).not.toContain('ABC123');
    expect(text).not.toContain('14C');
    expect(text).not.toContain('Backups for Thu');
    expect(tripShareRows(t, ALL).map(r => r.title)).toEqual(['Train to Seville', 'Bus to Lisbon', 'AC813 LIS → YUL']);
  });

  it('says "door to door" or just the mode when the estimate is not the corridor one', () => {
    const t = sevilleTrip();
    const train = t.legs.find(l => l.id === SEVILLE_IDS.train) as GroundLeg;
    train.provenance = 'unknown';
    expect(tripShareText(t, NONE)).toContain('Fri Madrid → Seville, train about 4h10 door to door (unknown)');
    train.estMinutes = null;
    expect(tripShareText(t, NONE)).toContain('Fri Madrid → Seville, train (unknown)');
  });

  it('marks flights not found in the schedules as unknown', () => {
    const t = sevilleTrip();
    (t.legs.find(l => l.id === SEVILLE_IDS.ret) as FlightLeg).provenance = 'unknown';
    expect(tripShareText(t, NONE)).toContain('Tue AC813 LIS 11:25 → YUL 13:50 (unknown, standby)');
    expect(tripShareRows(t, NONE)[3]).toMatchObject({ label: 'Unknown · standby', tone: 'unknown' });
  });

  it('writes one line per segment of a one-stop leg', () => {
    const t = sevilleTrip();
    const ret = t.legs.find(l => l.id === SEVILLE_IDS.ret) as FlightLeg;
    ret.refs = [
      { flightNumber: 'AC811', origin: 'LIS', dest: 'YYZ', dateKey: '2026-10-13', depLocal: '13:00', arrLocal: '15:55', arrDateKey: '2026-10-13', aircraft: '77W' },
      { flightNumber: 'AC426', origin: 'YYZ', dest: 'YUL', dateKey: '2026-10-13', depLocal: '20:30', arrLocal: '21:50', arrDateKey: '2026-10-13', aircraft: '223' },
    ];
    const lines = tripShareText(t, NONE).split('\n');
    expect(lines).toContain('Tue AC811 LIS 13:00 → YYZ 15:55 (scheduled, standby)');
    expect(lines).toContain('Tue AC426 YYZ 20:30 → YUL 21:50 (scheduled, standby)');
  });
});

describe('tripShareRows', () => {
  it('gives the card rows: day, title, label, time', () => {
    expect(tripShareRows(SEVILLE_TRIP, NONE).map(r => [r.day, r.title, r.label, r.time])).toEqual([
      ['Thu 8', 'AC834 YUL → MAD', 'Scheduled · standby', '17:55'],
      ['Fri 9', 'Train to Seville', 'Estimated · about 2h40', null],
      ['Mon 12', 'Bus to Lisbon', 'Saved by you', '09:00'],
      ['Tue 13', 'AC813 LIS → YUL', 'Scheduled · standby', '11:25'],
    ]);
  });

  it('adds the backups under the flight only when asked', () => {
    expect(tripShareRows(SEVILLE_TRIP, NONE)[0].backups).toBeNull();
    expect(tripShareRows(SEVILLE_TRIP, ALL)[0].backups).toBe('Backups: AC822 BCN 18:35 · AC812 LIS 21:45');
  });
});

describe('helpers', () => {
  it('summarises the backups for the switch', () => {
    expect(hasBackups(SEVILLE_TRIP)).toBe(true);
    expect(backupsSummary(SEVILLE_TRIP)).toBe('AC822 BCN, AC812 LIS for Thu');
    const t = sevilleTrip();
    (t.legs[0] as FlightLeg).alternates = [];
    expect(hasBackups(t)).toBe(false);
    expect(backupsSummary(t)).toBe('');
  });

  it('builds the filename, subtitle and split note', () => {
    expect(shareFilename(SEVILLE_TRIP)).toBe('routes-seville-2026-10-08.png');
    const t = sevilleTrip();
    t.goal = { ...t.goal, name: 'São Paulo / Brazil' };
    expect(shareFilename(t)).toBe('routes-sao-paulo-brazil-2026-10-08.png');
    expect(shareSubtitle(SEVILLE_TRIP)).toBe('Thu Oct 8 → Tue Oct 13 · 2 travellers');
    t.party = { ...t.party, count: 1, splitNote: '   ' };
    expect(shareSubtitle(t)).toBe('Thu Oct 8 → Tue Oct 13 · 1 traveller');
    expect(splitNote(t)).toBeNull();
  });

  it('never words a chance, an odd or a percentage', () => {
    const all = [tripShareText(SEVILLE_TRIP, ALL), JSON.stringify(tripShareRows(SEVILLE_TRIP, ALL))].join('\n');
    expect(all).not.toMatch(/%|chance|odds|likely/i);
  });
});
