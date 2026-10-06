import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ClimateService } from '../../recs/climate.service';
import { MONTH_SHORT, climateFor, wetDaysText } from '../../recs/climate';
import type { ClimateMonth } from '../../recs/model';
import { ClimateCreditComponent } from '../../recs/ui/climate-credit.component';

/** Month numbers with the highest high and the fewest wet days (ties all count). Pure. */
export function climateHighlights(months: readonly ClimateMonth[]): { warmest: Set<number>; driest: Set<number> } {
  const hi = Math.max(...months.map(m => m.tmaxC));
  const dry = Math.min(...months.map(m => m.wetDays));
  return {
    warmest: new Set(months.filter(m => m.tmaxC === hi).map(m => m.month)),
    driest: new Set(months.filter(m => m.wetDays === dry).map(m => m.month)),
  };
}

/**
 * Destination Essentials: "Typical in Oct: 24° / 18° · 9 wet days" and a
 * 12-month strip of highs (wet days under each), the warmest and driest
 * months marked. Typical, never a forecast. Renders nothing without normals.
 */
@Component({
  selector: 'app-dest-climate',
  standalone: true,
  imports: [ClimateCreditComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <div class="cl" data-climate>
        <p class="cl__t tn"><b>Typical in {{ v.name }}</b> · {{ v.cur.tmaxC }}° / {{ v.cur.tminC }}° · {{ wet(v.cur.wetDays) }}</p>
        <ol class="cl__s" aria-label="Typical monthly highs and wet days">
          @for (m of v.months; track m.month) {
            <li class="m" [class.is-cur]="m.month === v.cur.month" [attr.aria-current]="m.month === v.cur.month ? 'date' : null">
              <span class="ui-visually-hidden">{{ label(m, v) }}</span>
              <span class="m__hi tn" aria-hidden="true">{{ m.tmaxC }}°</span>
              <span class="m__bar" aria-hidden="true" [class.is-warm]="v.warmest.has(m.month)" [style.height.px]="h(m.tmaxC, v)"></span>
              <span class="m__wet tn" aria-hidden="true" [class.is-dry]="v.driest.has(m.month)">{{ m.wetDays }}</span>
              <span class="m__n" aria-hidden="true">{{ short(m.month) }}</span>
            </li>
          }
        </ol>
        <p class="cl__k ui-sub"><span class="dot dot--warm"></span>Warmest <span class="dot dot--dry"></span>Driest (fewest wet days)</p>
        <app-climate-credit />
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .cl { display: grid; gap: 8px; margin-top: 12px; }
    .cl__t { margin: 0; font-size: 13.5px; color: var(--ink-2); }
    .cl__t b { color: var(--ink); font-weight: 650; }
    .cl__s { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 2px; align-items: end; }
    .m { display: grid; justify-items: center; gap: 2px; padding: 4px 0; border-radius: 8px; font-size: 10.5px; color: var(--ink-2); }
    .m.is-cur { background: var(--fill); color: var(--ink); font-weight: 650; }
    .m__bar { width: 10px; min-height: 4px; border-radius: 3px; background: var(--hair); }
    .m__bar.is-warm { background: var(--amber); }
    .m__wet.is-dry { color: var(--teal-ink); font-weight: 700; }
    .m__n { font-size: 9.5px; color: var(--ink-3); }
    .cl__k { margin: 0; font-size: 11.5px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot--warm { background: var(--amber); }
    .dot--dry { background: var(--teal); margin-left: 8px; }
  `],
})
export class DestClimateComponent {
  private readonly climate = inject(ClimateService);

  readonly code = input.required<string>();
  /** The day the weather is for (a date key); the page passes the picked day, else today at the destination. */
  readonly dateKey = input.required<string>();

  constructor() {
    void this.climate.ensureLoaded();
  }

  protected readonly view = computed(() => {
    const idx = this.climate.index();
    const month = Number(this.dateKey().slice(5, 7));
    const cur = climateFor(idx, this.code(), month);
    if (!idx || !cur) return null;
    const months = Array.from({ length: 12 }, (_, i) => climateFor(idx, this.code(), i + 1)!);
    const hi = Math.max(...months.map(m => m.tmaxC));
    const lo = Math.min(...months.map(m => m.tmaxC));
    return { cur, name: MONTH_SHORT[month - 1], months, hi, lo, ...climateHighlights(months) };
  });

  protected short(m: number): string {
    return MONTH_SHORT[m - 1].charAt(0);
  }

  protected wet(n: number): string {
    return wetDaysText(n);
  }

  protected label(m: ClimateMonth, v: { cur: ClimateMonth; warmest: Set<number>; driest: Set<number> }): string {
    const tags = [
      v.warmest.has(m.month) ? 'warmest' : '',
      v.driest.has(m.month) ? 'driest' : '',
      m.month === v.cur.month ? 'current month' : '',
    ].filter(Boolean);
    return [`${MONTH_SHORT[m.month - 1]}: typical high ${m.tmaxC}°`, wetDaysText(m.wetDays), ...tags].join(', ');
  }

  /** Bar height 8..40px, scaled between the coolest and warmest month. */
  protected h(t: number, v: { hi: number; lo: number }): number {
    return v.hi === v.lo ? 24 : Math.round(8 + ((t - v.lo) / (v.hi - v.lo)) * 32);
  }
}
