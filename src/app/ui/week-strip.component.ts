import {
  ChangeDetectionStrategy, booleanAttribute, Component, DOCUMENT, ElementRef, computed, inject, input, output, viewChild,
} from '@angular/core';
import type { Coverage } from '../data/schedule-index';
import { formatWeekLabel } from '../utils/week';
import {
  WEEKDAY_LONG, WEEKDAY_SHORT, addDays, dateKey, formatKey, isDateKey, weekKeys, weekStartKey as mondayOf,
} from '../utils/time';
import { IconComponent } from '../components/shared/icons.component';
import { shortcutAllowed } from '../shell/keyboard';
import { isOutside, weekRangeLabel } from './format';

export interface StripDay {
  key: string;
  dow: string;
  date: number;
  label: string;
  today: boolean;
  outside: boolean;
}

/** Horizontal swipe distance (px) that changes the week on touch. */
export const SWIPE_PX = 50;

/**
 * Week strip (`.wk` in the mockup): seven day cells on a glass track with one
 * sliding red pill. Tapping the selected day again returns to the whole week
 * (the pill hides). Desktop shows circular chevrons outside the track; touch
 * swipes change the week. When another week than today's is shown, a caption
 * row offers the week label (opens the native date picker) and "This week".
 *
 * With [shortcuts]="true" (Home only): ←/→ weeks, 1–7 days, 0 all week,
 * T today (ignored in fields and while a dialog is open).
 */
@Component({
  selector: 'app-week-strip',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <div class="ws" role="group" [attr.aria-label]="'Week of ' + fullLabel()">
      <button type="button" class="nav nav--prev ui-circ ui-circ--glass" (click)="prev.emit()" [disabled]="prevDisabled()"
              [attr.aria-label]="'Previous week, ' + weekRange(-7)">
        <app-icon name="chevron-left" [size]="18" [strokeWidth]="2" />
      </button>
      <div class="wk" [class.ui-glass]="glass()" (pointerdown)="swipeStart($event)" (pointerup)="swipeEnd($event)"
           (pointercancel)="swipeFrom = null">
        <span class="pill" aria-hidden="true" [class.is-hidden]="activeIndex() < 0"
              [style.left]="'calc(5px + ' + max0(activeIndex()) + ' * (100% - 10px) / 7)'"></span>
        @for (d of days(); track d.key) {
          <button type="button" class="d" [class.on]="selectedDateKey() === d.key" [class.is-today]="d.today"
                  [class.is-out]="d.outside" [attr.aria-pressed]="selectedDateKey() === d.key"
                  [attr.aria-label]="d.label" [attr.title]="d.outside ? outsideTitle() : null"
                  (click)="onDay(d.key)">
            <span class="dow">{{ d.dow }}</span>
            <b class="tn">{{ d.date }}</b>
            <i class="dt" [class.is-on]="hasDot($index, d)"></i>
          </button>
        }
      </div>
      <button type="button" class="nav nav--next ui-circ ui-circ--glass" (click)="next.emit()" [disabled]="nextDisabled()"
              [attr.aria-label]="'Next week, ' + weekRange(7)">
        <app-icon name="chevron-right" [size]="18" [strokeWidth]="2" />
      </button>
    </div>
    @if (!isCurrentWeek()) {
      <div class="cap">
        <button type="button" class="cap__label" (click)="openPicker()"
                [attr.aria-label]="'Week of ' + fullLabel() + '. Choose a date'">
          <app-icon name="calendar" [size]="15" /><span class="tn">{{ rangeLabel() }}</span>
        </button>
        <button type="button" class="ui-link cap__today" (click)="jumpTo.emit(todayKey())">This week</button>
      </div>
    }
    <input #picker type="date" class="picker" tabindex="-1" aria-label="Jump to date"
           [min]="coverage()?.from ?? ''" [max]="coverage()?.to ?? ''"
           [value]="selectedDateKey() ?? weekStartKey()" (change)="onPick($event)">
  `,
  styles: [`
    :host { display: block; position: relative; }
    .ws { display: flex; align-items: center; gap: 10px; }
    .wk { position: relative; display: flex; flex: 1; min-width: 0; padding: 5px; border-radius: 18px; touch-action: pan-y; }
    .wk:not(.ui-glass) { background: var(--fill); }
    .pill {
      position: absolute; top: 5px; bottom: 5px; width: calc((100% - 10px) / 7);
      border-radius: 14px; background: var(--red);
      box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--red) 70%, transparent);
      transition: left var(--dur) var(--ease-out), opacity var(--dur-fast);
    }
    .pill.is-hidden { opacity: 0; }
    .d {
      flex: 1; min-width: 0; position: relative; z-index: 1; padding: 8px 0; text-align: center; line-height: 1.2;
      border-radius: 14px; color: var(--ink);
    }
    .d:focus-visible { outline-offset: -2px; }
    .dow { display: block; font-size: 11px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .04em; }
    .d.is-today:not(.on) .dow { color: var(--blue); }
    .d b { font-size: 18px; font-weight: 650; }
    .dt { display: block; width: 4px; height: 4px; border-radius: 50%; margin: 3px auto 0; background: transparent; }
    .dt.is-on { background: var(--teal); }
    .d.is-out b { color: var(--ink-3); }
    .d.on { color: #FFFFFF; }
    .d.on .dow { color: rgba(255, 255, 255, .8); }
    .d.on .dt.is-on { background: #FFFFFF; }
    .nav { width: 32px; height: 32px; display: none; }
    .cap { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 13px; }
    .cap__label { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); font-weight: 600; padding: 2px 0; }
    .cap__label app-icon { color: var(--blue); }
    .picker { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; }
    @media (min-width: 1024px) {
      .nav { display: inline-grid; }
      .cap { padding: 0 42px; }
    }
  `],
})
export class WeekStripComponent {
  private readonly doc = inject(DOCUMENT);

  readonly weekStartKey = input.required<string>();
  readonly selectedDateKey = input<string | null>(null);
  readonly todayKey = input<string>(dateKey(new Date()));
  readonly coverage = input<Coverage | null>(null);
  /** Seven flags (Mon–Sun): a teal dot under days with a departure. Null hides the dots. */
  readonly dots = input<readonly boolean[] | null>(null);
  readonly glass = input(true, { transform: booleanAttribute });
  /** Bind the page-level keyboard shortcuts (Home only). */
  readonly shortcuts = input(false, { transform: booleanAttribute });

  readonly prev = output<void>();
  readonly next = output<void>();
  readonly selectDay = output<string | null>();
  readonly jumpTo = output<string>();

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  protected swipeFrom: { x: number; y: number } | null = null;

  readonly days = computed<StripDay[]>(() => {
    const today = this.todayKey();
    const cov = this.coverage();
    return weekKeys(this.weekStartKey()).map((key, i) => {
      const outside = !!cov && (isOutside(key, cov) || (!cov.from && !cov.to));
      let label = `${WEEKDAY_LONG[i]}, ${formatKey(key, { month: 'long', day: 'numeric', year: 'numeric' })}`;
      if (key === today) label += ', today';
      if (outside) label += ', outside published schedules';
      return { key, dow: WEEKDAY_SHORT[i], date: +key.slice(8), label, today: key === today, outside };
    });
  });

  /** 0–6 for Mon–Sun, −1 for the whole week (pill hidden). */
  readonly activeIndex = computed(() => {
    const sel = this.selectedDateKey();
    return sel ? this.days().findIndex(d => d.key === sel) : -1;
  });

  readonly rangeLabel = computed(() => weekRangeLabel(this.weekStartKey()));
  readonly fullLabel = computed(() => formatWeekLabel(this.weekStartKey()));
  readonly isCurrentWeek = computed(() => mondayOf(this.todayKey()) === this.weekStartKey());

  /** Arrows stop one week beyond the hub's published window. */
  readonly prevDisabled = computed(() => {
    const from = this.coverage()?.from;
    return !!from && addDays(this.weekStartKey(), -7) < addDays(mondayOf(from), -7);
  });
  readonly nextDisabled = computed(() => {
    const to = this.coverage()?.to;
    return !!to && addDays(this.weekStartKey(), 7) > addDays(mondayOf(to), 7);
  });

  readonly outsideTitle = computed(() => {
    const to = this.coverage()?.to;
    return to
      ? `Outside published schedules (through ${formatKey(to, { month: 'short', day: 'numeric', year: 'numeric' })})`
      : 'Outside published schedules';
  });

  protected max0(n: number): number {
    return Math.max(0, n);
  }

  protected hasDot(i: number, d: StripDay): boolean {
    const dots = this.dots();
    return !!dots && !!dots[i] && !d.outside;
  }

  protected weekRange(offset: number): string {
    return weekRangeLabel(addDays(this.weekStartKey(), offset));
  }

  protected onDay(key: string): void {
    this.selectDay.emit(this.selectedDateKey() === key ? null : key);
  }

  protected swipeStart(e: PointerEvent): void {
    this.swipeFrom = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY };
  }

  protected swipeEnd(e: PointerEvent): void {
    const from = this.swipeFrom;
    this.swipeFrom = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && !this.nextDisabled()) this.next.emit();
    else if (dx > 0 && !this.prevDisabled()) this.prev.emit();
  }

  openPicker(): void {
    const el = this.picker().nativeElement as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker();
        return;
      }
    } catch {
      // showPicker throws without user activation: fall back to focusing the input.
    }
    el.focus();
  }

  onPick(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (!isDateKey(v)) return;
    const cov = this.coverage();
    if (cov?.from && v < cov.from) return this.jumpTo.emit(cov.from);
    if (cov?.to && v > cov.to) return this.jumpTo.emit(cov.to);
    this.jumpTo.emit(v);
  }

  onKey(e: KeyboardEvent): void {
    if (!this.shortcuts() || !shortcutAllowed(e, this.doc)) return;
    const k = e.key;
    if (k === 'ArrowLeft' && !this.prevDisabled()) this.prev.emit();
    else if (k === 'ArrowRight' && !this.nextDisabled()) this.next.emit();
    else if (k === '0') this.selectDay.emit(null);
    else if (k >= '1' && k <= '7' && k.length === 1) this.selectDay.emit(this.days()[+k - 1].key);
    else if (k === 't' || k === 'T') this.jumpTo.emit(this.todayKey());
    else return;
    e.preventDefault();
  }
}
