import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, input, output, viewChild,
} from '@angular/core';
import { HUBS } from '../../data/destinations';
import { DEPART_WINDOWS, DepartWindow, EMPTY_FILTERS, Filters, SortKey } from '../../utils/routes';
import { aircraftName, widebodyCodes } from '../../utils/aircraft';
import { minToHhmm } from '../../utils/time';
import { IconComponent } from '../shared/icons.component';

export const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: 'az', label: 'A–Z' },
  { key: 'departure', label: 'Departure time' },
  { key: 'duration', label: 'Duration' },
  { key: 'days', label: 'Days flying' },
  { key: 'newest', label: 'Newest' },
];

/**
 * "Filter & sort" sheet (native <dialog class="ui-sheet">). Changes apply
 * live: every control emits a complete Filters object or a SortKey. The parent
 * renders it with @if and removes it on (closed).
 */
@Component({
  selector: 'app-filter-popover',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="ui-sheet fp" aria-labelledby="fp-title" (close)="closed.emit()" (click)="onBackdrop($event)">
      <div class="ui-sheet__grabber" aria-hidden="true"></div>
      <header class="fp__head">
        <h2 id="fp-title" class="fp__title">Filter &amp; sort</h2>
        <button type="button" class="ui-icon-btn" (click)="close()" aria-label="Close filters">
          <app-icon name="close" [size]="20" />
        </button>
      </header>

      <div class="fp__body">
        <label class="fp__row" for="fp-sort">
          <span class="fp__name">Sort by</span>
          <span class="fp__select">
            <select id="fp-sort" (change)="onSort($event)">
              @for (o of sortOptions; track o.key) {
                <option [value]="o.key" [selected]="sort() === o.key"
                        [disabled]="o.key === 'departure' && !selectedDateKey()">
                  {{ o.label }}{{ o.key === 'departure' && !selectedDateKey() ? ' (pick a day)' : '' }}
                </option>
              }
            </select>
            <app-icon name="chevron-down" [size]="16" />
          </span>
        </label>

        <fieldset class="fp__field">
          <legend class="fp__name">Departs {{ hubCode() }}</legend>
          <div class="fp__opts">
            @for (w of windows; track w.key) {
              <button type="button" class="ui-pill fp__win" [attr.aria-pressed]="filters().departWindows.includes(w.key)"
                      (click)="toggleWindow(w.key)">
                {{ w.label }}<span class="fp__range ui-num">{{ w.range }}</span>
              </button>
            }
          </div>
        </fieldset>

        <fieldset class="fp__field" [disabled]="!showConnections()">
          <legend class="fp__name">Connect via</legend>
          @if (!showConnections()) { <p class="fp__hint">Turn on “Include connections” to choose hubs.</p> }
          <div class="fp__opts">
            @for (h of viaHubs(); track h.code) {
              <button type="button" class="ui-pill" [attr.aria-pressed]="filters().viaHubs.includes(h.code)"
                      [attr.aria-label]="h.name + ' (' + h.code + ')'" (click)="toggleHub(h.code)">
                <span class="fp__code">{{ h.code }}</span>{{ h.name }}
              </button>
            }
          </div>
        </fieldset>

        <label class="fp__row" for="fp-sameday">
          <span class="fp__stack">
            <span class="fp__name">Arrives same day</span>
            <span class="fp__hint">No overnight or +1 arrivals</span>
          </span>
          <input id="fp-sameday" type="checkbox" role="switch" class="fp__switch"
                 [checked]="filters().sameDayArrival" (change)="setFlag('sameDayArrival', $event)">
        </label>

        <label class="fp__row" for="fp-wide">
          <span class="fp__stack">
            <span class="fp__name">Widebody only</span>
            <span class="fp__hint">{{ widebodyHint() }}</span>
          </span>
          <input id="fp-wide" type="checkbox" role="switch" class="fp__switch"
                 [checked]="filters().widebodyOnly" (change)="setFlag('widebodyOnly', $event)">
        </label>
      </div>

      <footer class="fp__foot">
        <button type="button" class="ui-btn" (click)="reset()">Reset</button>
        <button type="button" class="ui-btn ui-btn--primary" (click)="close()">Show {{ routeCount() }} routes</button>
      </footer>
    </dialog>
  `,
  styles: [`
    .fp__head { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-2) 0 var(--space-5); }
    .fp__title { font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
    .fp__body { display: grid; gap: var(--space-5); padding: var(--space-4) var(--space-5); }
    .fp__field { border: 0; min-width: 0; display: grid; gap: var(--space-2); }
    .fp__field:disabled .fp__opts { opacity: .45; }
    .fp__field legend { margin-bottom: var(--space-2); }
    .fp__name { font-size: 15px; font-weight: 600; }
    .fp__hint { font-size: 13px; color: var(--ink-2); }
    .fp__opts { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .fp__range { font-family: var(--font-code); font-size: 11px; opacity: .75; }
    .fp__code { font-family: var(--font-code); font-size: 12px; }
    .fp__row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); cursor: pointer; }
    .fp__stack { display: grid; gap: 2px; }
    .fp__select { position: relative; display: inline-flex; align-items: center; color: var(--ink-2); }
    .fp__select select {
      appearance: none; height: 40px; padding: 0 34px 0 12px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--surface); color: var(--ink); font-weight: 600; cursor: pointer;
    }
    .fp__select app-icon { position: absolute; right: 10px; pointer-events: none; }
    .fp__switch {
      appearance: none; flex-shrink: 0; position: relative; width: 46px; height: 28px; border-radius: 14px; cursor: pointer;
      background: var(--line-strong); transition: background var(--dur-fast) var(--ease-out);
    }
    .fp__switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
      background: var(--surface); box-shadow: var(--shadow-card); transition: transform var(--dur-fast) var(--ease-out);
    }
    .fp__switch:checked { background: var(--accent-fill); }
    .fp__switch:checked::after { transform: translateX(18px); }
    .fp__foot {
      position: sticky; bottom: 0; display: flex; justify-content: space-between; gap: var(--space-3);
      padding: var(--space-3) var(--space-5) var(--space-4); background: var(--surface); border-top: 1px solid var(--line);
    }
    .fp__foot .ui-btn--primary { flex: 1; max-width: 240px; }
  `],
})
export class FilterPopoverComponent {
  readonly filters = input<Filters>(EMPTY_FILTERS);
  readonly sort = input<SortKey>('az');
  readonly selectedDateKey = input<string | null>(null);
  readonly hubCode = input('');
  readonly showConnections = input(true);
  readonly routeCount = input(0);

  readonly filtersChange = output<Filters>();
  readonly sortChange = output<SortKey>();
  readonly closed = output<void>();

  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly windows = (Object.keys(DEPART_WINDOWS) as DepartWindow[]).map(key => {
    const w = DEPART_WINDOWS[key];
    return { key, label: w.label, range: `${minToHhmm(w.start).slice(0, 2)}–${minToHhmm(w.end).slice(0, 2)}` };
  });
  readonly viaHubs = computed(() => HUBS.filter(h => h.code !== this.hubCode()));
  /** Critique 36: the widebody list comes from the schedule data, not a hard-coded list. */
  readonly widebodyHint = computed(() => {
    const names = widebodyCodes().map(c => aircraftName(c).replace(/^(Boeing|Airbus) /, ''));
    return names.length ? names.join(', ') : 'Twin-aisle aircraft';
  });

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    afterNextRender(() => {
      const d = this.dlg().nativeElement;
      if (!d.open) d.showModal();
    });
  }

  close(): void {
    this.dlg().nativeElement.close();
  }

  protected onBackdrop(e: MouseEvent): void {
    const d = this.dlg().nativeElement;
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) this.close();
  }

  protected onSort(e: Event): void {
    this.sortChange.emit((e.target as HTMLSelectElement).value as SortKey);
  }

  toggleWindow(w: DepartWindow): void {
    const cur = this.filters().departWindows;
    this.emit({ departWindows: cur.includes(w) ? cur.filter(x => x !== w) : [...cur, w] });
  }

  toggleHub(code: string): void {
    const cur = this.filters().viaHubs;
    this.emit({ viaHubs: cur.includes(code) ? cur.filter(x => x !== code) : [...cur, code] });
  }

  protected setFlag(key: 'sameDayArrival' | 'widebodyOnly', e: Event): void {
    this.emit({ [key]: (e.target as HTMLInputElement).checked });
  }

  /** Clears what this sheet controls; type chips and starred live in the chip row. */
  reset(): void {
    this.emit({ departWindows: [], viaHubs: [], sameDayArrival: false, widebodyOnly: false });
    if (this.sort() !== 'az') this.sortChange.emit('az');
  }

  private emit(patch: Partial<Filters>): void {
    this.filtersChange.emit({ ...this.filters(), ...patch });
  }
}
