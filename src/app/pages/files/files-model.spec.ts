import { describe, expect, it } from 'vitest';
import type { Attachment } from '../../files/model';
import { emptyUsage } from '../../files/model';
import type { PassRecord } from '../../passes/model';
import { SEVILLE_IDS, sevilleTrip } from '../../trips/testing/seville-fixture';
import { attachment } from '../../files/testing/files-testing';
import {
  categoryCounts, fileSections, filesErrorText, isIos, itemIcon, itemMeta, passMeta, persistNote, photoTiles, scopeFromKey,
  scopeKey, scopeOptions, tripDays, usageBars, usageTitle,
} from './files-model';

const MB = 1024 * 1024;

function pass(over: Partial<PassRecord> = {}): PassRecord {
  return {
    v: 1, id: 'p1', tripId: SEVILLE_IDS.trip, legId: SEVILLE_IDS.outbound, refIndex: 0, matched: 'confirmed', raw: 'M1X', format: 'PDF417',
    bcbpLeg: 0, lastName: 'EXAMPLE', firstName: 'ALEX', pnr: 'ABC123', from: 'YUL', to: 'MAD', flightNumber: 'AC834', julian: 281,
    dateKey: '2026-10-08', cabin: 'Y', seat: '34K', sequence: '0045', imageBlobId: 'img1', source: 'image', page: null,
    deleteAfterTrip: false, createdAt: '2026-10-01T12:00:00.000Z', ...over,
  };
}

/** The x11 example set: 7 files and 2 passes on the Seville trip. */
function x11(): { atts: Attachment[]; passes: PassRecord[] } {
  const a = (id: string, over: Partial<Attachment>) => attachment({ id, createdAt: `2026-10-01T12:0${id.slice(1)}:00.000Z`, ...over });
  return {
    atts: [
      a('a1', { title: 'Travel insurance', bytes: 412 * 1024 }),
      a('a2', { title: 'Train tickets', scope: { kind: 'leg', legId: SEVILLE_IDS.train }, bytes: 186 * 1024 }),
      a('a3', { title: 'Apartment address', kind: 'address', text: 'Calle Ejemplo 12, Seville', blobId: null, mime: null, bytes: 0,
        scope: { kind: 'leg', legId: SEVILLE_IDS.train } }),
      a('a4', { title: 'Alcázar', kind: 'image', mime: 'image/jpeg', bytes: 2 * MB, scope: { kind: 'day', dateKey: '2026-10-10' } }),
      a('a5', { title: 'Rooftops', kind: 'image', mime: 'image/jpeg', bytes: 2 * MB, scope: { kind: 'day', dateKey: '2026-10-10' } }),
      a('a6', { title: 'Plaza', kind: 'image', mime: 'image/jpeg', bytes: 2 * MB, scope: { kind: 'day', dateKey: '2026-10-10' } }),
      a('a7', { title: 'Note', kind: 'note', text: 'Alcázar tickets: 10:30 slot', blobId: null, mime: null, bytes: 0,
        scope: { kind: 'day', dateKey: '2026-10-10' } }),
    ],
    passes: [pass(), pass({ id: 'p2', seat: '34J', firstName: 'SAM', createdAt: '2026-10-01T12:01:00.000Z' })],
  };
}

describe('files-model', () => {
  it('groups Whole trip first, then each day with a leg or a file, titled like x11', () => {
    const { atts, passes } = x11();
    const s = fileSections(sevilleTrip(), atts, passes);
    expect(s.map(x => x.title)).toEqual([
      'Whole trip',
      'Thu Oct 8 · AC834 YUL → MAD',
      'Fri Oct 9 · Madrid → Seville',
      'Sat Oct 10',
      'Mon Oct 12 · Seville → Lisbon',
      'Tue Oct 13 · AC813 LIS → YUL',
    ]);
    expect(s[0].items.map(a => a.title)).toEqual(['Travel insurance']);
    expect(s[1].passes).toEqual([{ legId: SEVILLE_IDS.outbound, firstId: 'p1', count: 2, meta: '2 passes · seat 34K, 34J' }]);
    expect(s[1].emptyLeg).toBeNull();
    expect(s[2].items.map(a => a.title)).toEqual(['Train tickets', 'Apartment address']);
    expect(s[3].photos).toHaveLength(3);
    expect(s[3].aside).toBe('3 photos');
    expect(s[3].items.map(a => a.kind)).toEqual(['note']);
    expect(s[3].target).toEqual({ kind: 'day', dateKey: '2026-10-10' });
    expect(s[5].emptyLeg?.id).toBe(SEVILLE_IDS.ret);
    expect(s[5].target).toEqual({ kind: 'leg', legId: SEVILLE_IDS.ret });
  });

  it('never puts the PNR or names in the passes row', () => {
    const { atts, passes } = x11();
    const text = JSON.stringify(fileSections(sevilleTrip(), atts, passes).map(s => s.passes));
    expect(text).not.toContain('ABC123');
    expect(text).not.toContain('ALEX');
  });

  it('keeps files of a deleted leg and passes without a leg in Whole trip; ignores other trips', () => {
    const atts = [
      attachment({ id: 'x1', scope: { kind: 'leg', legId: 'gone' } }),
      attachment({ id: 'x2', tripId: 'other' }),
    ];
    const s = fileSections(sevilleTrip(), atts, [pass({ legId: null }), pass({ id: 'p9', tripId: 'other' })]);
    expect(s[0].items.map(a => a.id)).toEqual(['x1']);
    expect(s[0].passes).toEqual([{ legId: null, firstId: 'p1', count: 1, meta: '1 pass · seat 34K' }]);
  });

  it('hides legs a swap replaced unless they still hold something', () => {
    const t = sevilleTrip();
    t.legs[3].status = 'abandoned';
    expect(fileSections(t, [], []).map(s => s.key)).not.toContain('2026-10-13');
    const kept = fileSections(t, [attachment({ scope: { kind: 'leg', legId: SEVILLE_IDS.ret } })], []);
    expect(kept.map(s => s.key)).toContain('2026-10-13');
  });

  it('photo tiles: up to 3, else 2 and "+N"', () => {
    expect(photoTiles([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(photoTiles([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2], more: 3 });
  });

  it('usage: title, a legend with text and sizes for every kind present', () => {
    const u = { ...emptyUsage(), count: 9, bytes: 3 * MB, byCategory: { passes: MB, pdfs: MB, photos: MB, notes: 0, other: 0 } };
    const bars = usageBars(u, { passes: 2, pdfs: 1, photos: 1, notes: 2, other: 0 });
    expect(bars.map(b => b.text)).toEqual(['Passes 1.0 MB', 'PDFs 1.0 MB', 'Photos 1.0 MB', 'Notes']);
    expect(bars.every(b => b.pct > 0)).toBe(true);
    expect(usageTitle(9, 14.2 * MB)).toBe('9 files · 14.2 MB');
    expect(usageTitle(0, 0)).toBe('No files yet');
    expect(categoryCounts(x11().atts, 2)).toEqual({ passes: 2, pdfs: 2, photos: 3, notes: 2, other: 0 });
  });

  it('row meta and icons', () => {
    const t = sevilleTrip();
    expect(itemMeta(attachment({ bytes: 412 * 1024 }))).toBe('PDF · 412 KB');
    expect(itemMeta(attachment({ bytes: 186 * 1024, pages: 2 }))).toBe('PDF · 2 pages · 186 KB');
    expect(itemMeta(attachment({ kind: 'image', bytes: 2 * MB }))).toBe('Photo · 2.0 MB');
    expect(itemMeta(attachment({ kind: 'file', mime: 'text/plain', bytes: 3000 }))).toBe('Text · 3 KB');
    expect(itemMeta(attachment({ kind: 'address', text: 'Calle Ejemplo 12' }))).toBe('Calle Ejemplo 12');
    expect(itemIcon(attachment({ title: 'Train tickets', scope: { kind: 'leg', legId: SEVILLE_IDS.train } }), t))
      .toEqual({ name: 'train', tone: 'ground' });
    expect(itemIcon(attachment({ title: 'Apartment', scope: { kind: 'leg', legId: SEVILLE_IDS.train } }), t)).toEqual({ name: 'doc', tone: 'pdf' });
    expect(itemIcon(attachment({ kind: 'address' }), t)).toEqual({ name: 'pin', tone: 'note' });
  });

  it('Move to… options: Whole trip, each leg, each day; keys round-trip', () => {
    const o = scopeOptions(sevilleTrip());
    expect(o[0].label).toBe('Whole trip');
    expect(o[1].label).toBe('AC834 YUL → MAD · Thu Oct 8');
    expect(o.filter(x => x.scope.kind === 'day').map(x => x.label)).toEqual(
      ['Thu Oct 8', 'Fri Oct 9', 'Sat Oct 10', 'Sun Oct 11', 'Mon Oct 12', 'Tue Oct 13']);
    for (const x of o) expect(scopeFromKey(scopeKey(x.scope))).toEqual(x.scope);
    expect(tripDays(sevilleTrip())).toHaveLength(6);
  });

  it('keep note and error copy', () => {
    expect(persistNote({ persisted: false, installed: false }, true)).toBe('On iPhone, add Routes to your Home Screen so these files are kept.');
    expect(persistNote({ persisted: false, installed: false }, false)).toBe('Your browser may clear these if space runs low.');
    expect(persistNote({ persisted: true, installed: false }, true)).toBeNull();
    expect(persistNote({ persisted: false, installed: true }, true)).toBeNull();
    expect(persistNote(null, true)).toBeNull();
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isIos({ userAgent: 'X', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Android' })).toBe(false);
    expect(filesErrorText('quota', 12.4 * MB)).toBe(
      'Not enough space on this phone for this file (12.4 MB). Delete some files or photos, then try again.');
    expect(filesErrorText('tooLarge')).toBe('This file is over 50 MB. Pick a smaller one.');
  });

  it('passMeta without seats', () => {
    expect(passMeta([pass({ seat: null })])).toBe('1 pass');
  });
});
