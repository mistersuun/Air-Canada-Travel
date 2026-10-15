import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AppStateService } from '../../../state/app-state.service';
import { Filters } from '../../../utils/routes';
import { IconComponent } from '../../../components/shared/icons.component';
import { hubDisplayName } from '../../../ui/format';
import { SORT_OPTIONS } from './filter-sheet.component';
import { t } from '../../../i18n/t';
import { departWindowLabel, regionLabel, typeLabel } from '../../../i18n/labels';

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
      <div class="ac ui-snap-row" role="group" [attr.aria-label]="t('home.chips.label')">
        @for (c of chips(); track c.id) {
          <button type="button" class="chip" (click)="c.remove()" [attr.aria-label]="t('home.chips.remove', { label: c.label })">
            {{ c.label }}<app-icon name="close" [size]="12" [strokeWidth]="2.4" />
          </button>
        }
        <button type="button" class="clear ui-link" (click)="clearAll()">{{ t('common.clear') }}</button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ac { gap: 8px; align-items: center; padding: 2px 0; }
    .chip {
      position: relative; flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px 6px 11px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; white-space: nowrap;
      background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue);
    }
    .chip::after { content: ''; position: absolute; inset: -8px -2px; }
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
  protected readonly t = t;

  readonly chips = computed<ActiveChip[]>(() => {
    const f = this.state.filters();
    const out: ActiveChip[] = [];
    const q = this.state.query();
    if (q) out.push({ id: 'q', label: t('home.chips.query', { q }), remove: () => this.state.setQuery('') });
    const r = this.state.region();
    if (r !== 'All' && this.showRegion()) out.push({ id: 'region', label: regionLabel(r), remove: () => this.state.setRegion('All') });
    for (const ty of f.types) out.push({ id: `t-${ty}`, label: typeLabel(ty), remove: () => this.patch({ types: f.types.filter(x => x !== ty) }) });
    for (const w of f.departWindows) {
      out.push({ id: `w-${w}`, label: departWindowLabel(w), remove: () => this.patch({ departWindows: f.departWindows.filter(x => x !== w) }) });
    }
    for (const h of f.viaHubs) {
      out.push({ id: `h-${h}`, label: t('home.chips.via', { hub: hubDisplayName(h) }), remove: () => this.patch({ viaHubs: f.viaHubs.filter(x => x !== h) }) });
    }
    if (f.sameDayArrival) out.push({ id: 'same', label: t('home.chips.sameDay'), remove: () => this.patch({ sameDayArrival: false }) });
    if (f.widebodyOnly) out.push({ id: 'wide', label: t('home.chips.widebody'), remove: () => this.patch({ widebodyOnly: false }) });
    if (f.maxHours) out.push({ id: 'max', label: t('home.chips.maxHours', { h: f.maxHours }), remove: () => this.patch({ maxHours: null }) });
    if (f.starredOnly) out.push({ id: 'star', label: t('home.chips.starred'), remove: () => this.patch({ starredOnly: false }) });
    const s = this.state.sort();
    if (s !== 'az') {
      const key = SORT_OPTIONS.find(o => o.key === s)?.label;
      out.push({ id: 'sort', label: t('home.chips.sort', { label: key ? t(key) : s }), remove: () => this.state.setSort('az') });
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
