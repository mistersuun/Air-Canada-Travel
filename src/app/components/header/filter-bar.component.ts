import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { HUBS, REGIONS, TYPES } from '../../data/destinations';
import type { DestinationType } from '../../data/destinations';
import { DEPART_WINDOWS, EMPTY_FILTERS, Filters, STARRED_REGION, SortKey } from '../../utils/routes';
import { regionVar } from '../../utils/region-color';
import { IconComponent } from '../shared/icons.component';
import { FilterPopoverComponent, SORT_OPTIONS } from './filter-popover.component';

export interface ActiveChip {
  id: string;
  label: string;
  remove: () => void;
}

/**
 * Filter row: Direct only / Include connections segmented control, region
 * and type chips in an edge-faded scroll row, a Filters button (badge) that
 * opens the filter sheet, and a row of removable active-filter chips with
 * "Clear all".
 */
@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [IconComponent, FilterPopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fb">
      <div class="ui-scroll-row fb__scroll" role="group" aria-label="Filters">
        <div class="fb__seg" role="group" aria-label="Flight type">
          <span class="fb__thumb" [class.is-right]="showConnections()" aria-hidden="true"></span>
          <button type="button" [attr.aria-pressed]="!showConnections()" (click)="setConnections(false)" aria-label="Direct only">Direct</button>
          <button type="button" [attr.aria-pressed]="showConnections()" (click)="setConnections(true)" aria-label="Include connections">+ Connections</button>
        </div>
        <span class="fb__sep" aria-hidden="true"></span>
        @for (r of regions; track r) {
          <button type="button" class="ui-pill fb__region" [class.fb__region--dot]="!!regionColor(r)"
                  [style.--c]="regionColor(r)" [attr.aria-pressed]="region() === r"
                  (click)="regionChange.emit(region() === r && r !== 'All' ? 'All' : r)">
            @if (r === starred) { <app-icon name="star" [size]="14" [filled]="region() === r" /> }
            {{ r === 'All' ? 'All regions' : r }}
          </button>
        }
        <span class="fb__sep" aria-hidden="true"></span>
        @for (t of types; track t) {
          <button type="button" class="ui-pill" [attr.aria-pressed]="filters().types.includes(t)" (click)="toggleType(t)">{{ t }}</button>
        }
      </div>
      <button type="button" class="fb__more" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
              [attr.aria-label]="'Filter and sort' + (sheetCount() ? ', ' + sheetCount() + ' active' : '')">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
        <span class="fb__more-label">Filters</span>
        @if (sheetCount()) { <span class="fb__badge ui-num" aria-hidden="true">{{ sheetCount() }}</span> }
      </button>
    </div>

    @if (chips().length) {
      <div class="ui-scroll-row fb__active" role="group" aria-label="Active filters">
        @for (c of chips(); track c.id) {
          <button type="button" class="fb__chip" (click)="c.remove()" [attr.aria-label]="'Remove ' + c.label">
            {{ c.label }}<app-icon name="close" [size]="13" />
          </button>
        }
        <button type="button" class="fb__clear" (click)="clearFilters.emit()">Clear all</button>
      </div>
    }

    @if (sheetOpen()) {
      <app-filter-popover
        [filters]="filters()" [sort]="sort()" [selectedDateKey]="selectedDateKey()" [hubCode]="hubCode()"
        [showConnections]="showConnections()" [routeCount]="routeCount()"
        (filtersChange)="filtersChange.emit($event)" (sortChange)="sortChange.emit($event)"
        (closed)="sheetOpen.set(false)" />
    }
  `,
  styles: [`
    :host { display: block; }
    .fb { display: flex; align-items: center; gap: var(--space-2); padding-right: var(--gutter); }
    .fb__scroll { flex: 1; min-width: 0; align-items: center; padding-block: 2px; }
    .fb__sep { flex-shrink: 0; width: 1px; height: 20px; background: var(--line); }
    .fb__seg {
      position: relative; flex-shrink: 0; display: grid; grid-template-columns: 1fr 1fr; padding: 2px;
      border-radius: var(--radius-chip); background: var(--surface-2); border: 1px solid var(--line);
    }
    .fb__seg button {
      position: relative; z-index: 1; height: 28px; padding: 0 10px; border: 0; background: none; border-radius: var(--radius-chip);
      font-size: 13px; font-weight: 600; color: var(--ink-2); white-space: nowrap; cursor: pointer;
      transition: color var(--dur) var(--ease-out);
    }
    .fb__seg button[aria-pressed='true'] { color: var(--ink); }
    .fb__thumb {
      position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc(50% - 2px); border-radius: var(--radius-chip);
      background: var(--surface); box-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 18%, transparent);
      transition: transform var(--dur) var(--ease-out);
    }
    .fb__thumb.is-right { transform: translateX(100%); }
    .fb__region { flex-shrink: 0; }
    .fb__region--dot::before {
      content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--c);
    }
    .ui-pill { flex-shrink: 0; }
    .fb__more {
      position: relative; flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px;
      border-radius: var(--radius-chip); border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink);
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .fb__more:hover { background: var(--surface-2); }
    .fb__badge {
      display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
      background: var(--accent-fill); color: var(--accent-ink); font-size: 11px; font-weight: 700;
    }
    .fb__active { margin-top: var(--space-2); align-items: center; }
    .fb__chip {
      flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px 0 11px;
      border-radius: var(--radius-chip); border: 0; background: var(--accent-soft); color: var(--accent-strong);
      font-size: 12.5px; font-weight: 600; white-space: nowrap; cursor: pointer;
    }
    .fb__chip:hover { background: color-mix(in srgb, var(--accent-fill) 22%, transparent); }
    .fb__clear {
      flex-shrink: 0; height: 28px; padding: 0 8px; border: 0; background: none; color: var(--ink-2);
      font-size: 12.5px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
    }
    @media (max-width: 420px) {
      .fb__more-label { display: none; }
      .fb__more { padding: 0 10px; }
    }
  `],
})
export class FilterBarComponent {
  readonly filters = input<Filters>(EMPTY_FILTERS);
  readonly region = input('All');
  readonly showConnections = input(true);
  readonly query = input('');
  readonly sort = input<SortKey>('az');
  readonly selectedDateKey = input<string | null>(null);
  readonly hubCode = input('');
  readonly routeCount = input(0);

  readonly filtersChange = output<Filters>();
  readonly regionChange = output<string>();
  readonly showConnectionsChange = output<boolean>();
  readonly queryChange = output<string>();
  readonly sortChange = output<SortKey>();
  readonly clearFilters = output<void>();

  protected readonly sheetOpen = signal(false);
  protected readonly starred = STARRED_REGION;
  /** 'All', 'Starred', then the geographic regions. */
  protected readonly regions = ['All', STARRED_REGION, ...REGIONS.filter(r => r !== 'All')];
  protected readonly types = TYPES.filter(t => t !== 'All') as DestinationType[];

  /** Filters that live in the sheet (the badge on the Filters button). */
  readonly sheetCount = computed(() => {
    const f = this.filters();
    return f.departWindows.length + f.viaHubs.length + (f.sameDayArrival ? 1 : 0) + (f.widebodyOnly ? 1 : 0)
      + (this.sort() !== 'az' ? 1 : 0);
  });

  readonly chips = computed<ActiveChip[]>(() => {
    const f = this.filters();
    const out: ActiveChip[] = [];
    const q = this.query().trim();
    if (q) out.push({ id: 'q', label: `“${q}”`, remove: () => this.queryChange.emit('') });
    const r = this.region();
    if (r !== 'All') out.push({ id: 'region', label: r, remove: () => this.regionChange.emit('All') });
    for (const t of f.types) out.push({ id: `t-${t}`, label: t, remove: () => this.toggleType(t) });
    for (const w of f.departWindows) {
      out.push({ id: `w-${w}`, label: DEPART_WINDOWS[w].label, remove: () => this.patch({ departWindows: f.departWindows.filter(x => x !== w) }) });
    }
    for (const h of f.viaHubs) {
      const name = HUBS.find(x => x.code === h)?.name ?? h;
      out.push({ id: `h-${h}`, label: `Via ${name}`, remove: () => this.patch({ viaHubs: f.viaHubs.filter(x => x !== h) }) });
    }
    if (f.sameDayArrival) out.push({ id: 'same', label: 'Same-day arrival', remove: () => this.patch({ sameDayArrival: false }) });
    if (f.widebodyOnly) out.push({ id: 'wide', label: 'Widebody', remove: () => this.patch({ widebodyOnly: false }) });
    if (f.starredOnly) out.push({ id: 'star', label: 'Starred only', remove: () => this.patch({ starredOnly: false }) });
    const s = this.sort();
    if (s !== 'az') {
      const label = SORT_OPTIONS.find(o => o.key === s)?.label ?? s;
      out.push({ id: 'sort', label: `Sort: ${label}`, remove: () => this.sortChange.emit('az') });
    }
    return out;
  });

  protected regionColor(r: string): string | null {
    return r === 'All' || r === STARRED_REGION ? null : regionVar(r);
  }

  setConnections(on: boolean): void {
    if (on !== this.showConnections()) this.showConnectionsChange.emit(on);
  }

  toggleType(t: DestinationType): void {
    const cur = this.filters().types;
    this.patch({ types: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] });
  }

  private patch(p: Partial<Filters>): void {
    this.filtersChange.emit({ ...this.filters(), ...p });
  }
}
