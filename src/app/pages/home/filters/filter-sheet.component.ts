import { ChangeDetectionStrategy, Component, computed, inject, model } from '@angular/core';
import { HUBS, REGIONS, TYPES } from '../../../data/destinations';
import type { DestinationType } from '../../../data/destinations';
import { ProfileService } from '../../../recs/profile.service';
import { AppStateService } from '../../../state/app-state.service';
import { aircraftName, widebodyCodes } from '../../../utils/aircraft';
import { regionVar } from '../../../utils/region-color';
import { DEPART_WINDOWS, DepartWindow, Filters, STARRED_REGION, SortKey } from '../../../utils/routes';
import { minToHhmm } from '../../../utils/time';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import type { SegOption } from '../../../ui/seg.component';
import { hubDisplayName } from '../../../ui/format';

const DEFAULT_MAX_HOURS = 6;

export const SORT_OPTIONS: readonly { key: SortKey; label: string; short: string }[] = [
  { key: 'az', label: 'A–Z', short: 'A–Z' },
  { key: 'departure', label: 'Departure time', short: 'Departure' },
  { key: 'duration', label: 'Duration', short: 'Duration' },
  { key: 'days', label: 'Days flying', short: 'Days' },
  { key: 'newest', label: 'Newest', short: 'New' },
];

/** 'All', 'Starred', then the geographic regions. */
export const REGION_CHIPS: readonly string[] = ['All', STARRED_REGION, ...REGIONS.filter(r => r !== 'All')];

export const TYPE_CHIPS = TYPES.filter(t => t !== 'All') as DestinationType[];

/**
 * Filter & sort sheet (Home). Every control writes straight to
 * AppStateService, so the list behind it updates live: sort, region, flight
 * types, departure windows, same-day arrival, via hubs, widebody, starred
 * only and show connections. Same semantics as the retired FilterPopover.
 *
 *   <app-filter-sheet [(open)]="filtersOpen" />
 */
@Component({
  selector: 'app-filter-sheet',
  standalone: true,
  imports: [GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet title="Filter & sort" [(open)]="open">
      <div class="fs">
        <section class="grp">
          <span class="nm" id="fs-sort">Sort by</span>
          <div class="chips" role="group" aria-labelledby="fs-sort" data-filter="sort">
            @for (o of sortOptions(); track o.value) {
              <button type="button" class="chip" [attr.aria-pressed]="state.sort() === o.value" [disabled]="o.disabled"
                      (click)="setSort(o.value)">{{ o.label }}</button>
            }
          </div>
          @if (!state.selectedDateKey()) { <span class="hint">Pick a day to sort by departure time.</span> }
        </section>

        <section class="grp">
          <label class="row" for="fs-conn">
            <span class="row__tx"><span class="nm">Show connections</span><span class="hint">One-stop trips through a hub</span></span>
            <input id="fs-conn" type="checkbox" role="switch" class="switch"
                   [checked]="state.showConnections()" (change)="state.setShowConnections(checked($event))">
          </label>
          <fieldset class="field" [disabled]="!state.showConnections()">
            <legend class="nm">Connect via</legend>
            <div class="chips">
              @for (h of viaHubs(); track h.code) {
                <button type="button" class="chip" [attr.aria-pressed]="f().viaHubs.includes(h.code)"
                        [attr.aria-label]="h.name + ' (' + h.code + ')'" (click)="toggleHub(h.code)">
                  <b>{{ h.code }}</b>{{ h.name }}
                </button>
              }
            </div>
          </fieldset>
        </section>

        <section class="grp">
          <span class="nm" id="fs-region">Region</span>
          <div class="chips" role="group" aria-labelledby="fs-region">
            @for (r of regions; track r) {
              <button type="button" class="chip" [attr.aria-pressed]="state.region() === r" (click)="setRegion(r)">
                @if (dot(r); as c) { <i class="dot" [style.background]="c"></i> }
                {{ r === 'All' ? 'All regions' : r === starred ? '★ Starred' : r }}
              </button>
            }
          </div>
          <span class="nm" id="fs-type">Trip type</span>
          <div class="chips" role="group" aria-labelledby="fs-type">
            @for (t of types; track t) {
              <button type="button" class="chip" [attr.aria-pressed]="f().types.includes(t)" (click)="toggleType(t)">{{ t }}</button>
            }
          </div>
        </section>

        <section class="grp">
          <span class="nm" id="fs-win">Departs {{ state.hub() }}</span>
          <div class="chips" role="group" aria-labelledby="fs-win">
            @for (w of windows; track w.key) {
              <button type="button" class="chip" [attr.aria-pressed]="f().departWindows.includes(w.key)" (click)="toggleWindow(w.key)">
                {{ w.label }}<span class="rng tn">{{ w.range }}</span>
              </button>
            }
          </div>
          <label class="row" for="fs-same">
            <span class="row__tx"><span class="nm">Arrives same day</span><span class="hint">No overnight or +1 arrivals</span></span>
            <input id="fs-same" type="checkbox" role="switch" class="switch"
                   [checked]="f().sameDayArrival" (change)="patch({ sameDayArrival: checked($event) })">
          </label>
          <label class="row" for="fs-max">
            <span class="row__tx"><span class="nm">Max flight time</span>
              <span class="hint" data-max-hint>{{ f().maxHours ? 'Up to ' + f().maxHours + 'h' : 'Any length' }}</span></span>
            <input id="fs-max" type="checkbox" role="switch" class="switch" data-max-switch
                   [checked]="!!f().maxHours" (change)="setMax(checked($event) ? maxDefault() : null)">
          </label>
          @if (f().maxHours; as h) {
            <input type="range" class="range" min="1" max="12" step="1" data-max-range aria-label="Longest flight in hours"
                   [value]="h" [attr.aria-valuetext]="'Up to ' + h + ' hours'" (input)="setMax(num($event))">
          }
          <label class="row" for="fs-wide">
            <span class="row__tx"><span class="nm">Widebody only</span><span class="hint">{{ widebodyHint() }}</span></span>
            <input id="fs-wide" type="checkbox" role="switch" class="switch"
                   [checked]="f().widebodyOnly" (change)="patch({ widebodyOnly: checked($event) })">
          </label>
          <label class="row" for="fs-star">
            <span class="row__tx"><span class="nm">Starred only</span><span class="hint">Destinations you saved</span></span>
            <input id="fs-star" type="checkbox" role="switch" class="switch"
                   [checked]="f().starredOnly" (change)="patch({ starredOnly: checked($event) })">
          </label>
        </section>
      </div>
      <footer class="foot">
        <button type="button" class="ui-btn ui-btn--ghost" (click)="reset()">Reset</button>
        <button type="button" class="ui-btn" (click)="open.set(false)">Show {{ count() }} {{ count() === 1 ? 'destination' : 'destinations' }}</button>
      </footer>
    </app-glass-sheet>
  `,
  styles: [`
    .fs { display: grid; gap: 14px; }
    .grp { display: grid; gap: 12px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .field { border: 0; min-width: 0; display: grid; gap: 8px; padding: 0; margin: 0; }
    .field:disabled .chips { opacity: .45; }
    .field legend { padding: 0; margin-bottom: 8px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
    .row__tx { display: grid; gap: 2px; }
    .nm { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--ink-2); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
      background: var(--surface); color: var(--ink); font-size: 13px; font-weight: 600; white-space: nowrap;
      box-shadow: inset 0 0 0 1px var(--hair);
    }
    .chip[aria-pressed='true'] { background: var(--ink); color: var(--bg); box-shadow: none; }
    .chip:disabled { opacity: .45; cursor: default; }
    .chip b { font-size: 11px; font-weight: 700; letter-spacing: .04em; opacity: .7; }
    .rng { font-size: 11px; opacity: .65; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .range { width: 100%; accent-color: var(--teal); }
    .switch {
      appearance: none; flex: none; width: 50px; height: 30px; margin: 0; border-radius: 999px;
      background: var(--hair); position: relative; cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .2);
      transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--teal); }
    .switch:checked::after { transform: translateX(20px); }
    .foot {
      position: sticky; bottom: -20px; display: flex; gap: 10px; margin: 14px -20px -20px; padding: 12px 20px 20px;
      background: linear-gradient(180deg, transparent, var(--surface) 30%);
    }
    .foot .ui-btn:last-child { flex: 1; }
  `],
})
export class FilterSheetComponent {
  protected readonly state = inject(AppStateService);
  private readonly profile = inject(ProfileService);
  readonly open = model(false);

  protected readonly f = this.state.filters;
  protected readonly regions = REGION_CHIPS;
  protected readonly types = TYPE_CHIPS;
  protected readonly starred = STARRED_REGION;
  protected readonly windows = (Object.keys(DEPART_WINDOWS) as DepartWindow[]).map(key => {
    const w = DEPART_WINDOWS[key];
    return { key, label: w.label, range: `${minToHhmm(w.start).slice(0, 2)}–${minToHhmm(w.end).slice(0, 2)}` };
  });

  protected readonly sortOptions = computed<SegOption[]>(() =>
    SORT_OPTIONS.map(o => ({ value: o.key, label: o.label, disabled: o.key === 'departure' && !this.state.selectedDateKey() })),
  );
  protected readonly viaHubs = computed(() =>
    HUBS.filter(h => h.code !== this.state.hub()).map(h => ({ code: h.code, name: hubDisplayName(h.code) })),
  );
  /** The widebody list comes from the schedule data, not a hard-coded list. */
  protected readonly widebodyHint = computed(() => {
    const names = widebodyCodes().map(c => aircraftName(c).replace(/^(Boeing|Airbus) /, ''));
    return names.length ? names.join(', ') : 'Twin-aisle aircraft';
  });
  protected readonly count = computed(() => this.state.routes().length);

  /** What the switch turns on: the profile's longest flight when it has one, else 6 hours. */
  protected readonly maxDefault = computed(() => this.profile.profile().maxFlightHours ?? DEFAULT_MAX_HOURS);

  protected num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  setMax(h: number | null): void {
    this.patch({ maxHours: h && Number.isFinite(h) ? Math.min(12, Math.max(1, Math.round(h))) : null });
  }

  protected dot(r: string): string | null {
    return r === 'All' || r === STARRED_REGION ? null : regionVar(r);
  }

  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  setSort(v: string | undefined): void {
    if (v) this.state.setSort(v as SortKey);
  }

  setRegion(r: string): void {
    this.state.setRegion(this.state.region() === r && r !== 'All' ? 'All' : r);
  }

  toggleType(t: DestinationType): void {
    const cur = this.f().types;
    this.patch({ types: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] });
  }

  toggleWindow(w: DepartWindow): void {
    const cur = this.f().departWindows;
    this.patch({ departWindows: cur.includes(w) ? cur.filter(x => x !== w) : [...cur, w] });
  }

  toggleHub(code: string): void {
    const cur = this.f().viaHubs;
    this.patch({ viaHubs: cur.includes(code) ? cur.filter(x => x !== code) : [...cur, code] });
  }

  patch(p: Partial<Filters>): void {
    this.state.setFilters({ ...this.f(), ...p });
  }

  /** Resets everything this sheet controls: filters, sort, region and connections. The search box is left alone. */
  reset(): void {
    this.state.setFilters({});
    if (this.state.sort() !== 'az') this.state.setSort('az');
    if (this.state.region() !== 'All') this.state.setRegion('All');
    if (!this.state.showConnections()) this.state.setShowConnections(true);
  }
}
