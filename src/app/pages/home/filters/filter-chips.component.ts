import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AppStateService } from '../../../state/app-state.service';
import { DEPART_WINDOWS, Filters } from '../../../utils/routes';
import { IconComponent } from '../../../components/shared/icons.component';
import { hubDisplayName } from '../../../ui/format';
import { SORT_OPTIONS } from './filter-sheet.component';

export interface ActiveChip {
  id: string;
  label: string;
  remove: () => void;
}

/**
 * Active-filter row for Home's results mode: one removable tag per search,
 * region, filter and non-default sort, then "Clear". Moved from the retired
 * FilterBar.
 */
@Component({
  selector: 'app-filter-chips',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chips().length) {
      <div class="ac ui-snap-row" role="group" aria-label="Active filters">
        @for (c of chips(); track c.id) {
          <button type="button" class="chip" (click)="c.remove()" [attr.aria-label]="'Remove ' + c.label">
            {{ c.label }}<app-icon name="close" [size]="12" [strokeWidth]="2.4" />
          </button>
        }
        <button type="button" class="clear ui-link" (click)="clearAll()">Clear</button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ac { gap: 8px; align-items: center; padding: 2px 0; }
    .chip {
      flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px 6px 11px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; white-space: nowrap;
      background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue);
    }
    .chip:hover { background: color-mix(in srgb, var(--blue) 18%, transparent); }
    .clear { flex: none; font-size: 13px; padding: 6px 4px; }
  `],
})
export class FilterChipsComponent {
  private readonly state = inject(AppStateService);
  /** False when the page shows the region elsewhere (its own chip row). */
  readonly showRegion = input(true);
  /** After "Clear" (the page also drops ?view). */
  readonly cleared = output<void>();

  readonly chips = computed<ActiveChip[]>(() => {
    const f = this.state.filters();
    const out: ActiveChip[] = [];
    const q = this.state.query();
    if (q) out.push({ id: 'q', label: `“${q}”`, remove: () => this.state.setQuery('') });
    const r = this.state.region();
    if (r !== 'All' && this.showRegion()) out.push({ id: 'region', label: r, remove: () => this.state.setRegion('All') });
    for (const t of f.types) out.push({ id: `t-${t}`, label: t, remove: () => this.patch({ types: f.types.filter(x => x !== t) }) });
    for (const w of f.departWindows) {
      out.push({ id: `w-${w}`, label: DEPART_WINDOWS[w].label, remove: () => this.patch({ departWindows: f.departWindows.filter(x => x !== w) }) });
    }
    for (const h of f.viaHubs) {
      out.push({ id: `h-${h}`, label: `Via ${hubDisplayName(h)}`, remove: () => this.patch({ viaHubs: f.viaHubs.filter(x => x !== h) }) });
    }
    if (f.sameDayArrival) out.push({ id: 'same', label: 'Same-day arrival', remove: () => this.patch({ sameDayArrival: false }) });
    if (f.widebodyOnly) out.push({ id: 'wide', label: 'Widebody', remove: () => this.patch({ widebodyOnly: false }) });
    if (f.starredOnly) out.push({ id: 'star', label: 'Starred only', remove: () => this.patch({ starredOnly: false }) });
    const s = this.state.sort();
    if (s !== 'az') {
      const label = SORT_OPTIONS.find(o => o.key === s)?.label ?? s;
      out.push({ id: 'sort', label: `Sort: ${label}`, remove: () => this.state.setSort('az') });
    }
    return out;
  });

  clearAll(): void {
    this.state.clearFilters();
    if (this.state.sort() !== 'az') this.state.setSort('az');
    this.cleared.emit();
  }

  private patch(p: Partial<Filters>): void {
    this.state.setFilters({ ...this.state.filters(), ...p });
  }
}
