import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { HubStats, RouteEntry } from '../../utils/routes';
import { MapPoint, RouteMapComponent } from '../../ui/route-map.component';

/**
 * "This week from YUL" (desktop hero, right column): three bento stats and a
 * world mini map with the hub's nonstop arcs, the first pick highlighted.
 */
@Component({
  selector: 'app-week-card',
  standalone: true,
  imports: [RouteMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wc ui-card ui-glass" aria-labelledby="wc-title">
      <div class="ui-sec-h"><h2 class="ui-h3" id="wc-title">This week from {{ hub() }}</h2><span class="ui-tag ui-tag--blue tn">{{ range() }}</span></div>
      <div class="bento">
        @for (t of tiles(); track t.label) {
          <div class="tile"><b class="tn">{{ t.value }}</b><span>{{ t.label }}</span></div>
        }
      </div>
      <div class="map">
        @defer (on viewport) {
          <app-route-map [hub]="hub()" [points]="points()" [highlight]="highlight()" view="world" [padding]="10" />
        } @placeholder {
          <div class="map-ph"></div>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .wc { padding: 18px; }
    .ui-sec-h { margin-bottom: 8px; align-items: center; }
    .bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .tile { background: var(--surface); border-radius: 14px; padding: 10px 12px; min-width: 0; }
    .tile b { display: block; font-size: 24px; font-weight: 650; letter-spacing: -.02em; line-height: 1.2; }
    .tile span { display: block; font-size: 11.5px; color: var(--ink-2); }
    .map { height: 150px; border-radius: 16px; margin-top: 10px; overflow: hidden; background: var(--sea); }
    .map app-route-map, .map-ph { display: block; width: 100%; height: 100%; }
  `],
})
export class WeekCardComponent {
  readonly hub = input.required<string>();
  /** 'Oct 1 – 7'. */
  readonly range = input('');
  readonly stats = input<HubStats | null>(null);
  readonly entries = input<readonly RouteEntry[]>([]);
  readonly highlight = input<string | null>(null);

  protected readonly tiles = computed(() => {
    const s = this.stats();
    return [
      // All three count nonstop flying only, so the figures agree.
      { value: s?.directDestinations ?? 0, label: 'destinations' },
      { value: s?.directCountries ?? 0, label: 'countries' },
      { value: s?.flightsThisWeek ?? 0, label: 'departures' },
    ];
  });

  protected readonly points = computed<MapPoint[]>(() =>
    this.entries()
      .filter(e => e.isDirect)
      .map(e => ({ code: e.destination.code, lat: e.destination.lat, lng: e.destination.lng, kind: 'direct' as const })),
  );
}
