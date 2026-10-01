import {
  ChangeDetectionStrategy, booleanAttribute, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, linkedSignal,
  output, signal,
} from '@angular/core';
import { GeoProjection, geoNaturalEarth1, geoPath } from 'd3-geo';
import { findDestination, findHub } from '../utils/airports';
import { GeoService } from '../state/geo.service';

export interface MapPoint {
  code: string;
  lat: number;
  lng: number;
  kind?: 'direct' | 'connect';
}

interface Drawn {
  code: string;
  x: number;
  y: number;
  kind: 'direct' | 'connect';
  arc: string;
  hot: boolean;
}

/** Scale bounds relative to the fitted scale (zoom input × user zoom). */
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 12;
/** Pointer travel (px) before a press becomes a drag. */
export const DRAG_PX = 4;

/**
 * Route map: land, great-circle arcs from the hub, destination dots, labels
 * and a pulsing hub, drawn as one SVG with d3-geo (Natural Earth). Land comes
 * from data/land-110m.json via GeoService, so it works offline.
 *
 *   @defer (on viewport) {
 *     <app-route-map [hub]="state.hub()" [points]="pts" [highlight]="'LIS'" view="world" />
 *   } @placeholder { <div class="map-ph"></div> }   (a --sea block of the same size)
 *
 * The host fills its box: give it a height. With `interactive`, pointer drag
 * pans, the wheel and pinch zoom, and `resetView()` recentres.
 */
@Component({
  selector: 'app-route-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-interactive]': 'interactive()',
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'onUp($event)',
    '(wheel)': 'onWheel($event)',
  },
  template: `
    <svg [attr.viewBox]="'0 0 ' + w() + ' ' + h()" preserveAspectRatio="xMidYMid slice" role="img"
         [attr.aria-label]="ariaLabel()">
      <rect class="sea" [attr.width]="w()" [attr.height]="h()" />
      @if (landPath(); as d) { <path class="land" [attr.d]="d" /> }
      @if (arcs()) {
        @for (p of drawn(); track p.code) {
          @if (!p.hot) {
            <path class="arc" [class.arc--connect]="p.kind === 'connect'" [attr.d]="p.arc" />
          }
        }
        @if (hotPoint(); as p) { <path class="arc hot" [attr.d]="p.arc" /> }
      }
      @for (p of drawn(); track p.code) {
        <circle class="dotp" [class.dotp--connect]="p.kind === 'connect'" [class.hot]="p.hot"
                [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.hot ? 4.5 : 2.2" />
        <circle class="hit" [attr.cx]="p.x" [attr.cy]="p.y" r="10"
                (click)="pointClick.emit(p.code)" (pointerenter)="pointHover.emit(p.code)"
                (pointerleave)="pointHover.emit(null)"><title>{{ cityOf(p.code) }}</title></circle>
      }
      @for (l of labelled(); track l.code) {
        <text class="mlab" [attr.x]="l.x + 7" [attr.y]="l.y - 6">{{ l.text }}</text>
      }
      @if (hubXY(); as o) {
        @if (pulse()) { <circle class="pulse" [attr.cx]="o[0]" [attr.cy]="o[1]" r="9" /> }
        <circle class="hub" [attr.cx]="o[0]" [attr.cy]="o[1]" r="4.5" />
      }
    </svg>
  `,
  styles: [`
    :host { display: block; position: relative; overflow: hidden; background: var(--sea); min-height: 40px; user-select: none; }
    :host(.is-interactive) { touch-action: none; cursor: grab; }
    :host(.is-interactive:active) { cursor: grabbing; }
    svg { display: block; width: 100%; height: 100%; position: absolute; inset: 0; }
    .sea { fill: var(--sea); }
    .land { fill: var(--land); stroke: var(--surface); stroke-width: .7; }
    .arc { fill: none; stroke: var(--blue); stroke-width: 1; opacity: .45; }
    .arc--connect { stroke: var(--amber); stroke-dasharray: 3 3; }
    .arc.hot { stroke: var(--red); stroke-width: 2.2; opacity: 1; }
    .dotp { fill: var(--surface); stroke: var(--blue); stroke-width: 1.4; }
    .dotp--connect { stroke: var(--amber); }
    .dotp.hot { stroke: var(--red); }
    .hit { fill: transparent; cursor: pointer; }
    .mlab { font-size: 11px; font-weight: 600; fill: var(--ink); paint-order: stroke; stroke: var(--sea); stroke-width: 3px; pointer-events: none; }
    .hub { fill: var(--blue); stroke: var(--surface); stroke-width: 2; }
    .pulse {
      fill: var(--blue); opacity: .25; pointer-events: none;
      animation: ui-pulse 2s ease-out infinite; transform-box: fill-box; transform-origin: center;
    }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; opacity: 0; } }
  `],
})
export class RouteMapComponent {
  private readonly geo = inject(GeoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly hub = input.required<string>();
  readonly points = input<readonly MapPoint[]>([]);
  readonly highlight = input<string | null>(null);
  readonly labels = input<readonly string[]>([]);
  readonly view = input<'world' | 'fit'>('fit');
  /** [lng, lat] to centre on (overrides the fitted centre). */
  readonly center = input<readonly [number, number] | null>(null);
  readonly zoom = input(1);
  readonly padding = input(16);
  readonly arcs = input(true, { transform: booleanAttribute });
  readonly pulse = input(true, { transform: booleanAttribute });
  readonly interactive = input(false, { transform: booleanAttribute });

  readonly pointClick = output<string>();
  readonly pointHover = output<string | null>();

  protected readonly w = signal(320);
  protected readonly h = signal(180);

  /** User pan (px) and zoom, reset whenever the inputs that frame the view change. */
  private readonly userView = linkedSignal({
    source: () => [this.center(), this.zoom(), this.view(), this.hub()] as const,
    computation: () => ({ dx: 0, dy: 0, k: 1 }),
  });

  private readonly hubLngLat = computed<[number, number]>(() => {
    const h = findHub(this.hub()) ?? findDestination(this.hub());
    return h ? [h.lng, h.lat] : [-73.74, 45.47];
  });

  readonly projection = computed<GeoProjection>(() => {
    const w = this.w();
    const h = this.h();
    const pad = Math.min(this.padding(), w / 4, h / 4);
    const p = geoNaturalEarth1();
    if (this.view() === 'world') {
      p.fitWidth(w, { type: 'Sphere' });
      p.center([-10, 25]).translate([w / 2, h / 2]);
    } else {
      const coords = [this.hubLngLat(), ...this.points().map(pt => [pt.lng, pt.lat] as [number, number])];
      if (coords.length < 2) {
        p.scale(w * 0.9).center([0, 0]).rotate([-coords[0][0], 0]).center([0, coords[0][1]]).translate([w / 2, h / 2]);
      } else {
        p.fitExtent([[pad, pad], [w - pad, h - pad]], { type: 'MultiPoint', coordinates: coords });
        // Very close points would zoom to street level: cap at ~12× the world scale.
        const worldScale = w / 5.5;
        if (p.scale() > worldScale * 12) {
          const c = p.invert!([w / 2, h / 2])!;
          p.scale(worldScale * 12).center(c).translate([w / 2, h / 2]);
        }
      }
    }
    const c = this.center();
    if (c) p.center([0, 0]).translate([w / 2, h / 2]).rotate([-c[0], 0]).center([0, c[1]]);
    const v = this.userView();
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom() * v.k));
    const [tx, ty] = p.translate();
    p.scale(p.scale() * k);
    // Zoom about the viewport centre, then pan.
    p.translate([w / 2 + (tx - w / 2) * k + v.dx, h / 2 + (ty - h / 2) * k + v.dy]);
    return p;
  });

  protected readonly landPath = computed(() => {
    const land = this.geo.land();
    return land ? geoPath(this.projection())(land) : null;
  });

  protected readonly drawn = computed<Drawn[]>(() => {
    const p = this.projection();
    const path = geoPath(p);
    const origin = this.hubLngLat();
    const hot = this.highlight();
    const out: Drawn[] = [];
    for (const pt of this.points()) {
      const xy = p([pt.lng, pt.lat]);
      if (!xy) continue;
      out.push({
        code: pt.code,
        x: round(xy[0]),
        y: round(xy[1]),
        kind: pt.kind ?? 'direct',
        hot: pt.code === hot,
        arc: path({ type: 'LineString', coordinates: [origin, [pt.lng, pt.lat]] }) ?? '',
      });
    }
    return out;
  });

  protected readonly hotPoint = computed(() => this.drawn().find(d => d.hot) ?? null);

  protected readonly labelled = computed(() => {
    const want = new Set(this.labels());
    return this.drawn()
      .filter(d => want.has(d.code))
      .map(d => ({ code: d.code, x: d.x, y: d.y, text: this.cityOf(d.code) }));
  });

  protected readonly hubXY = computed(() => {
    const xy = this.projection()(this.hubLngLat());
    return xy ? [round(xy[0]), round(xy[1])] : null;
  });

  protected readonly ariaLabel = computed(() => {
    const n = this.points().length;
    const hot = this.highlight();
    const base = `Map of ${n} route${n === 1 ? '' : 's'} from ${this.hub()}`;
    return hot ? `${base}, ${this.cityOf(hot)} highlighted` : base;
  });

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private moved = false;
  private captureEl: Element | null = null;

  constructor() {
    void this.geo.ensureLoaded();
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const measure = () => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          this.w.set(Math.round(r.width));
          this.h.set(Math.round(r.height));
        }
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected cityOf(code: string): string {
    return findDestination(code)?.city ?? code;
  }

  /** Back to the framed view (the locate button). */
  resetView(): void {
    this.userView.set({ dx: 0, dy: 0, k: 1 });
  }

  /**
   * Zoom by a factor about the centre (+/- buttons). The user factor is
   * clamped against the framed [zoom], so the effective scale covers
   * [MIN_ZOOM, MAX_ZOOM] with no dead presses at either end.
   */
  zoomBy(f: number): void {
    const v = this.userView();
    const base = this.zoom() || 1;
    const k = Math.min(MAX_ZOOM / base, Math.max(MIN_ZOOM / base, v.k * f));
    if (k === v.k) return;
    const r = k / v.k;
    this.userView.set({ dx: v.dx * r, dy: v.dy * r, k });
  }

  protected onDown(e: PointerEvent): void {
    if (!this.interactive()) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = false;
    // Capture only once a drag starts (onMove): capturing here would send the
    // click to the host instead of the dot under the pointer.
    this.captureEl = e.currentTarget as Element | null;
  }

  private capture(id: number): void {
    try {
      this.captureEl?.setPointerCapture?.(id);
    } catch {
      // The pointer may already be gone (NotFoundError): nothing to capture.
    }
  }

  protected onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!this.interactive() || !prev) return;
    const v = this.userView();
    if (this.pointers.size === 2) {
      this.moved = true;
      this.capture(e.pointerId);
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) this.zoomBy(after / before);
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      // A few pixels of jitter is still a tap on a dot.
      if (!this.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!this.moved) {
        this.moved = true;
        this.capture(e.pointerId);
      }
      this.userView.set({ ...v, dx: v.dx + dx, dy: v.dy + dy });
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  protected onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.moved) e.preventDefault();
  }

  protected onWheel(e: WheelEvent): void {
    if (!this.interactive()) return;
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
