import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { FlightLeg, TripLeg } from '../trips/model';
import { SEVILLE_TRIP, sevilleTrip } from '../trips/testing/seville-fixture';
import { CARD_MAX_H, CARD_MIN_H, approxMeasure, cardHead, cardLayout, renderTripCard, wrapText } from './trip-card';
import { pngHeader, stubCanvas } from './testing/stub-canvas';
import { tripShareRows } from './trip-share-text';

const ALL = { includeSplitNote: true, includeBackups: true, fmt: '24h' as const };
const NONE = { includeSplitNote: false, includeBackups: false, fmt: '24h' as const };
const noFonts = async () => undefined;
const nodePng = (b: Uint8Array) => new NodeBlob([b], { type: 'image/png' }) as unknown as Blob;

function manyLegs(n: number): TripLeg[] {
  const base = SEVILLE_TRIP.legs[0] as FlightLeg;
  return Array.from({ length: n }, (_, i) => ({ ...base, id: `leg${i}`, alternates: [] }));
}

describe('cardLayout', () => {
  it('is 1080 wide, at least 1080 tall, and lays out the Seville card in order', () => {
    const l = cardLayout(tripShareRows(SEVILLE_TRIP, NONE), cardHead(SEVILLE_TRIP, NONE));
    expect(l.width).toBe(1080);
    expect(l.height).toBeGreaterThanOrEqual(CARD_MIN_H);
    expect(l.blocks.map(b => b.kind)).toEqual(['eyebrow', 'title', 'dates', 'arc', 'row', 'row', 'row', 'row', 'footer']);
    const ys = l.blocks.map(b => b.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(l.blocks[0]).toMatchObject({ text: 'TRIP PLAN' });
    expect(l.blocks[1]).toMatchObject({ text: 'Seville' });
    expect(l.blocks[2]).toMatchObject({ text: 'Thu Oct 8 → Tue Oct 13 · 2 travellers' });
    expect(l.blocks[3]).toMatchObject({ from: 'YUL', to: 'Seville' });
    const foot = l.blocks.at(-1)!;
    expect(foot).toMatchObject({ kind: 'footer', mark: 'Routes', fine: 'Times local · not a ticket' });
    expect(foot.y + 60 + 60).toBe(l.height);
  });

  it('grows with the rows and the split note, up to 1920', () => {
    const t = sevilleTrip();
    t.legs = manyLegs(7);
    const seven = cardLayout(tripShareRows(t, NONE), cardHead(t, NONE));
    t.legs = manyLegs(8);
    const eight = cardLayout(tripShareRows(t, NONE), cardHead(t, NONE));
    expect(eight.height).toBeGreaterThan(seven.height);
    const withNote = cardLayout(tripShareRows(t, ALL), cardHead(t, ALL));
    expect(withNote.blocks.some(b => b.kind === 'note')).toBe(true);
    expect(withNote.height).toBeGreaterThanOrEqual(eight.height);
  });

  it('folds rows that do not fit into "+N more legs in the app"', () => {
    const t = sevilleTrip();
    t.legs = manyLegs(30);
    const l = cardLayout(tripShareRows(t, ALL), cardHead(t, ALL));
    expect(l.height).toBeLessThanOrEqual(CARD_MAX_H);
    expect(l.height).toBeGreaterThan(CARD_MAX_H - 200);
    const rows = l.blocks.filter(b => b.kind === 'row').length;
    const more = l.blocks.find(b => b.kind === 'more');
    expect(more).toMatchObject({ text: `+${30 - rows} more legs in the app` });
    const last = l.blocks.filter(b => b.kind !== 'footer').at(-1)!;
    expect(last.y + ('h' in last ? last.h : 0)).toBeLessThanOrEqual(l.blocks.at(-1)!.y);
  });

  it('shrinks a long goal name to fit one line', () => {
    const t = sevilleTrip();
    t.goal = { ...t.goal, name: 'Saint-Martin-de-Ré, Île de Ré, Charente-Maritime' };
    const title = cardLayout([], cardHead(t, NONE)).blocks[1];
    expect(title.kind === 'title' && title.size).toBeLessThan(112);
  });
});

describe('wrapText', () => {
  it('wraps greedily and ends a cut text with an ellipsis', () => {
    const font = '500 36px Inter';
    const lines = wrapText('one two three four five six seven eight nine ten', font, 300, 2, approxMeasure);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(wrapText('short', font, 300, 4, approxMeasure)).toEqual(['short']);
  });
});

describe('renderTripCard', () => {
  it('draws a PNG with a stub canvas, from the plan only', async () => {
    const texts: string[] = [];
    const t = sevilleTrip();
    for (const l of t.legs) l.note = 'Booking ABC123';
    const blob = await renderTripCard(t, ALL, { canvas: stubCanvas(texts, nodePng), fonts: noFonts });
    expect(blob.type).toBe('image/png');
    const head = new Uint8Array(await new Response(blob).arrayBuffer());
    expect(head.slice(0, 8)).toEqual(pngHeader(1, 1).slice(0, 8));
    expect(new DataView(head.buffer).getUint32(16)).toBe(1080);
    expect(texts).toContain('TRIP PLAN');
    expect(texts).toContain('Seville');
    expect(texts).toContain('AC834 YUL → MAD');
    expect(texts).toContain('Times local · not a ticket');
    expect(texts.join('\n')).not.toContain('ABC123');
  });
});
