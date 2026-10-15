import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { t } from '../../i18n/t';
import { EventsCardComponent } from '../../events/events-card.component';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { ClimateService } from '../../recs/climate.service';
import { climateFor } from '../../recs/climate';
import { ForecastLineComponent } from '../../recs/ui/forecast-line.component';
import { DestRowComponent } from '../../ui/dest-row.component';
import { flightPath } from '../../ui/links';
import { findDestination, airportTz } from '../../utils/airports';
import { MINUTE_MS, formatClock, formatKey, isDateKey, todayKey } from '../../utils/time';
import {
  WEEKEND_LIMIT, WEEKEND_PRESETS, WeekendOption, WeekendPreset, WeekendWindow, presetWindow, weekendMeta, weekendOptions, windowProblem,
} from './weekend-model';

/**
 * Weekend finder (/weekend): the leave-after and home-by times of a weekend,
 * and every destination that fits, ranked by tries home and time on the
 * ground. Counts and times only. Computed on the device from the schedules.
 */
@Component({
  selector: 'app-weekend-page',
  standalone: true,
  imports: [IconComponent, DestRowComponent, ForecastLineComponent, EventsCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page wk">
      <header class="hd">
        <div class="top">
          <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('ui.back')" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <h1 class="ui-h1 ttl">{{ t('weekend.title') }}</h1>
        </div>
        <p class="ui-sub">{{ t('weekend.sub', { hub: state.hub() }) }}</p>
      </header>

      <div class="chips ui-snap-row" role="group" [attr.aria-label]="t('weekend.groupAria')">
        @for (p of presets; track p.value) {
          <button type="button" class="chip" [attr.aria-pressed]="preset() === p.value" (click)="choose(p.value)">{{ t(p.label) }}</button>
        }
      </div>

      @if (preset() === 'custom') {
        <div class="ui-card custom">
          <fieldset>
            <legend>{{ t('weekend.leaveAfter', { hub: state.hub() }) }}</legend>
            <span class="pair">
              <input type="date" [attr.aria-label]="t('weekend.leaveDateAria')" [min]="minKey()" [max]="maxKey()" [value]="window().leaveKey"
                     (change)="edit('leaveKey', $any($event.target).value)">
              <input type="time" [attr.aria-label]="t('weekend.leaveTimeAria')" [value]="window().leaveHhmm"
                     (change)="edit('leaveHhmm', $any($event.target).value)">
            </span>
          </fieldset>
          <fieldset>
            <legend>{{ t('weekend.homeBy', { hub: state.hub() }) }}</legend>
            <span class="pair">
              <input type="date" [attr.aria-label]="t('weekend.homeDateAria')" [min]="minKey()" [max]="maxKey()" [value]="window().homeKey"
                     (change)="edit('homeKey', $any($event.target).value)">
              <input type="time" [attr.aria-label]="t('weekend.homeTimeAria')" [value]="window().homeHhmm"
                     (change)="edit('homeHhmm', $any($event.target).value)">
            </span>
          </fieldset>
        </div>
      }

      <p class="sum tn">{{ t('weekend.summary', { a: stamp(window().leaveKey, window().leaveHhmm), b: stamp(window().homeKey, window().homeHhmm), hub: state.hub() }) }}</p>

      @if (problem(); as why) {
        <p class="ui-card note" role="status">{{ why }}</p>
      } @else if (!rows().length) {
        <p class="ui-card note" role="status">
          {{ t('weekend.none1') }}
          {{ t('weekend.none2') }}
        </p>
      } @else {
        <div class="ui-card list">
          @for (r of shown(); track r.o.code) {
            <app-dest-row [code]="r.o.code" [small]="r.o.code" [meta]="r.meta" wrapMeta [link]="r.link" [queryParams]="r.query">
              <span trailing class="wx">
                @if (r.weather) { <span class="ui-tag ui-tag--neutral tn"><span class="ui-visually-hidden">{{ t('weekend.typical') }} </span>{{ r.weather }}</span> }
              </span>
            </app-dest-row>
            <div class="evt">
              <app-forecast-line class="evt__f" [code]="r.o.code" [dateKey]="r.arrKey" [plain]="true" />
              <button type="button" class="evt__b" [attr.aria-expanded]="events() === r.o.code" [attr.aria-controls]="'evt-' + r.o.code"
                      [attr.aria-label]="t('weekend.whatsOnAria', { city: cityOf(r.o.code) })" (click)="toggleEvents(r.o.code)">{{ t('weekend.whatsOn') }}
                <app-icon class="evt__c" [class.open]="events() === r.o.code" name="chevron-down" [size]="14" /></button>
              <div [id]="'evt-' + r.o.code">
                @if (events() === r.o.code) { <app-events-card verbose [code]="r.o.code" [from]="r.arrKey" [to]="r.o.retKey" /> }
              </div>
            </div>
          }
        </div>
        @if (rows().length > shown().length) {
          <button type="button" class="ui-link more" (click)="all.set(true)">{{ t('flight.showAll', { n: rows().length }) }}</button>
        }
        <p class="ui-sub foot">{{ t('weekend.footer') }}</p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .hd { display: flex; flex-direction: column; gap: 6px; }
    .top { display: flex; align-items: center; gap: 12px; }
    .ttl { font-size: 30px; }
    /* Fades the right edge (and leaves room to scroll the last chip clear of it) to show the row scrolls. */
    .chips {
      display: flex; gap: 8px; margin-top: 16px; padding-right: 32px;
      -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 32px), transparent);
      mask-image: linear-gradient(90deg, #000 calc(100% - 32px), transparent);
    }
    .chip {
      flex: none; min-height: 44px; padding: 8px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--ink);
      background: var(--fill); border: 1px solid transparent;
    }
    .chip[aria-pressed='true'] { background: var(--ink); color: var(--bg); }
    .custom { display: grid; gap: 12px; padding: 14px; margin-top: 12px; }
    .custom fieldset { display: flex; flex-direction: column; gap: 6px; border: 0; padding: 0; margin: 0; min-width: 0; }
    .custom legend { padding: 0; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
    .pair { display: flex; gap: 8px; }
    .pair input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--hair); background: var(--bg); color: var(--ink); font: inherit; }
    .wx { display: grid; justify-items: end; gap: 2px; text-align: right; }
    .sum { margin-top: 12px; font-size: 13px; color: var(--ink-2); }
    .list { padding: 4px 14px; margin-top: 12px; }
    .note { padding: 18px; margin-top: 12px; font-size: 14px; color: var(--ink-2); }
    .evt { padding: 0 0 6px 58px; }
    .evt__f { display: block; margin-top: -4px; font-size: 12px; color: var(--ink-2); }
    .evt__b {
      display: inline-flex; align-items: center; gap: 4px; min-height: 44px; margin-top: 0;
      font-size: 12.5px; font-weight: 500; color: var(--ink-2); background: none; border: 0; padding: 0 8px 0 0; cursor: pointer;
    }
    .evt__c { display: inline-flex; transition: transform var(--dur-fast) var(--ease-out); }
    .evt__c.open { transform: rotate(180deg); }
    @media (prefers-reduced-motion: reduce) { .evt__c { transition: none; } }
    .evt__b:hover { color: var(--blue); }
    .more { margin-top: 10px; padding: 6px 4px; }
    .foot { margin-top: 12px; padding: 0 4px; }
    @media (min-width: 720px) {
      .wk { padding-top: 32px; }
      .ttl { font-size: 34px; }
      .list, .note, .custom, .foot { max-width: 720px; }
    }
  `],
})
export class WeekendPage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly climate = inject(ClimateService);

  protected readonly presets = WEEKEND_PRESETS;
  protected readonly preset = signal<WeekendPreset>('this');
  /** Set when Custom is first chosen, from the window then shown (hub-local). */
  protected readonly custom = signal<WeekendWindow | null>(null);
  protected readonly all = signal(false);
  /** The destination whose "What's on" is open; events are fetched only for it, on tap. */
  protected readonly events = signal<string | null>(null);

  /** Today at the hub: flight dates are hub-local, so the device's date can be a day off. */
  private readonly hubToday = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));

  protected readonly window = computed<WeekendWindow>(() =>
    (this.preset() === 'custom' && this.custom()) || presetWindow(this.preset(), this.hubToday()));
  /** The minute: the options need not recompute on every clock tick. */
  private readonly nowMin = computed(() => Math.floor(this.state.nowMs() / MINUTE_MS) * MINUTE_MS);
  protected readonly problem = computed(() => windowProblem(this.window(), this.state.hub(), this.nowMin()));
  protected readonly minKey = computed(() => this.hubToday());
  protected readonly maxKey = computed(() => this.state.coverage().to ?? '');

  private readonly options = computed<WeekendOption[]>(() => this.problem() ? [] : weekendOptions({
    hub: this.state.hub(), nowMs: this.nowMin(), window: this.window(),
    connect: this.state.connect(), showConnections: this.state.showConnections(),
  }));

  protected readonly rows = computed(() => {
    const index = this.climate.index();
    const globals = this.state.globalParams();
    const month = Number(this.window().leaveKey.slice(5, 7));
    return this.options().map(o => {
      const first = o.out[0];
      const c = climateFor(index, o.code, month);
      return {
        o,
        meta: weekendMeta(o, this.state.showConnections()),
        // The month-only text ('Oct 19° / 12°') read as a date; the chip is just the temperatures, with "Typical weather" for screen readers.
        weather: c ? `${c.tmaxC}° / ${c.tminC}°` : null,
        arrKey: first.arrDateKey,
        link: flightPath(o.code, first.dateKey, first),
        query: { ...globals, ret: o.retKey },
      };
    });
  });
  protected readonly shown = computed(() => this.all() ? this.rows() : this.rows().slice(0, WEEKEND_LIMIT));

  constructor() {
    void this.climate.ensureLoaded();
  }

  protected choose(p: WeekendPreset): void {
    if (p === 'custom' && !this.custom()) this.custom.set(this.window());
    this.preset.set(p);
    this.all.set(false);
  }

  protected back(): void {
    this.state.goBack(['/']);
  }

  protected cityOf(code: string): string {
    return findDestination(code)?.city ?? code;
  }

  protected toggleEvents(code: string): void {
    this.events.update(c => (c === code ? null : code));
  }

  protected edit(field: keyof WeekendWindow, value: string): void {
    this.custom.set({ ...this.window(), [field]: value });
  }

  protected stamp(key: string, hhmm: string): string {
    if (!isDateKey(key)) return '…';
    return `${formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' })} ${formatClock(hhmm, this.state.timeFormat())}`;
  }
}
