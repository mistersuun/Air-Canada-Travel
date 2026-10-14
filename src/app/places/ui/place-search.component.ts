import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { DESTINATIONS, HUBS } from '../../data/destinations';
import { findDestination } from '../../utils/airports';
import type { Place } from '../../trips/model';
import { CityIndexService } from '../city-index.service';
import { placeFromDestination, placeFromHit } from '../place';

/** Search starts at this many characters (the same rule as Explore's Places). */
export const PLACE_SEARCH_MIN = 2;
/** The GeoNames city index is only fetched from this many characters. */
const CITY_INDEX_MIN = 3;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Air Canada destinations and hubs whose city or code starts with / contains the query, then city-index hits; no duplicates. */
export function searchPlaces(q: string, cityHits: readonly Place[], limit = 6, destinationsOnly = false): Place[] {
  const f = fold(q);
  if (f.length < PLACE_SEARCH_MIN) return [];
  const ac = [...DESTINATIONS.map(d => ({ code: d.code, city: d.city })), ...(destinationsOnly ? [] : HUBS.map(h => ({ code: h.code, city: h.name })))]
    .filter(a => fold(a.city).startsWith(f) || a.code.toLowerCase() === f)
    .map(a => placeFromDestination(a.code));
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const p of [...ac, ...cityHits]) {
    // Hubs are where trips start from; a trip to one has no destination page.
    if (destinationsOnly && p.acCode && !findDestination(p.acCode)) continue;
    const key = p.acCode ? `ac-${p.acCode}` : p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.acCode && !p.id.startsWith('ac-') ? placeFromDestination(p.acCode) : p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A place search field: Air Canada destinations first, then the lazy
 * GeoNames city index (loaded from 3 characters). Emits the chosen Place.
 * Used by "+ New trip" on Trips and "Add a stop" on the Plan tab.
 */
@Component({
  selector: 'app-place-search',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="ui-search ui-glass ps__f">
      <app-icon name="search" [size]="18" [strokeWidth]="2" />
      <span class="ui-visually-hidden">{{ label() }}</span>
      <input type="search" data-place-search autocomplete="off" enterkeyhint="search" [placeholder]="label()"
             [value]="q()" (input)="onInput($event)">
    </label>
    @if (rows().length) {
      <ul class="ps__l" data-place-results>
        @for (p of rows(); track p.id) {
          <li><button type="button" class="ps__r" [attr.data-place]="p.id" (click)="picked.emit(p)">
            <b>{{ p.name }}</b><span class="ui-sub">{{ where(p) }}</span></button></li>
        }
      </ul>
    }
    <div role="status" aria-live="polite">
      @if (!rows().length && q().trim().length >= 2) {
        <p class="ui-sub ps__none" data-place-none>No place found{{ loading() ? ' yet. Looking through more cities...' : destinationsOnly() ? '. Trips start from your hub, so pick where you are going.' : '. Try the city name.' }}</p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ps__f { display: flex; width: 100%; }
    .ps__f input { font-family: inherit; flex: 1; min-width: 0; }
    .ps__l { list-style: none; margin: 8px 0 0; padding: 0; display: grid; }
    .ps__r {
      display: grid; gap: 1px; width: 100%; min-height: 44px; padding: 8px 4px; text-align: left;
      border-bottom: 1px solid var(--line); cursor: pointer; font: inherit; color: var(--ink);
    }
    .ps__r b { font-weight: 650; }
    .ps__none { margin: 10px 2px 0; }
  `],
})
export class PlaceSearchComponent {
  private readonly cities = inject(CityIndexService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly label = input('Search a city or airport');
  /** Leave out the hubs (trips start from one, they are not somewhere to go to). */
  readonly destinationsOnly = input(false);
  /** Focus the field when it appears. */
  readonly autoFocus = input(true);
  readonly picked = output<Place>();

  protected readonly q = signal('');
  protected readonly loading = computed(() => this.cities.status() === 'loading');
  protected readonly rows = computed(() => {
    const q = this.q();
    const hits = q.trim().length >= CITY_INDEX_MIN && this.cities.status() === 'ready'
      ? this.cities.search(q, 6).map(placeFromHit) : [];
    return searchPlaces(q, hits, 6, this.destinationsOnly());
  });

  constructor() {
    afterNextRender(() => {
      if (this.autoFocus()) this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus();
    });
    effect(() => {
      if (this.q().trim().length >= CITY_INDEX_MIN) untracked(() => void this.cities.ensureLoaded());
    });
  }

  protected onInput(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
  }

  protected where(p: Place): string {
    return [p.admin1, p.country].filter(Boolean).join(', ') || (p.acCode ? `Airport ${p.acCode}` : '');
  }
}
