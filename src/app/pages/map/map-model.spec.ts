import { describe, it, expect } from 'vitest';
import { geoNaturalEarth1 } from 'd3-geo';
import { findDestination } from '../../utils/airports';
import type { RouteEntry } from '../../utils/routes';
import {
  filterItems, fittedScale, frameView, itemMeta, labelNeighbours, LngLat, mapBox, mapItems, MapItem, nearestTo, outsideCoverage,
  overviewItems, sortItems,
} from './map-model';

const YUL = { lat: 45.47, lng: -73.74 };
const HUB: LngLat = [YUL.lng, YUL.lat];

function flight(min: number) {
  return { durationMin: min } as RouteEntry['flights'][number];
}

function day(n: number, min = 400) {
  return { flies: n > 0, coverage: 'covered', flights: Array.from({ length: n }, () => flight(min)) } as RouteEntry['weekDays'][number];
}

function direct(code: string, perDay: number[], min = 400): RouteEntry {
  return {
    destination: findDestination(code)!,
    isDirect: true,
    weekDays: perDay.map(n => day(n, min)),
    flights: [],
    daysFlying: perDay.filter(n => n > 0).length,
    isFavourite: false,
  };
}

function connecting(code: string, totalMin: number, via = 'YYZ'): RouteEntry {
  const best = { totalMin, hubs: [via] } as unknown as NonNullable<RouteEntry['itinerary']>;
  return {
    destination: findDestination(code)!,
    isDirect: false,
    weekDays: [0, 0, 0, 0, 0, 0, 0].map(n => day(n)),
    flights: [],
    daysFlying: 3,
    isFavourite: false,
    weekSummary: {
      days: [0, 1, 2, 3, 4, 5, 6].map(i => ({ dateKey: `d${i}`, direct: 0, connections: i < 3 ? 1 : 0, best: i < 3 ? best : null })),
      directDays: 0, connectDays: 3, connectOnlyDays: 3, hubs: [via], estimated: false,
    },
  };
}

const ENTRIES = [
  direct('LHR', [1, 1, 1, 1, 1, 1, 2], 410),
  direct('BOS', [3, 3, 3, 3, 3, 3, 3], 85),
  direct('KEF', [1, 0, 1, 0, 0, 1, 0], 300),
  connecting('DEL', 900),
];

describe('mapItems', () => {
  it('builds items with distance, best time, weekly count and dots', () => {
    const items = mapItems(ENTRIES, YUL, true);
    const lhr = items.find(i => i.code === 'LHR')!;
    expect(lhr.kind).toBe('direct');
    expect(lhr.count).toBe(8);
    expect(lhr.durationMin).toBe(410);
    expect(Math.round(lhr.km)).toBeGreaterThan(5000);
    expect(lhr.dots).toEqual(['on', 'on', 'on', 'on', 'on', 'on', 'on']);
    const del = items.find(i => i.code === 'DEL')!;
    expect(del).toMatchObject({ kind: 'connect', durationMin: 900, count: 3, via: 'YYZ' });
    expect(del.dots.slice(0, 4)).toEqual(['connect', 'connect', 'connect', 'off']);
  });

  it('drops connection-only entries when connections are hidden', () => {
    expect(mapItems(ENTRIES, YUL, false).map(i => i.code)).toEqual(['LHR', 'BOS', 'KEF']);
  });

  it('uses in-scope flights first for the time', () => {
    const e = direct('LHR', [1, 1, 1, 1, 1, 1, 1], 500);
    e.flights = [flight(420)];
    expect(mapItems([e], YUL, false)[0].durationMin).toBe(420);
  });
});

describe('filter, sort and meta', () => {
  const items = mapItems(ENTRIES, YUL, true);

  it('searches city, country and code, accent-insensitively', () => {
    expect(filterItems(items, 'reykjavik').map(i => i.code)).toEqual(['KEF']);
    expect(filterItems(items, 'india').map(i => i.code)).toEqual(['DEL']);
    expect(filterItems(items, '  ')).toHaveLength(4);
    expect(filterItems(items, null)).toHaveLength(4);
  });

  it('sorts nonstops first, by distance or by time', () => {
    expect(sortItems(items, 'distance').map(i => i.code)).toEqual(['BOS', 'KEF', 'LHR', 'DEL']);
    expect(sortItems(items, 'time').map(i => i.code)).toEqual(['BOS', 'KEF', 'LHR', 'DEL']);
    const slowBos = mapItems([direct('BOS', [1, 0, 0, 0, 0, 0, 0], 999), ...ENTRIES.slice(2)], YUL, false);
    expect(sortItems(slowBos, 'time').map(i => i.code)).toEqual(['KEF', 'BOS']);
    const unknown = { ...items[0], durationMin: null } as MapItem;
    expect(sortItems([unknown, items[2]], 'time')[1]).toBe(unknown);
  });

  it('formats the meta line', () => {
    expect(itemMeta(items.find(i => i.code === 'KEF')!)).toBe('5h · 3 this week');
    expect(itemMeta(items.find(i => i.code === 'DEL')!)).toBe('15h · via YYZ');
    expect(itemMeta({ ...items[3], via: null, durationMin: null })).toBe('Connections only');
  });

  it('finds the nearest items of the same kind', () => {
    expect(nearestTo(items, 'KEF', 1)).toEqual(['LHR']);
    expect(nearestTo(items, 'KEF', 5)).toEqual(['LHR', 'BOS']);
    expect(nearestTo(items, 'DEL')).toEqual([]);
    expect(nearestTo(items, null)).toEqual([]);
    expect(nearestTo(items, 'XXX')).toEqual([]);
  });
});

describe('labelNeighbours and overviewItems', () => {
  const more = mapItems([...ENTRIES, direct('LGA', [1, 0, 0, 0, 0, 0, 0]), direct('EWR', [1, 0, 0, 0, 0, 0, 0]),
    direct('CDG', [1, 0, 0, 0, 0, 0, 0]), direct('AMS', [1, 0, 0, 0, 0, 0, 0])], YUL, true);

  it('skips neighbours too close to the selection or to each other', () => {
    expect(labelNeighbours(more, 'EWR', 2)).not.toContain('LGA');
    const kef = labelNeighbours(more, 'KEF', 2);
    expect(kef).toHaveLength(2);
    expect(kef).toContain('LHR');
    expect(kef).not.toContain('AMS'); // within 15% of 3,700 km of London
    expect(labelNeighbours(more, null)).toEqual([]);
    expect(labelNeighbours(more, 'DEL')).toEqual([]);
  });

  it('frames the nonstops, dropping the farthest quarter when there are many', () => {
    expect(overviewItems(more).map(i => i.code)).not.toContain('DEL');
    expect(overviewItems(more)).toHaveLength(7);
    const many = mapItems(['LHR', 'BOS', 'KEF', 'LGA', 'EWR', 'CDG', 'AMS', 'FCO', 'NRT', 'SYD'].map(c => direct(c, [1, 0, 0, 0, 0, 0, 0])), YUL, false);
    const ov = overviewItems(many).map(i => i.code);
    expect(ov).toHaveLength(8);
    expect(ov).not.toContain('SYD');
    expect(ov).not.toContain('NRT');
    const conn = mapItems([connecting('DEL', 900)], YUL, true);
    expect(overviewItems(conn)).toHaveLength(1);
  });
});

describe('outsideCoverage', () => {
  const c = { from: '2026-09-01', to: '2027-03-31' } as Parameters<typeof outsideCoverage>[0];
  it('is true only when the week (or day) is wholly outside', () => {
    expect(outsideCoverage(c, '2026-09-28', null)).toBe(false);
    expect(outsideCoverage(c, '2027-03-29', null)).toBe(false);
    expect(outsideCoverage(c, '2027-04-05', null)).toBe(true);
    expect(outsideCoverage(c, '2026-08-17', null)).toBe(true);
    expect(outsideCoverage(c, '2027-03-29', '2027-04-02')).toBe(true);
    expect(outsideCoverage(null, '2027-04-05', null)).toBe(false);
  });
});

describe('framing', () => {
  it('centres the box on the visible area and still covers the page', () => {
    const page = { w: 1280, h: 900 };
    const b = mapBox(page, { x: 412, y: 80, w: 868, h: 820 });
    expect(b.x + b.w / 2).toBeCloseTo(846, 0);
    expect(b.y + b.h / 2).toBeCloseTo(490, 0);
    expect(b.x).toBeLessThanOrEqual(0);
    expect(b.y).toBeLessThanOrEqual(0);
    expect(b.x + b.w).toBeGreaterThanOrEqual(page.w);
    expect(b.y + b.h).toBeGreaterThanOrEqual(page.h);
  });

  it('mirrors the route map fitted scale, including the empty case', () => {
    expect(fittedScale(HUB, [], { w: 300, h: 200 })).toBe(270);
    const s = fittedScale(HUB, [[-0.45, 51.47]], { w: 800, h: 600 });
    expect(s).toBeGreaterThan(800 / 5.5);
    // Two very close points are capped at 12× the world scale.
    expect(fittedScale(HUB, [[-73.7, 45.5]], { w: 550, h: 400 })).toBe(1200);
  });

  it('frames the hub and focus points inside the visible size', () => {
    const all: LngLat[] = [[-0.45, 51.47], [-22.6, 63.98], [139.78, 35.55]];
    const box = { w: 1736, h: 980 };
    const vis = { w: 868, h: 820 };
    const f = frameView(HUB, all, [[-22.6, 63.98], [-0.45, 51.47]], box, vis);
    expect(f.zoom).toBeGreaterThan(1);
    // Rebuild the route map's projection: every focus point lands inside the visible area.
    const p = geoNaturalEarth1()
      .scale(fittedScale(HUB, all, box) * f.zoom)
      .rotate([-f.center[0], 0]).center([0, f.center[1]]).translate([box.w / 2, box.h / 2]);
    for (const c of [HUB, [-22.6, 63.98], [-0.45, 51.47]] as const) {
      const [x, y] = p([c[0], c[1]])!;
      expect(Math.abs(x - box.w / 2)).toBeLessThanOrEqual(vis.w / 2);
      expect(Math.abs(y - box.h / 2)).toBeLessThanOrEqual(vis.h / 2);
    }
  });

  it('centres on the hub when there is nothing to frame, and caps the zoom', () => {
    const f = frameView(HUB, [], [], { w: 375, h: 812 }, { w: 375, h: 360 });
    expect(f.center).toEqual(HUB);
    const near = frameView(HUB, [[-73.7, 45.5]], [[-73.7, 45.5]], { w: 375, h: 812 }, { w: 375, h: 360 });
    expect(near.zoom).toBeLessThanOrEqual(12);
    expect(near.zoom).toBeGreaterThanOrEqual(0.6);
  });
});
