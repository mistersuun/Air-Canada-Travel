import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { LAND_FETCH, GeoService, topologyToLand } from '../state/geo.service';
import { RouteMapComponent, MapPoint } from './route-map.component';

const LAND = JSON.parse(readFileSync(`${process.cwd()}/public/data/land-110m.json`, 'utf8'));

const POINTS: MapPoint[] = [
  { code: 'LIS', lat: 38.77, lng: -9.13 },
  { code: 'NRT', lat: 35.77, lng: 140.39 },
  { code: 'ATH', lat: 37.94, lng: 23.94, kind: 'connect' },
];

let fetches = 0;

beforeEach(() => {
  fetches = 0;
  TestBed.configureTestingModule({
    providers: [{ provide: LAND_FETCH, useValue: () => { fetches++; return Promise.resolve(LAND); } }],
  });
});

async function render(inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(RouteMapComponent);
  fixture.componentRef.setInput('hub', 'YUL');
  fixture.componentRef.setInput('points', POINTS);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  await fixture.whenStable();
  await TestBed.inject(GeoService).ensureLoaded();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance };
}

function pointer(type: string, id: number, x: number, y: number): PointerEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }) as PointerEvent;
  Object.defineProperty(e, 'pointerId', { value: id });
  return e;
}

describe('topologyToLand', () => {
  it('turns world-atlas land into a FeatureCollection, and rejects junk', () => {
    const land = topologyToLand(LAND)!;
    expect(land.type).toBe('FeatureCollection');
    expect(land.features.length).toBeGreaterThan(0);
    expect(topologyToLand(null)).toBeNull();
    expect(topologyToLand({ type: 'Nope' })).toBeNull();
  });
});

describe('RouteMapComponent', () => {
  it('draws land, one arc and dot per point, the hub and its pulse, from one land fetch', async () => {
    const { el } = await render({ highlight: 'NRT', labels: ['NRT'] });
    await render(); // a second map reuses the land
    expect(fetches).toBe(1);
    expect(el.querySelector('path.land')?.getAttribute('d')?.length).toBeGreaterThan(1000);
    expect(el.querySelectorAll('path.arc')).toHaveLength(3);
    expect(el.querySelectorAll('path.arc.hot')).toHaveLength(1);
    expect(el.querySelectorAll('path.arc--connect')).toHaveLength(1);
    expect(el.querySelectorAll('circle.dotp')).toHaveLength(3);
    expect(el.querySelector('circle.dotp.hot')?.getAttribute('r')).toBe('4.5');
    expect(el.querySelector('circle.hub')).toBeTruthy();
    expect(el.querySelector('circle.pulse')).toBeTruthy();
    expect(el.querySelector('text.mlab')?.textContent).toBe('Tokyo Narita');
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toBe('Map of 3 routes from YUL, Tokyo Narita highlighted');
  });

  it('world view, no arcs and no pulse', async () => {
    const { el } = await render({ view: 'world', arcs: false, pulse: false });
    expect(el.querySelectorAll('path.arc')).toHaveLength(0);
    expect(el.querySelector('circle.pulse')).toBeNull();
    expect(el.querySelectorAll('circle.dotp')).toHaveLength(3);
  });

  it('fits a single point and honours an explicit centre', async () => {
    const { el, fixture } = await render({ points: [] });
    expect(el.querySelector('circle.hub')).toBeTruthy();
    fixture.componentRef.setInput('points', [{ code: 'BOS', lat: 42.36, lng: -71.0 }]);
    fixture.componentRef.setInput('center', [-73.74, 45.47]);
    await fixture.whenStable();
    const hub = el.querySelector('circle.hub')!;
    expect(Number(hub.getAttribute('cx'))).toBeCloseTo(160, 0);
    expect(Number(hub.getAttribute('cy'))).toBeCloseTo(90, 0);
  });

  it('emits point clicks and hovers', async () => {
    const { el, cmp } = await render();
    const clicks: string[] = [];
    const hovers: (string | null)[] = [];
    cmp.pointClick.subscribe(c => clicks.push(c));
    cmp.pointHover.subscribe(c => hovers.push(c));
    const hit = el.querySelectorAll<SVGCircleElement>('circle.hit')[1];
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    hit.dispatchEvent(new Event('pointerenter'));
    hit.dispatchEvent(new Event('pointerleave'));
    expect(clicks).toEqual(['NRT']);
    expect(hovers).toEqual(['NRT', null]);
  });

  it('interactive maps pan, zoom with the wheel and pinch, and reset', async () => {
    const { el, fixture, cmp } = await render({ interactive: true });
    const hub = () => Number(el.querySelector('circle.hub')!.getAttribute('cx'));
    const x0 = hub();
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointermove', 1, 130, 100));
    el.dispatchEvent(pointer('pointerup', 1, 130, 100));
    await fixture.whenStable();
    expect(hub()).toBeCloseTo(x0 + 30, 0);

    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    await fixture.whenStable();
    const zoomed = cmp.projection().scale();
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    await fixture.whenStable();
    expect(cmp.projection().scale()).toBeLessThan(zoomed);

    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 200, 100));
    const before = cmp.projection().scale();
    el.dispatchEvent(pointer('pointermove', 2, 300, 100));
    el.dispatchEvent(pointer('pointerup', 1, 100, 100));
    el.dispatchEvent(pointer('pointerup', 2, 300, 100));
    await fixture.whenStable();
    expect(cmp.projection().scale()).toBeGreaterThan(before);

    cmp.zoomBy(100);
    cmp.resetView();
    await fixture.whenStable();
    expect(hub()).toBeCloseTo(x0, 0);
  });

  it('ignores gestures when not interactive', async () => {
    const { el, fixture } = await render();
    const x0 = el.querySelector('circle.hub')!.getAttribute('cx');
    el.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    el.dispatchEvent(pointer('pointermove', 1, 200, 100));
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    await fixture.whenStable();
    expect(el.querySelector('circle.hub')!.getAttribute('cx')).toBe(x0);
  });
});

describe('RouteMapComponent plane and arc animation', () => {
  type Internals = { marker(): { x: number; y: number; angle: number } | null; hubXY(): number[] | null; hotList(): { code: string }[] };
  const internals = (c: unknown) => c as Internals;
  const SYD: MapPoint = { code: 'SYD', lat: -33.95, lng: 151.18 };

  function reduced(on: boolean): void {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true, writable: true,
      value: (q: string) => ({ matches: on && q.includes('reduce'), media: q }),
    });
  }

  it('draws the hot arc with the draw class and a glide plane, once per destination', async () => {
    reduced(false);
    const { el, fixture, cmp } = await render({ highlight: 'LIS' });
    expect(internals(cmp).hotList().map(h => h.code)).toEqual(['LIS']);
    const arc = el.querySelector('path.arc.hot')!;
    expect(arc.classList.contains('arc--draw')).toBe(true);
    expect(el.querySelectorAll('[data-glide]')).toHaveLength(1);
    // Unrelated change (zoom): the same element survives, so the animation does not replay.
    fixture.componentRef.setInput('zoom', 1.5);
    await fixture.whenStable();
    expect(el.querySelector('path.arc.hot')).toBe(arc);
    // A new destination replaces it.
    fixture.componentRef.setInput('highlight', 'NRT');
    await fixture.whenStable();
    expect(el.querySelector('path.arc.hot')).not.toBe(arc);
  });

  it('has no glide under reduced motion, with animate off, or with a progress marker', async () => {
    reduced(true);
    expect((await render({ highlight: 'LIS' })).el.querySelector('[data-glide]')).toBeNull();
    reduced(false);
    const off = await render({ highlight: 'LIS', animate: false });
    expect(off.el.querySelector('[data-glide]')).toBeNull();
    expect(off.el.querySelector('path.arc.hot')?.classList.contains('arc--draw')).toBe(false);
    expect((await render({ highlight: 'LIS', progress: 0.5 })).el.querySelector('[data-glide]')).toBeNull();
  });

  it('puts the progress plane on the hub at 0 and on the destination at 1', async () => {
    reduced(false);
    const a = await render({ highlight: 'LIS', progress: 0 });
    const m0 = internals(a.cmp).marker()!;
    expect([m0.x, m0.y]).toEqual(internals(a.cmp).hubXY());
    const b = await render({ highlight: 'LIS', progress: 1 });
    const dot = b.el.querySelector('circle.dotp.hot')!;
    const m1 = internals(b.cmp).marker()!;
    expect(m1.x).toBeCloseTo(Number(dot.getAttribute('cx')), 0);
    expect(m1.y).toBeCloseTo(Number(dot.getAttribute('cy')), 0);
    expect((await render({ highlight: 'LIS' })).el.querySelector('[data-progress-plane]')).toBeNull();
  });

  it('keeps a Vancouver to Sydney route on one side of the map, heading west (the short way over the Pacific)', async () => {
    reduced(false);
    for (const k of [0.1, 0.5, 0.9]) {
      const { cmp } = await render({ hub: 'YVR', points: [SYD], highlight: 'SYD', progress: k });
      const m = internals(cmp).marker()!;
      expect(m.x).toBeGreaterThan(0);
      expect(m.x).toBeLessThan(320);
      expect(Math.abs(m.angle)).toBeGreaterThan(90);
    }
  });
});
