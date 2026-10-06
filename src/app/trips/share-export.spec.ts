import { describe, expect, it } from 'vitest';
import { FlightLog, LoadNote, emptyFlightLog } from './model';
import { backupFilename, exportBackup, mergeBackup, parseBackup } from './export';
import type { Outcome } from './model';
import { MAX_SHARE_PAYLOAD, ShareTooLargeError, decodeTripShare, encodeTripShare, payloadFromFragment, shareUrl } from './share-codec';
import { SEVILLE_TRIP, SEVILLE_TRIPS_FILE, sevilleTrip } from './testing/seville-fixture';

const NOW = Date.UTC(2026, 9, 1, 13, 41);
const NOTE: LoadNote = {
  id: 'n1', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08',
  open: 9, listed: 9, text: 'Gate 52, 9 on the list', at: '2026-10-08T20:20:00.000Z',
};

describe('share links', () => {
  it('encodes the Seville trip under 2,000 URL characters and decodes it back', async () => {
    const payload = await encodeTripShare(SEVILLE_TRIP, [NOTE], NOW);
    const url = shareUrl('https://routes.example.app', payload);
    expect(url.startsWith('https://routes.example.app/trips/import#t=')).toBe(true);
    expect(url.length).toBeLessThan(2000);
    expect(payload).toMatch(/^[zj][A-Za-z0-9_-]+$/);

    const back = (await decodeTripShare(payload))!;
    expect(back.sharedAt).toBe(new Date(NOW).toISOString());
    expect(back.notes).toEqual([NOTE]);
    // Private state is not shared.
    expect(back.trip.prep).toEqual({});
    expect(back.trip.changes).toEqual([]);
    expect(back.trip.offlineSavedAt).toBeNull();
    expect(back.trip.calendarExportedAt).toBeNull();
    expect(back.trip.archived).toBe(false);
    const strip = (t: typeof SEVILLE_TRIP) => {
      const { calendarRefs: _r, ...rest } = t;
      return { ...rest, prep: {}, changes: [], offlineSavedAt: null, calendarExportedAt: null };
    };
    expect(back.trip).toEqual(strip(SEVILLE_TRIP));
  });

  it('uses deflate when the browser has CompressionStream', async () => {
    const payload = await encodeTripShare(SEVILLE_TRIP, [], NOW);
    expect(payload[0]).toBe(typeof CompressionStream === 'function' ? 'z' : 'j');
  });

  it('never makes a link the recipient cannot import: drops notes first, then refuses', async () => {
    // Incompressible note text so the payload really grows.
    let seed = 7;
    const noise = (n: number) => Array.from({ length: n }, () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) % 36).toString(36);
    }).join('');
    const notes = Array.from({ length: 40 }, (_, i) => ({ ...NOTE, id: `n${i}`, text: noise(400) + i }));
    const payload = await encodeTripShare(SEVILLE_TRIP, notes, NOW);
    expect(payload.length).toBeLessThanOrEqual(MAX_SHARE_PAYLOAD);
    const back = (await decodeTripShare(payload))!;
    expect(back).not.toBeNull();

    const huge = { ...sevilleTrip(), name: 'x', customPrep: [] };
    huge.legs = Array.from({ length: 60 }, (_, i) => huge.legs.map(l => ({ ...l, id: `${l.id}${i}`, note: noise(500) }))).flat();
    await expect(encodeTripShare(huge, [], NOW)).rejects.toBeInstanceOf(ShareTooLargeError);
  });

  it('skips an attempt whose JSON is over what the decoder accepts, even when it compresses small', async () => {
    const notes = [{ ...NOTE, id: 'big', text: 'a'.repeat(450_000) }];
    const payload = await encodeTripShare(SEVILLE_TRIP, notes, NOW);
    const back = (await decodeTripShare(payload))!;
    expect(back).not.toBeNull();
    expect(back.notes).toEqual([]);
  });

  it('returns null for garbage, never throws', async () => {
    for (const bad of ['', 'x', 'zzzz', 'j!!!', 'jAAAA', 'qabc', 'j' + btoa('{"s":1,"trip":{}}'), 'z' + 'A'.repeat(70_000)]) {
      expect(await decodeTripShare(bad)).toBeNull();
    }
    expect(await decodeTripShare(undefined as unknown as string)).toBeNull();
  });

  it('reads the payload from a fragment', () => {
    expect(payloadFromFragment('t=zABC')).toBe('zABC');
    expect(payloadFromFragment('#t=jXYZ')).toBe('jXYZ');
    expect(payloadFromFragment('a=1&t=zQ')).toBe('zQ');
    expect(payloadFromFragment('')).toBeNull();
    expect(payloadFromFragment(null)).toBeNull();
  });
});

describe('backup export / import', () => {
  const log: FlightLog = { ...emptyFlightLog(), notes: [NOTE] };

  it('exports and parses back', () => {
    const text = exportBackup(SEVILLE_TRIPS_FILE, log, NOW);
    const raw = JSON.parse(text);
    expect(raw.kind).toBe('routes-backup');
    expect(raw.schema).toBe(1);
    expect(raw.exportedAt).toBe('2026-10-01T13:41:00.000Z');
    const parsed = parseBackup(text);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.trips).toEqual([SEVILLE_TRIP]);
    expect(parsed.log).toEqual(log);
    expect(backupFilename(NOW)).toBe('routes-trips-2026-10-01.json');
  });

  it('rejects files that are not backups', () => {
    expect(parseBackup('nope')).toEqual({ error: "This file isn't a Routes backup." });
    expect(parseBackup('{"kind":"other","trips":[]}')).toEqual({ error: "This file isn't a Routes backup." });
    expect('error' in parseBackup('{"kind":"routes-backup","schema":9,"trips":[]}')).toBe(true);
  });

  it('merges by id, the newer updatedAt wins', () => {
    const older = { ...sevilleTrip(), name: 'Old name', updatedAt: '2026-09-01T00:00:00.000Z' };
    const newer = { ...sevilleTrip(), name: 'New name', updatedAt: '2026-10-05T00:00:00.000Z' };
    const other = { ...sevilleTrip(), id: 'other00001' };
    const r1 = mergeBackup({ trips: [older], log: emptyFlightLog() }, { trips: [newer, other], log });
    expect(r1.added).toBe(1);
    expect(r1.updated).toBe(1);
    expect(r1.trips.find(t => t.id === older.id)!.name).toBe('New name');
    expect(r1.log.notes).toEqual([NOTE]);

    const r2 = mergeBackup({ trips: [newer], log }, { trips: [older], log });
    expect(r2.log.outcomes).toEqual([]);
    expect(r2.added + r2.updated).toBe(0);
    expect(r2.trips[0].name).toBe('New name');
    expect(r2.log.notes).toHaveLength(1);
  });

  it('merges outcomes by flight and trip: a correction replaces the older record', () => {
    const base: Outcome = {
      id: 'o-old', flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08', kind: 'noneBoarded',
      partySize: 2, tripId: 'sevtrip001', note: '', recordedAt: '2026-10-09T01:00:00.000Z',
    };
    const fixed: Outcome = { ...base, id: 'o-new', kind: 'allBoarded', recordedAt: '2026-10-09T02:00:00.000Z' };
    const r = mergeBackup({ trips: [], log: { ...emptyFlightLog(), outcomes: [fixed] } }, { trips: [], log: { ...emptyFlightLog(), outcomes: [base] } });
    expect(r.log.outcomes).toEqual([fixed]);
    const r2 = mergeBackup({ trips: [], log: { ...emptyFlightLog(), outcomes: [base] } }, { trips: [], log: { ...emptyFlightLog(), outcomes: [fixed] } });
    expect(r2.log.outcomes).toEqual([fixed]);
  });
});
