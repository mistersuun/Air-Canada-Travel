import { ChangeDetectionStrategy, Component, Directive, computed, input, output } from '@angular/core';
import { t } from '../../i18n/t';
import type { CountCtx } from '../../planner/round-trip';
import type { TimeFormat } from '../../state/prefs.service';
import { daySignals, signalText } from '../../trips/engine/busy-signals';
import { weekdayLetters } from '../../utils/time';
import {
  cellCount, dayAria, dayMarker, listRowText, monthDays, monthTitle, monthWeeks, nonstopWeekdays, nonstopsLine,
  type CalDay, type CalVariant, type DayMarker, type HomeBasis,
} from './cal-model';

interface Cell extends CalDay {
  txt: string;
  marker: DayMarker;
  /** Past, before the departure, or not yet published: drawn in ink-3. */
  dim: boolean;
  ok: boolean;
  holiday: boolean;
  brk: boolean;
  title: string | null;
  aria: string;
}

/** Shared inputs and derived data of one month, for the grid and the List view. */
@Directive()
abstract class MonthBase {
  readonly ym = input.required<string>();
  readonly hub = input.required<string>();
  readonly code = input.required<string>();
  readonly ctx = input.required<CountCtx>();
  readonly fmt = input<TimeFormat>('24h');
  /** Set: the month counts ways home after this departure; null: flights out. */
  readonly home = input<HomeBasis | null>(null);
  readonly dep = input<string | null>(null);
  readonly ret = input<string | null>(null);

  /** Every tap, even on a day that can't be picked (the page explains why). */
  readonly pick = output<string>();

  protected readonly t = t;
  readonly variant = computed<CalVariant>(() => (this.home() ? 'home' : 'out'));
  readonly days = computed<CalDay[]>(() => monthDays(this.hub(), this.code(), this.ym(), this.ctx(), this.fmt(), this.home()));

  /** ', your departure' / ', your return' / ', during your stay': what a selected or in-range day is, in words. */
  protected roleSuffix(key: string): string {
    const dep = this.dep();
    const ret = this.ret();
    const word = key === dep ? 'planner.cell.isDep' : key === ret ? 'planner.cell.isRet' : this.inRange(key) ? 'planner.cell.inStay' : null;
    return word ? `, ${t(word)}` : '';
  }

  protected inRange(key: string): boolean {
    const dep = this.dep();
    const ret = this.ret();
    return !!dep && !!ret && key > dep && key < ret;
  }

  protected readonly title = computed(() => monthTitle(this.ym()));
  /** Every remaining day is beyond the published window. */
  readonly unpublished = computed(() => {
    const live = this.days().filter(d => !d.past);
    return live.length > 0 && live.every(d => d.outside);
  });
  /** 'Nonstops: Tue, Thu, Fri, Sun' in the direction counted. */
  protected readonly nonstops = computed(() => {
    const [from, to] = this.home() ? [this.code(), this.hub()] : [this.hub(), this.code()];
    const c = this.ctx();
    return nonstopsLine(nonstopWeekdays(from, to, this.ym(), c.today, c.coverage));
  });
}

/**
 * One month of the round-trip picker: a 7-column grid of 56px day cells,
 * each with two lines, the day and a count (flights out, or ways home once a
 * departure is set) with a shape marker under it: solid for a day with a
 * nonstop, dotted for connections only, '–' for none, a hatch for not yet
 * published. Nights are not printed in a cell (footer, aria, chips, List).
 * The departure and return are red rounded squares joined by a tinted range.
 *
 * Every day but a past one stays focusable; days that can't be picked carry
 * aria-disabled and the reason in their label, and a tap still reaches the
 * page, which says why in the footer. The page owns keyboard handling and the
 * roving tabindex (`focusKey`).
 */
@Component({
  selector: 'app-cal-month',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="ui-h3 mh" [class.mh--dim]="unpublished()" [id]="'m-' + ym()">{{ title() }}</h2>
    @if (unpublished()) { <p class="ms">{{ t('planner.unpublished') }}</p> }
    @else if (nonstops(); as nl) { <p class="ms">{{ nl }}</p> }
    <div class="wkh wkh--own" aria-hidden="true">
      @for (w of weekdays(); track $index) { <span>{{ w }}</span> }
    </div>
    <div class="cal" role="grid" [attr.aria-labelledby]="'m-' + ym()" [attr.aria-busy]="ctx().loading || null"
         [class.cal--dim]="unpublished()">
      @for (row of weeks(); track $index) {
        <div class="r" role="row">
          @for (d of row; track $index) {
            @if (d) {
              <button type="button" role="gridcell" class="d"
                      [class.off]="d.dim" [class.today]="d.key === ctx().today" [class.zero]="d.count.state === 'none'"
                      [class.dm--hatch]="d.marker === 'hatch'"
                      [class.s]="d.key === dep()" [class.e]="d.key === ret() && d.key !== dep()"
                      [class.solo]="d.key === dep() && (!ret() || ret() === dep())"
                      [class.mid]="inRange(d.key)"
                      [attr.title]="d.title"
                      [attr.data-key]="d.key" [attr.tabindex]="d.key === focusKey() ? 0 : -1"
                      [attr.aria-selected]="d.key === dep() || d.key === ret()"
                      [attr.aria-disabled]="d.ok ? null : 'true'"
                      [attr.aria-label]="d.aria + roleSuffix(d.key)"
                      (click)="tap(d)">
                <span class="n tn">{{ d.day }}</span>
                @if (d.holiday || d.brk) {
                  <span class="mks" aria-hidden="true">
                    @if (d.holiday) { <i class="mk mk--h"></i> }
                    @if (d.brk) { <i class="mk mk--b"></i> }
                  </span>
                }
                <span class="c tn" aria-hidden="true">{{ d.txt }}</span>
                @if (d.marker && d.marker !== 'hatch') { <i class="dm" [class]="'dm dm--' + d.marker" aria-hidden="true"></i> }
                @else { <i class="dm dm--sp" aria-hidden="true"></i> }
              </button>
            } @else {
              <span class="pad" role="gridcell"></span>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mh { padding: 0 6px 4px; font-size: 17px; scroll-margin-top: var(--cal-sticky, 120px); }
    .mh--dim { color: var(--ink-3); }
    .ms { font-size: 12.5px; color: var(--ink-2); padding: 0 6px 8px; }
    .wkh--own {
      display: none; grid-template-columns: repeat(7, 1fr); text-align: center;
      font-size: 11px; font-weight: 600; color: var(--ink-3); padding: 6px 0 8px;
    }
    .cal { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: 4px; text-align: center; }
    .cal--dim { opacity: .6; }
    .r { display: contents; }
    .d {
      height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding-top: 4px;
      position: relative; isolation: isolate; color: var(--ink); width: 100%; scroll-margin-top: var(--cal-sticky, 120px);
      scroll-margin-bottom: 150px;
    }
    .n { font-size: 15px; font-weight: 650; line-height: 1.1; }
    .c { font-size: 12px; font-weight: 650; line-height: 1; min-height: 12px; color: var(--ink-2); }
    .dm { color: var(--teal); margin-top: 1px; }
    .dm--sp { visibility: hidden; }
    .d:focus-visible { outline-offset: -2px; border-radius: 14px; }
    .d:not(.off):hover .n { color: var(--red); }
    .d.off { color: var(--ink-3); }
    .d.off .c { color: var(--ink-3); }
    .d.today { color: var(--blue); }
    .d.zero .c { color: var(--ink-3); }
    .d.dm--hatch { border-radius: 10px; }
    /* Neutral date markers: a filled dot for a holiday, a ring for a school break. */
    .mks { position: absolute; top: 3px; left: 0; right: 0; display: flex; justify-content: center; gap: 3px; }
    .mk { width: 5px; height: 5px; border-radius: 50%; box-sizing: border-box; }
    .mk--h { background: var(--ink-2); }
    .mk--b { border: 1.5px solid var(--ink-2); }
    .d.mid { background: color-mix(in srgb, var(--red) 10%, transparent); }
    .d.s, .d.e { color: #FFFFFF; }
    .d.s .c, .d.e .c, .d.s .dm, .d.e .dm { color: #FFFFFF; }
    .d.s .mk--h, .d.e .mk--h { background: #FFFFFF; }
    .d.s .mk--b, .d.e .mk--b { border-color: #FFFFFF; }
    .d.s:hover .n, .d.e:hover .n { color: #FFFFFF; }
    .d.s::before, .d.e::before {
      content: ''; position: absolute; inset: 2px 3px; border-radius: 14px; background: var(--red-fill); z-index: -1;
    }
    .d.s { background: linear-gradient(90deg, transparent 50%, color-mix(in srgb, var(--red) 10%, transparent) 50%); }
    .d.e { background: linear-gradient(90deg, color-mix(in srgb, var(--red) 10%, transparent) 50%, transparent 50%); }
    .d.s.solo { background: none; }
    @media (min-width: 720px) {
      .wkh--own { display: grid; }
    }
  `],
})
export class CalMonthComponent extends MonthBase {
  readonly focusKey = input<string | null>(null);

  protected readonly weekdays = computed(() => weekdayLetters());
  private readonly signalCache = computed(() => {
    this.hub();
    return new Map<string, { holiday: boolean; brk: boolean; text: string }>();
  });

  readonly cells = computed<Cell[]>(() => {
    const variant = this.variant();
    return this.days().map(d => {
      const sg = this.signals(d.key);
      const base = dayAria(d, variant);
      const c = d.count;
      return {
        ...d,
        txt: cellCount(c),
        marker: dayMarker(c),
        dim: c.state === 'past' || c.state === 'before-dep' || c.state === 'unpublished',
        ok: c.state === 'ok',
        holiday: sg.holiday,
        brk: sg.brk,
        title: sg.text || null,
        aria: sg.text ? `${base}, ${sg.text}` : base,
      };
    });
  });
  protected readonly weeks = computed(() => monthWeeks(this.ym(), this.cells()));

  /** Holiday / school-break markers and their text for one day (empty when none). */
  private signals(key: string): { holiday: boolean; brk: boolean; text: string } {
    const cache = this.signalCache();
    let hit = cache.get(key);
    if (!hit) {
      const hub = this.hub();
      const s = hub ? daySignals(hub, key) : { holidays: [], schoolBreak: null };
      hit = { holiday: s.holidays.length > 0, brk: !!s.schoolBreak, text: hub ? signalText(hub, s).join('; ') : '' };
      cache.set(key, hit);
    }
    return hit;
  }

  protected tap(d: Cell): void {
    if (d.past) return;
    this.pick.emit(d.key);
  }
}

interface ListRow {
  key: string;
  text: string;
  on: boolean;
  marker: DayMarker;
}

/**
 * One month of the picker's List view: a 52px row per day with flights in
 * the direction counted ('Fri, Nov 20 · 2 nonstop · 18:05, 22:10', '8 nights ·
 * Sat, Nov 28 · 3 home · 07:10–13:00'). Rows are buttons that act like a cell
 * tap, so the List and the grid always show the same days.
 */
@Component({
  selector: 'app-cal-list-month',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="ui-h3 mh" [class.mh--dim]="unpublished()" [id]="'l-' + ym()">{{ title() }}</h2>
    @if (unpublished()) {
      <p class="ms">{{ t('planner.unpublished') }}</p>
    } @else if (!rows().length) {
      <p class="ms ms--none">{{ t('planner.legend.none') }}</p>
    } @else {
      <div class="ls">
        @for (r of rows(); track r.key) {
          <button type="button" class="lr" [class.on]="r.on" [attr.data-list-key]="r.key" [attr.aria-pressed]="r.on"
                  [attr.aria-label]="r.text + roleSuffix(r.key)" (click)="pick.emit(r.key)">
            <i [class]="'dm dm--' + r.marker" aria-hidden="true"></i>
            <span class="lr__t tn">{{ r.text }}</span>
          </button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .mh { padding: 0 6px 6px; font-size: 17px; }
    .mh--dim { color: var(--ink-3); }
    .ms { font-size: 12.5px; color: var(--ink-2); padding: 0 6px 8px; }
    .ms--none::first-letter { text-transform: uppercase; }
    .ls { display: flex; flex-direction: column; border-top: 1px solid var(--hair); }
    .lr {
      display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 6px; text-align: left;
      border-bottom: 1px solid var(--hair); color: var(--ink); font-size: 14px; font-weight: 550; line-height: 1.3;
    }
    .lr .dm { flex: none; margin: 0; color: var(--teal); }
    .lr__t { min-width: 0; overflow-wrap: anywhere; }
    .lr.on { box-shadow: inset 3px 0 0 var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); }
  `],
})
export class CalListMonthComponent extends MonthBase {
  readonly rows = computed<ListRow[]>(() => {
    const variant = this.variant();
    const today = this.ctx().today;
    const dep = this.dep();
    const ret = this.ret();
    return this.days()
      .filter(d => d.count.state === 'ok')
      .map(d => ({
        key: d.key,
        text: listRowText(d.count, variant, today),
        on: d.key === dep || d.key === ret,
        marker: dayMarker(d.count),
      }));
  });
}
