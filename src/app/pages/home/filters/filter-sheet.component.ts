import { ChangeDetectionStrategy, Component, booleanAttribute, computed, effect, inject, input, model, untracked } from '@angular/core';
import { HUBS, REGIONS, TYPES } from '../../../data/destinations';
import type { DestinationType } from '../../../data/destinations';
import { ProfileService } from '../../../recs/profile.service';
import { AppStateService } from '../../../state/app-state.service';
import { aircraftName, widebodyCodes } from '../../../utils/aircraft';
import { regionVar } from '../../../utils/region-color';
import { DEPART_WINDOWS, DepartWindow, Filters, STARRED_REGION, SortKey } from '../../../utils/routes';
import { minToHhmm, monthShort } from '../../../utils/time';
import { visaAsOf } from '../../../reference/visa';
import { NO_TRIP_FIT, MAX_TZ_CHOICES, MAX_WET_CHOICES, MIN_HIGH_CHOICES, usableVisa, weatherActive, weatherMonthOf } from '../trip-fit-model';
import { TripFitService } from '../trip-fit.service';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import type { SegOption } from '../../../ui/seg.component';
import { hubDisplayName } from '../../../ui/format';
import { MsgKey, t } from '../../../i18n/t';
import { departWindowLabel, regionLabel, typeLabel } from '../../../i18n/labels';

const DEFAULT_MAX_HOURS = 6;

/** Sort choices; `label` is a message key. */
export const SORT_OPTIONS: readonly { key: SortKey; label: MsgKey }[] = [
  { key: 'az', label: 'home.filter.sort.az' },
  { key: 'departure', label: 'home.filter.sort.departure' },
  { key: 'duration', label: 'home.filter.sort.duration' },
  { key: 'days', label: 'home.filter.sort.days' },
  { key: 'newest', label: 'home.filter.sort.newest' },
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
    <app-glass-sheet [title]="fitOnly() ? t('home.filter.fit') : t('home.filter.title')" [(open)]="open">
      <div class="fs">
        @if (!fitOnly()) {
        <section class="grp">
          <span class="nm" id="fs-sort">{{ t('home.filter.sortBy') }}</span>
          <div class="chips" role="group" aria-labelledby="fs-sort" data-filter="sort">
            @for (o of sortOptions(); track o.value) {
              <button type="button" class="chip" [attr.aria-pressed]="state.sort() === o.value" [disabled]="o.disabled"
                      (click)="setSort(o.value)">{{ o.label }}</button>
            }
          </div>
          @if (!state.selectedDateKey()) { <span class="hint">{{ t('home.filter.sortHint') }}</span> }
        </section>

        <section class="grp">
          <label class="row" for="fs-conn">
            <span class="row__tx"><span class="nm">{{ t('home.filter.showConnections') }}</span><span class="hint">{{ t('home.filter.showConnectionsHint') }}</span></span>
            <input id="fs-conn" type="checkbox" role="switch" class="switch"
                   [checked]="state.showConnections()" (change)="state.setShowConnections(checked($event))">
          </label>
          <fieldset class="field" [disabled]="!state.showConnections()">
            <legend class="nm">{{ t('home.filter.connectVia') }}</legend>
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
          <span class="nm" id="fs-region">{{ t('home.filter.region') }}</span>
          <div class="chips" role="group" aria-labelledby="fs-region">
            @for (r of regions; track r) {
              <button type="button" class="chip" [attr.aria-pressed]="state.region() === r" (click)="setRegion(r)">
                @if (dot(r); as c) { <i class="dot" [style.background]="c"></i> }
                {{ regionLabel(r) }}
              </button>
            }
          </div>
          <span class="nm" id="fs-type">{{ t('home.filter.tripType') }}</span>
          <div class="chips" role="group" aria-labelledby="fs-type">
            @for (ty of types; track ty) {
              <button type="button" class="chip" [attr.aria-pressed]="f().types.includes(ty)" (click)="toggleType(ty)">{{ typeLabel(ty) }}</button>
            }
          </div>
        </section>

        <section class="grp">
          <span class="nm" id="fs-win">{{ t('home.filter.departs', { hub: state.hub() }) }}</span>
          <div class="chips" role="group" aria-labelledby="fs-win">
            @for (w of windows; track w.key) {
              <button type="button" class="chip" [attr.aria-pressed]="f().departWindows.includes(w.key)" (click)="toggleWindow(w.key)">
                {{ windowLabel(w.key) }}<span class="rng tn">{{ w.range }}</span>
              </button>
            }
          </div>
          <label class="row" for="fs-same">
            <span class="row__tx"><span class="nm">{{ t('home.filter.sameDay') }}</span><span class="hint">{{ t('home.filter.sameDayHint') }}</span></span>
            <input id="fs-same" type="checkbox" role="switch" class="switch"
                   [checked]="f().sameDayArrival" (change)="patch({ sameDayArrival: checked($event) })">
          </label>
          <label class="row" for="fs-max">
            <span class="row__tx"><span class="nm">{{ t('home.filter.maxTime') }}</span>
              <span class="hint" data-max-hint>{{ f().maxHours ? t('home.filter.maxHint', { h: f().maxHours! }) : t('home.filter.anyLength') }}</span></span>
            <input id="fs-max" type="checkbox" role="switch" class="switch" data-max-switch
                   [checked]="!!f().maxHours" (change)="setMax(checked($event) ? maxDefault() : null)">
          </label>
          @if (f().maxHours; as h) {
            <input type="range" class="range" min="1" max="12" step="1" data-max-range [attr.aria-label]="t('home.filter.maxLabel')"
                   [value]="h" [attr.aria-valuetext]="t('home.filter.maxValue', { h })" (input)="setMax(num($event))">
          }
          <label class="row" for="fs-wide">
            <span class="row__tx"><span class="nm">{{ t('home.filter.widebody') }}</span><span class="hint">{{ widebodyHint() }}</span></span>
            <input id="fs-wide" type="checkbox" role="switch" class="switch"
                   [checked]="f().widebodyOnly" (change)="patch({ widebodyOnly: checked($event) })">
          </label>
          <label class="row" for="fs-star">
            <span class="row__tx"><span class="nm">{{ t('home.filter.starred') }}</span><span class="hint">{{ t('home.filter.starredHint') }}</span></span>
            <input id="fs-star" type="checkbox" role="switch" class="switch"
                   [checked]="f().starredOnly" (change)="patch({ starredOnly: checked($event) })">
          </label>
        </section>
        }

        <section class="grp" data-fit>
          @if (!fitOnly()) { <h3 class="hd">{{ t('home.filter.fit') }}</h3> }
          <span class="hint">{{ t('home.filter.fitHint') }}</span>

          @if (hasPassport()) {
            <span class="nm" id="fs-entry">{{ t('home.entry.label') }}</span>
            <div class="chips" role="group" aria-labelledby="fs-entry" data-filter="entry">
              <button type="button" class="chip" [attr.aria-pressed]="f().entry === 'any'" (click)="patch({ entry: 'any' })">{{ t('home.filter.any') }}</button>
              @for (o of entryChoices; track o.value) {
                <button type="button" class="chip" [attr.aria-pressed]="f().entry === o.value" (click)="patch({ entry: o.value })">{{ t(o.label) }}</button>
              }
            </div>
            @if (entryHint(); as h) { <span class="hint">{{ h }}</span> }
          }

          <span class="nm" id="fs-wx">{{ t('home.weather.label') }}</span>
          <label class="row" for="fs-wxm">
            <span class="nm sub">{{ t('home.weather.month') }}</span>
            <select id="fs-wxm" class="sel" data-wx-month [value]="wxMonth()" (change)="patch({ weatherMonth: monthVal($event) })">
              @for (m of months; track m) { <option [value]="m" [selected]="wxMonth() === m">{{ monthLabel(m) }}</option> }
            </select>
          </label>
          <span class="nm sub" id="fs-wxh">{{ t('home.weather.minHigh') }}</span>
          <div class="chips" role="group" aria-labelledby="fs-wxh" data-filter="minHigh">
            <button type="button" class="chip" [attr.aria-pressed]="f().minHighC == null" (click)="patch({ minHighC: null })">{{ t('home.filter.any') }}</button>
            @for (n of minHigh; track n) {
              <button type="button" class="chip" [attr.aria-pressed]="f().minHighC === n" (click)="patch({ minHighC: n })">{{ t('home.weather.deg', { n }) }}</button>
            }
          </div>
          <span class="nm sub" id="fs-wxw">{{ t('home.weather.maxWet') }}</span>
          <div class="chips" role="group" aria-labelledby="fs-wxw" data-filter="maxWet">
            <button type="button" class="chip" [attr.aria-pressed]="f().maxWetDays == null" (click)="patch({ maxWetDays: null })">{{ t('home.filter.any') }}</button>
            @for (n of maxWet; track n) {
              <button type="button" class="chip" [attr.aria-pressed]="f().maxWetDays === n" (click)="patch({ maxWetDays: n })">{{ t('home.weather.days', { n }) }}</button>
            }
          </div>
          @if (noWeather() > 0) { <span class="hint" data-no-weather>{{ t('home.weather.noData', { n: noWeather() }) }}</span> }

          <span class="nm" id="fs-tz">{{ t('home.tz.label', { hub: state.hub() }) }}</span>
          <div class="chips" role="group" aria-labelledby="fs-tz" data-filter="tz">
            <button type="button" class="chip" [attr.aria-pressed]="f().maxTzHours == null" (click)="patch({ maxTzHours: null })">{{ t('home.filter.any') }}</button>
            @for (n of maxTz; track n) {
              <button type="button" class="chip" [attr.aria-pressed]="f().maxTzHours === n" (click)="patch({ maxTzHours: n })">{{ t('home.tz.max', { n }) }}</button>
            }
          </div>

          <label class="row" for="fs-adv">
            <span class="row__tx"><span class="nm">{{ t('home.advisory.label') }}</span><span class="hint">{{ t('home.advisory.hint') }}</span></span>
            <input id="fs-adv" type="checkbox" role="switch" class="switch" data-advisory
                   [checked]="f().hideAdvisory" (change)="patch({ hideAdvisory: checked($event) })">
          </label>
        </section>
      </div>
      <footer class="foot">
        <button type="button" class="ui-btn ui-btn--ghost" (click)="reset()">{{ t('common.reset') }}</button>
        <button type="button" class="ui-btn" (click)="open.set(false)">{{ t('home.filter.show', { n: count() }) }}</button>
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
    .hd { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-2); }
    .nm.sub { font-size: 13px; font-weight: 600; color: var(--ink-2); }
    .sel { min-height: 44px; padding: 0 12px; border-radius: 12px; background: var(--surface); color: var(--ink); font-size: 14px; box-shadow: inset 0 0 0 1px var(--hair); }
    .hint { font-size: 13px; color: var(--ink-2); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chips { row-gap: 14px; }
    .chip {
      position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
      background: var(--surface); color: var(--ink); font-size: 13px; font-weight: 600; white-space: nowrap;
      box-shadow: inset 0 0 0 1px var(--hair);
    }
    .chip::after { content: ''; position: absolute; inset: -7px -2px; }
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
  private readonly fit = inject(TripFitService);
  readonly open = model(false);
  /** Map: only the "Trip fit" group (the other controls do not apply there). */
  readonly fitOnly = input(false, { transform: booleanAttribute });
  /** Destinations the "Show" button counts; null = Home's own list. */
  readonly shown = input<number | null>(null);

  constructor() {
    // Load the listings and typical weather only once the sheet is opened.
    effect(() => { if (this.open()) untracked(() => this.fit.prepare()); });
  }

  protected readonly f = this.state.filters;
  protected readonly regions = REGION_CHIPS;
  protected readonly types = TYPE_CHIPS;
  protected readonly windows = (Object.keys(DEPART_WINDOWS) as DepartWindow[]).map(key => {
    const w = DEPART_WINDOWS[key];
    return { key, range: `${minToHhmm(w.start).slice(0, 2)}–${minToHhmm(w.end).slice(0, 2)}` };
  });
  protected readonly t = t;
  protected readonly regionLabel = regionLabel;
  protected readonly typeLabel = typeLabel;
  protected readonly windowLabel = departWindowLabel;

  protected readonly sortOptions = computed<SegOption[]>(() =>
    SORT_OPTIONS.map(o => ({ value: o.key, label: t(o.label), disabled: o.key === 'departure' && !this.state.selectedDateKey() })),
  );
  protected readonly viaHubs = computed(() =>
    HUBS.filter(h => h.code !== this.state.hub()).map(h => ({ code: h.code, name: hubDisplayName(h.code) })),
  );
  /** The widebody list comes from the schedule data, not a hard-coded list. */
  protected readonly widebodyHint = computed(() => {
    const names = widebodyCodes().map(c => aircraftName(c).replace(/^(Boeing|Airbus) /, ''));
    return names.length ? names.join(', ') : t('home.filter.widebodyFallback');
  });
  protected readonly count = computed(() =>
    this.shown() ?? this.fit.apply(this.state.routes(), e => e.destination).items.length);

  protected readonly hasPassport = computed(() => this.fit.passports().length > 0);
  protected readonly months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  protected readonly entryChoices: readonly { value: Filters['entry']; label: MsgKey }[] = [
    { value: 'noVisa', label: 'home.entry.noVisa' },
    { value: 'noVisaOrEta', label: 'home.entry.noVisaOrEta' },
  ];
  protected readonly minHigh = MIN_HIGH_CHOICES;
  protected readonly maxWet = MAX_WET_CHOICES;
  protected readonly maxTz = MAX_TZ_CHOICES;
  protected readonly wxMonth = computed(() => weatherMonthOf(this.f(), this.fit.data().weekMonth));
  protected readonly noWeather = computed(() => {
    if (!weatherActive(this.f())) return 0;
    return this.fit.apply(this.fitPool(), e => e.destination).noWeather;
  });
  /** What the weather note counts: the routes before the trip-fit filters. */
  private readonly fitPool = computed(() => this.state.allRoutes());
  protected readonly entryHint = computed(() => {
    const d = this.fit.data();
    if (!d.visa) return '';
    const table = usableVisa(d);
    return table ? t('home.entry.hint', { date: visaAsOf(table) }) : t('home.entry.stale');
  });
  protected monthLabel(m: number): string { return monthShort(m - 1); }
  protected monthVal(e: Event): number { return Number((e.target as HTMLSelectElement).value); }

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
    if (this.fitOnly()) {
      this.patch(NO_TRIP_FIT);
      return;
    }
    this.state.setFilters({});
    if (this.state.sort() !== 'az') this.state.setSort('az');
    if (this.state.region() !== 'All') this.state.setRegion('All');
    if (!this.state.showConnections()) this.state.setShowConnections(true);
  }
}
