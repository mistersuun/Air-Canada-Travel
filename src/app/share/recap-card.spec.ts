import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { Trip } from '../trips/model';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { CARD_MIN_H } from './trip-card';
import {
  DEFAULT_RECAP_OPTIONS, RECAP_PHOTO_H, coverRect, recapDates, recapFilename, recapHead, recapLayout, renderRecapCard,
} from './recap-card';
import { stubCanvas } from './testing/stub-canvas';

const noFonts = async () => undefined;
const nodePng = (b: Uint8Array) => new NodeBlob([b], { type: 'image/png' }) as unknown as Blob;

function done(): Trip {
  const t = sevilleTrip();
  t.goal = { ...t.goal, name: 'Lisbon', acCode: 'LIS' };
  for (const l of t.legs) if (l.kind === 'flight') l.status = 'boarded';
  return t;
}

describe('recapDates', () => {
  it('spans the boarded flights', () => {
    expect(recapDates(done())).toBe('Oct 8 – Oct 13');
  });
  it('is one date when it was one day', () => {
    const t = done();
    t.legs = t.legs.slice(0, 1);
    t.legs[0] = { ...t.legs[0], status: 'boarded' } as Trip['legs'][number];
    if (t.legs[0].kind === 'flight') t.legs[0].refs[0].arrDateKey = '2026-10-08';
    expect(recapDates(t)).toBe('Oct 8');
  });
});

describe('recapLayout', () => {
  const head = () => recapHead(done(), DEFAULT_RECAP_OPTIONS, false, undefined, undefined);

  it('is 1080 wide and at least 1080 tall, blocks in order, footer last', () => {
    const l = recapLayout(head());
    expect(l.width).toBe(1080);
    expect(l.height).toBeGreaterThanOrEqual(CARD_MIN_H);
    expect(l.blocks.map(b => b.kind)).toEqual(['eyebrow', 'title', 'dates', 'line', 'footer']);
    const ys = l.blocks.map(b => b.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(l.blocks[0]).toMatchObject({ text: 'TRIP RECAP' });
    expect(l.blocks[1]).toMatchObject({ text: 'Lisbon' });
    expect(l.blocks[3]).toMatchObject({ text: expect.stringMatching(/^2 flights · [\d,]+ km · 3 countries$/) });
    expect(l.blocks.at(-1)).toMatchObject({ kind: 'footer', mark: 'Routes' });
  });

  it('puts the photo on top and pushes the text under it', () => {
    const l = recapLayout(recapHead(done(), DEFAULT_RECAP_OPTIONS, true));
    expect(l.blocks[0]).toEqual({ kind: 'photo', y: 0, h: RECAP_PHOTO_H });
    expect(l.blocks[1].y).toBeGreaterThan(RECAP_PHOTO_H);
  });

  it('adds the arc and the standby record only when asked', () => {
    const t = done();
    const plain = recapLayout(recapHead(t, { arc: false, standbyRecord: false }, false));
    expect(plain.blocks.some(b => b.kind === 'arc' || b.kind === 'record')).toBe(false);
    const both = recapLayout(recapHead(t, { arc: true, standbyRecord: true }, false));
    expect(both.blocks.find(b => b.kind === 'arc')).toMatchObject({ from: 'YUL', to: 'LIS' });
    expect(both.blocks.find(b => b.kind === 'record')).toMatchObject({ text: 'Boarded 2 of 2 tries' });
  });

  it('omits the record when nothing was tried', () => {
    const t = done();
    t.legs.forEach(l => { l.status = 'planned'; });
    const l = recapLayout(recapHead(t, { arc: false, standbyRecord: true }, false));
    expect(l.blocks.some(b => b.kind === 'record')).toBe(false);
  });

  it('shrinks a long title and a long line to one line', () => {
    const t = done();
    t.goal = { ...t.goal, name: 'Saint-Martin-de-Ré, Île de Ré, Charente-Maritime' };
    const l = recapLayout(recapHead(t, DEFAULT_RECAP_OPTIONS, false));
    const title = l.blocks.find(b => b.kind === 'title')!;
    expect(title.kind === 'title' && title.size).toBeLessThan(112);
  });
});

describe('coverRect', () => {
  it('crops a wide photo to a wide box around the focal point', () => {
    expect(coverRect(2000, 1000, 1080, 640, '50% 50%')).toMatchObject({ sx: expect.any(Number), sy: expect.any(Number) });
    const r = coverRect(2000, 1000, 1000, 1000, '0% 50%');
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(1000);
    const c = coverRect(2000, 1000, 1000, 1000, '100% 50%');
    expect(c.sx).toBe(1000);
  });
  it('falls back to the centre for a bad position', () => {
    expect(coverRect(2000, 1000, 1000, 1000, 'x y').sx).toBe(500);
  });
});

describe('renderRecapCard', () => {
  it('draws a PNG from counts only, never the notes', async () => {
    const texts: string[] = [];
    const t = done();
    for (const l of t.legs) l.note = 'Booking ABC123';
    const blob = await renderRecapCard(t, { arc: true, standbyRecord: true }, {
      canvas: stubCanvas(texts, nodePng), fonts: noFonts, photo: async () => null,
    });
    expect(blob.type).toBe('image/png');
    expect(texts).toContain('TRIP RECAP');
    expect(texts).toContain('Lisbon');
    expect(texts).toContain('Boarded 2 of 2 tries');
    expect(texts.join('\n')).not.toContain('ABC123');
    expect(texts.join('\n')).not.toMatch(/AC\d{3}/);
  });

  it('survives a photo that fails to load', async () => {
    const blob = await renderRecapCard(done(), DEFAULT_RECAP_OPTIONS, {
      canvas: stubCanvas([], nodePng), fonts: noFonts, photo: () => Promise.reject(new Error('x')),
    });
    expect(blob.type).toBe('image/png');
  });
});

describe('recapFilename', () => {
  it('is a slug', () => {
    expect(recapFilename(done())).toBe('lisbon-recap.png');
  });
});
