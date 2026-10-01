import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { DestRowComponent } from '../../ui/dest-row.component';
import { destPath } from '../../ui/links';
import { MapPoint, RouteMapComponent } from '../../ui/route-map.component';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { formatKm } from '../../utils/geo';
import { diffDays } from '../../utils/time';
import {
  filterItems, frameView, itemMeta, labelNeighbours, LngLat, MapItem, mapBox, mapItems, MapSort, MAP_SORTS,
  outsideCoverage, overviewItems, Rect, sortItems,
} from './map-model';

/** Below this width the list is a bottom sheet; above, a floating panel on the left. */
const SHEET_QUERY_PX = 720;
/** Collapsed sheet height (the mockup's 390px), capped at half a short screen. */
const sheetHeight = (h: number) => Math.min(390, Math.round(h * 0.5));

/**
 * Map `/map`: every destination from the hub as an arc on a full-bleed,
 * pannable map, with a list that stays in sync with it.
 *
 *  - `?sel=CODE` is the selected destination (red arc, labelled with its two
 *    nearest neighbours, tinted row). Picking a row frames the map on it;
 *    tapping a dot only selects. Tapping the selected row again (or its ›)
 *    opens /to/CODE.
 *  - `?sort=time` sorts by flight time; distance (great-circle km) is the default.
 *  - The search writes the global `q`, so it filters the list and the points.
 *  - Mobile: a glass bottom sheet (390px, drag or tap the handle for 75vh).
 *    Desktop: a 380px glass panel on the left, the map framed in the rest.
 */
@Component({
  selector: 'app-map-page',
  standalone: true,
  imports: [RouterLink, IconComponent, DestRowComponent, RouteMapComponent, SegComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="sr-only">Route map</h1>
    <div class="box" [style.left.px]="box().x" [style.top.px]="box().y" [style.width.px]="box().w" [style.height.px]="box().h">
      <app-route-map #rmap class="map" interactive view="fit" [hub]="state.hub()" [points]="points()"
                     [highlight]="hot()" [labels]="labels()" [center]="frame().center" [zoom]="frame().zoom"
                     (pointClick)="pick($event, false)" (pointHover)="hovered.set($event)" />
    </div>

    <div class="top">
      <label class="ui-search ui-glass search">
        <app-icon name="search" [size]="17" />
        <input type="search" data-search-input placeholder="Search the map" aria-label="Search the map"
               autocomplete="off" enterkeyhint="search" [value]="state.query()" (input)="onSearch($event)" />
        @if (state.query()) {
          <button type="button" class="clear" aria-label="Clear search" (click)="state.setQuery('')">
            <app-icon name="close" [size]="15" />
          </button>
        }
      </label>
      <button type="button" class="ui-circ ui-circ--glass locate m-only" aria-label="Recentre on {{ state.hubName() }}"
              (click)="locate()">
        <app-icon name="locate" [size]="19" [strokeWidth]="2" />
      </button>
    </div>

    <div class="ctrls d-only">
      <button type="button" class="ui-circ ui-circ--glass" aria-label="Recentre on {{ state.hubName() }}" (click)="locate()">
        <app-icon name="locate" [size]="19" [strokeWidth]="2" />
      </button>
      <button type="button" class="ui-circ ui-circ--glass zm" aria-label="Zoom in" (click)="zoom(1.5)">+</button>
      <button type="button" class="ui-circ ui-circ--glass zm" aria-label="Zoom out" (click)="zoom(1 / 1.5)">−</button>
    </div>

    <section class="panel ui-glass" [class.is-open]="expanded()" aria-labelledby="map-count">
      <button type="button" class="handle m-only" [attr.aria-label]="expanded() ? 'Collapse list' : 'Expand list'"
              [attr.aria-expanded]="expanded()" (pointerdown)="dragStart($event)" (pointerup)="dragEnd($event)"
              (keydown.enter)="toggle()" (keydown.space)="$event.preventDefault(); toggle()"><i></i></button>
      <div class="hd">
        <h2 id="map-count" class="ui-h3 tn">{{ countLabel() }}</h2>
        <app-seg [options]="sortOptions" [value]="sort()" (valueChange)="setSort($event)" ariaLabel="Sort by" />
      </div>
      <div #list class="list">
        @for (i of listed(); track i.code) {
          @if ($index === firstConnect()) {
            <h3 class="grp ui-label">Connections only · {{ connectCount() }}</h3>
          }
          <app-dest-row [attr.data-code]="i.code" [code]="i.code" [small]="km(i)" [meta]="meta(i)" [dots]="i.dots"
                        [selectedDay]="dayIndex()" [highlight]="i.code === sel()" [chevron]="false"
                        role="button" tabindex="0" [attr.aria-pressed]="i.code === sel()"
                        [attr.aria-label]="rowLabel(i)" (click)="onRow(i.code)"
                        (keydown.enter)="onRow(i.code)" (keydown.space)="$event.preventDefault(); onRow(i.code)"
                        (mouseenter)="hovered.set(i.code)" (mouseleave)="hovered.set(null)"
                        (focus)="hovered.set(i.code)" (blur)="hovered.set(null)">
            @if (i.code === sel()) {
              <a trailing class="open" [routerLink]="open(i.code)" [queryParams]="state.globalParams()"
                 [attr.aria-label]="'Open ' + i.city" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">›</a>
            }
          </app-dest-row>
        } @empty {
          <div class="empty">
            @if (state.query()) {
              <p class="ui-sub">No destinations match “{{ state.query() }}”.</p>
              <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="state.setQuery('')">Clear search</button>
            } @else if (outside()) {
              <p class="ui-sub">Schedules for this week aren’t published yet.</p>
              <button type="button" class="ui-btn ui-btn--sm" (click)="state.jumpToCoverage()">Go to last published week</button>
            } @else {
              <p class="ui-sub">No flights from {{ state.hubName() }} {{ state.selectedDateKey() ? 'on this day' : 'this week' }}.</p>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block; position: relative; height: 100vh; height: 100dvh; overflow: hidden;
      background: var(--sea); contain: strict; width: 100%;
    }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .box { position: absolute; }
    .map { position: absolute; inset: 0; }

    .top {
      position: absolute; z-index: 5; display: flex; gap: 8px;
      top: calc(env(safe-area-inset-top) + 12px); left: 16px; right: 16px;
    }
    .search { flex: 1; height: 44px; font-size: 14px; padding: 0 6px 0 14px; color: var(--ink-3); }
    .search input { font-size: 14px; }
    .clear { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--ink-2); flex: none; }
    .clear:hover { background: var(--fill); }
    .locate { width: 44px; height: 44px; }

    .ctrls { position: absolute; z-index: 5; right: 24px; bottom: 24px; display: flex; flex-direction: column; gap: 8px; }
    .zm { font-size: 22px; font-weight: 500; line-height: 1; }

    .panel {
      position: absolute; z-index: 4; display: flex; flex-direction: column; min-height: 0;
      left: 0; right: 0; bottom: 0; height: min(390px, 50dvh);
      border-radius: 30px 30px 0 0; padding: 10px 18px 0; border-bottom: 0;
      box-shadow: 0 -10px 30px -18px rgba(11, 18, 32, .25);
      transition: height var(--dur) var(--ease-out);
    }
    .panel.is-open { height: 75dvh; }
    .handle { display: block; width: 100%; padding: 0 0 12px; touch-action: none; cursor: grab; flex: none; }
    .handle i { display: block; width: 36px; height: 5px; border-radius: 3px; background: var(--hair); margin: 0 auto; }
    .hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex: none; }
    .hd h2 { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .list {
      position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
      margin: 4px -18px 0; padding: 0 18px calc(110px + env(safe-area-inset-bottom));
      scrollbar-width: thin;
    }
    app-dest-row { cursor: pointer; border-radius: 14px; }
    app-dest-row:focus-visible { outline: 2px solid var(--blue); outline-offset: 0; }
    .open {
      flex: none; width: 28px; height: 28px; margin-left: 6px; border-radius: 50%;
      display: grid; place-items: center; font-size: 20px; line-height: 1; color: var(--red);
      background: color-mix(in srgb, var(--red) 12%, transparent);
    }
    .open:hover { background: color-mix(in srgb, var(--red) 20%, transparent); }
    .grp { margin: 18px 0 2px; color: var(--ink-2); }
    :host ::ng-deep app-route-map .arc--connect { opacity: .2; }
    :host ::ng-deep app-route-map .dotp--connect:not(.hot) { opacity: .7; }
    .empty { padding: 28px 0; text-align: center; display: grid; justify-items: center; gap: 12px; }
    .empty p { margin: 0; }

    .d-only { display: none; }
    @media (min-width: 720px) {
      .m-only { display: none; }
      .d-only { display: flex; }
      .top { top: 96px; left: 40px; right: auto; width: 324px; }
      .search { background: var(--fill); border-color: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
      .panel {
        top: 96px; bottom: 24px; left: 24px; right: auto; width: 340px; height: auto;
        border-radius: 22px; padding: 64px 16px 0; border-bottom: 1px solid var(--glass-b);
        box-shadow: var(--shadow);
      }
      .panel.is-open { height: auto; }
      .hd { padding: 0 2px; }
      .list { margin: 6px -16px 0; padding: 0 16px 16px; }
    }
    @media (min-width: 1024px) {
      .top { left: 48px; width: 348px; }
      .panel { left: 32px; width: 380px; }
    }
    @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
  `],
})
export class MapPage {
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** ?sel= (selected destination) and ?sort= (distance | time), bound by withComponentInputBinding. */
  readonly selParam = input<string | undefined>(undefined, { alias: 'sel' });
  readonly sortParam = input<string | undefined>(undefined, { alias: 'sort' });

  protected readonly map = viewChild<RouteMapComponent>('rmap');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly sortOptions: readonly SegOption[] = [
    { value: 'distance', label: 'Distance' },
    { value: 'time', label: 'Time' },
  ];

  /** Page size (measured), drives the framing maths. */
  private readonly size = signal({ w: 375, h: 812 });
  protected readonly hovered = signal<string | null>(null);
  protected readonly expanded = signal(false);
  /**
   * The destination the map is framed on: undefined follows ?sel= (first
   * load), null frames everything listed (locate), a code frames that one.
   */
  private readonly framedOn = signal<string | null | undefined>(undefined);

  protected readonly sort = computed<MapSort>(() => {
    const s = this.sortParam();
    return (MAP_SORTS as readonly string[]).includes(s ?? '') ? (s as MapSort) : 'distance';
  });

  private readonly items = computed(() =>
    mapItems(this.state.allRoutes(), this.state.hubInfo(), this.state.showConnections()));

  protected readonly listed = computed(() => sortItems(filterItems(this.items(), this.state.query()), this.sort()));

  protected readonly sel = computed(() => {
    const code = this.selParam()?.toUpperCase() ?? null;
    return code && this.listed().some(i => i.code === code) ? code : null;
  });

  protected readonly hot = computed(() => this.hovered() ?? this.sel());

  protected readonly points = computed<MapPoint[]>(() =>
    this.listed().map(i => ({ code: i.code, lat: i.lat, lng: i.lng, kind: i.kind })));

  protected readonly labels = computed(() => {
    const out = new Set<string>();
    const h = this.hovered();
    if (h) out.add(h);
    const s = this.sel();
    if (s) {
      out.add(s);
      for (const c of labelNeighbours(this.listed(), s, 2)) out.add(c);
    }
    return [...out];
  });

  protected readonly dayIndex = computed(() => {
    const d = this.state.selectedDateKey();
    if (!d) return null;
    const i = diffDays(this.state.weekStartKey(), d);
    return i >= 0 && i < 7 ? i : null;
  });

  protected readonly outside = computed(() =>
    outsideCoverage(this.state.coverage(), this.state.weekStartKey(), this.state.selectedDateKey()));

  /** Index of the first connection-only row (a sub-header goes above it), or -1. */
  protected readonly firstConnect = computed(() => this.listed().findIndex(i => i.kind === 'connect'));

  protected readonly connectCount = computed(() => this.listed().filter(i => i.kind === 'connect').length);

  protected readonly countLabel = computed(() => {
    const all = this.listed().length;
    const direct = all - this.connectCount();
    const n = direct || all;
    return `${n} destination${n === 1 ? '' : 's'}`;
  });

  /** The part of the page the list does not cover. */
  private readonly visible = computed<Rect>(() => {
    const { w, h } = this.size();
    if (w < SHEET_QUERY_PX) {
      const top = 64;
      return { x: 0, y: top, w, h: Math.max(80, h - sheetHeight(h) - top) };
    }
    const left = w >= 1024 ? 32 + 380 : 24 + 340;
    const top = 80;
    return { x: left, y: top, w: Math.max(80, w - left), h: Math.max(80, h - top) };
  });

  protected readonly box = computed(() => mapBox(this.size(), this.visible()));

  protected readonly frame = computed(
    () => {
      const hub = this.state.hubInfo();
      const hubLL: LngLat = [hub.lng, hub.lat];
      const listed = this.listed();
      const all = listed.map(i => [i.lng, i.lat] as LngLat);
      const on = this.framedOn() === undefined ? this.sel() : this.framedOn();
      const focusItem = on ? listed.find(i => i.code === on) : null;
      let focus: LngLat[] = overviewItems(listed).map(i => [i.lng, i.lat] as LngLat);
      if (focusItem) {
        const near = new Set(labelNeighbours(listed, focusItem.code, 2));
        focus = listed.filter(i => i === focusItem || near.has(i.code)).map(i => [i.lng, i.lat] as LngLat);
      }
      const vis = this.visible();
      const inset = this.size().w < SHEET_QUERY_PX ? { x: 64, y: 36 } : { x: 96, y: 56 };
      return frameView(hubLL, all, focus, this.box(), { w: vis.w, h: vis.h }, inset);
    },
    { equal: (a, b) => a.zoom === b.zoom && a.center[0] === b.center[0] && a.center[1] === b.center[1] },
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const measure = () => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) this.size.set({ w: Math.round(r.width), h: Math.round(r.height) });
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
      const s = untracked(this.sel);
      if (s) this.scrollToRow(s, 'auto');
    });
  }

  protected km(i: MapItem): string {
    return formatKm(i.km);
  }

  protected meta(i: MapItem): string {
    return itemMeta(i);
  }

  protected rowLabel(i: MapItem): string {
    const sel = i.code === this.sel();
    return `${i.city}, ${formatKm(i.km)}, ${itemMeta(i)}${sel ? '. Selected; press again to open' : ''}`;
  }

  protected open(code: string): string[] {
    return destPath(code);
  }

  protected onSearch(e: Event): void {
    this.state.setQuery((e.target as HTMLInputElement).value);
  }

  protected setSort(v: string | undefined): void {
    this.writeParams({ sort: !v || v === 'distance' ? null : v });
  }

  /** A row: select and frame it, or open it when it is already selected. */
  protected onRow(code: string): void {
    if (code === this.sel()) {
      void this.router.navigate(destPath(code), { queryParams: this.state.globalParams() });
      return;
    }
    this.pick(code, true);
  }

  /** Select a destination; from the list also frame the map on it, from the map bring its row into view. */
  protected pick(code: string, frame: boolean): void {
    if (frame) {
      this.framedOn.set(code);
      this.map()?.resetView();
    } else {
      this.scrollToRow(code, 'smooth');
    }
    this.writeParams({ sel: code });
  }

  /** ◎: frame everything listed again and drop any pan or zoom. */
  protected locate(): void {
    this.framedOn.set(null);
    this.map()?.resetView();
  }

  protected zoom(f: number): void {
    this.map()?.zoomBy(f);
  }

  protected toggle(): void {
    this.expanded.update(v => !v);
  }

  private dragY: number | null = null;

  protected dragStart(e: PointerEvent): void {
    this.dragY = e.clientY;
  }

  /** Drag the handle up to expand, down to collapse; a plain tap toggles. */
  protected dragEnd(e: PointerEvent): void {
    if (this.dragY === null) return;
    const dy = e.clientY - this.dragY;
    this.dragY = null;
    if (dy < -24) this.expanded.set(true);
    else if (dy > 24) this.expanded.set(false);
    else this.toggle();
  }

  private scrollToRow(code: string, behavior: ScrollBehavior): void {
    const list = this.listEl()?.nativeElement;
    const row = list?.querySelector<HTMLElement>(`[data-code="${code}"]`);
    if (!list || !row) return;
    const top = row.offsetTop;
    const room = list.clientHeight - parseFloat(getComputedStyle(list).paddingBottom || '0');
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + room) {
      // Leave about a third of the visible list above the row for context.
      list.scrollTo?.({ top: Math.max(0, top - Math.round(room / 3)), behavior });
    }
  }

  private writeParams(params: Record<string, string | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
