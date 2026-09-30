import {
  ChangeDetectionStrategy, Component, DOCUMENT, ElementRef, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import type { Coverage } from '../../data/schedule-index';
import { formatWeekLabel } from '../../utils/week';
import {
  WEEKDAY_LONG, WEEKDAY_SHORT, addDays, dateKey, diffDays, formatKey, isDateKey, weekKeys, weekStartKey as mondayOf,
} from '../../utils/time';
import { IconComponent } from '../shared/icons.component';
import { shortcutAllowed } from '../header/keyboard';

export interface StripDay {
  key: string;
  dow: string;
  date: number;
  label: string;
  today: boolean;
  outside: boolean;
}

/** Schedules older than this many days are flagged as possibly stale. */
export const STALE_AFTER_DAYS = 14;

/** 'Sep 28 – Oct 4' within a year; 'Dec 28, 2026 – Jan 3, 2027' across years. */
export function weekRangeLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  if (weekStart.slice(0, 4) !== end.slice(0, 4)) return formatWeekLabel(weekStart);
  const s = formatKey(weekStart, { month: 'short', day: 'numeric' });
  const e = weekStart.slice(5, 7) === end.slice(5, 7)
    ? formatKey(end, { day: 'numeric' })
    : formatKey(end, { month: 'short', day: 'numeric' });
  return `${s} – ${e}`;
}

/** 'today', 'yesterday', '3 days ago' for an ISO timestamp relative to a date key. */
export function freshnessAge(generatedAt: string, today: string): { days: number; text: string } | null {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, diffDays(dateKey(new Date(t)), today));
  const text = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return { days, text };
}

/**
 * Week strip: week label with a date picker, prev/next/Today, a stable row of
 * day buttons with one sliding active pill, and a meta line with the route
 * count and schedule freshness. Keyboard: ←/→ weeks, 1–7 days, 0 all week,
 * T today (ignored in fields and while a dialog is open).
 */
@Component({
  selector: 'app-week-strip',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <section class="ws" aria-label="Travel week">
      <div class="ws__top">
        <div class="ws__when">
          <button type="button" class="ws__label" (click)="openPicker()"
                  [attr.aria-label]="'Week of ' + fullLabel() + '. Choose a date'">
            <span class="ws__range ui-num">{{ rangeLabel() }}</span>
            @if (showYear()) { <span class="ws__year ui-num">{{ weekStartKey().slice(0, 4) }}</span> }
            <app-icon name="calendar" [size]="16" class="ws__cal" />
          </button>
          <input #picker type="date" class="ws__picker" [class.is-shown]="pickerShown()"
                 aria-label="Jump to date" [tabindex]="pickerShown() ? 0 : -1"
                 [min]="coverage()?.from ?? ''" [max]="coverage()?.to ?? ''"
                 [value]="selectedDateKey() ?? weekStartKey()" (change)="onPick($event)">
        </div>
        <div class="ws__nav">
          <button type="button" class="ws__today" (click)="jumpTo.emit(todayKey())"
                  [disabled]="selectedDateKey() === todayKey()">Today</button>
          <button type="button" class="ui-icon-btn ws__arrow" (click)="prev.emit()" [disabled]="prevDisabled()"
                  [attr.aria-label]="'Previous week, ' + weekRange(-7)">
            <app-icon name="chevron-left" [size]="18" />
          </button>
          <button type="button" class="ui-icon-btn ws__arrow" (click)="next.emit()" [disabled]="nextDisabled()"
                  [attr.aria-label]="'Next week, ' + weekRange(7)">
            <app-icon name="chevron-right" [size]="18" />
          </button>
        </div>
      </div>

      <div class="ws__days" role="group" aria-label="Choose a day" [style.--i]="activeIndex()">
        <span class="ws__pill" aria-hidden="true"></span>
        <button type="button" class="ws__day ws__day--all" [attr.aria-pressed]="selectedDateKey() === null"
                [attr.aria-label]="'All week, ' + fullLabel()" (click)="selectDay.emit(null)">
          <span class="ws__dow">Week</span><span class="ws__date">All</span>
        </button>
        @for (d of days(); track d.key) {
          <button type="button" class="ws__day" [attr.aria-pressed]="selectedDateKey() === d.key"
                  [class.is-today]="d.today" [class.is-outside]="d.outside"
                  [attr.aria-label]="d.label" [attr.title]="d.outside ? outsideTitle() : null"
                  (click)="selectDay.emit(d.key)">
            <span class="ws__dow">{{ d.dow }}</span><span class="ws__date ui-num">{{ d.date }}</span>
          </button>
        }
      </div>

      <p class="ws__meta">
        <span class="ws__count ui-num" aria-live="polite">{{ countText() }}</span>
        @if (freshness(); as f) {
          <span class="ws__fresh" [class.is-stale]="f.stale">
            <span class="ws__dot" aria-hidden="true"></span>{{ f.text }}
          </span>
        }
      </p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ws { padding: 2px var(--gutter) var(--space-2); max-width: 1280px; margin: 0 auto; }
    .ws__top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 44px; }
    .ws__when { position: relative; display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
    .ws__label {
      display: inline-flex; align-items: baseline; gap: 6px; min-height: 40px; padding: 0 8px; margin-left: -8px;
      border: 0; border-radius: 10px; background: none; cursor: pointer; color: var(--ink); white-space: nowrap;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .ws__label:hover { background: var(--surface-2); }
    .ws__range { font-size: 17px; font-weight: 600; letter-spacing: -.01em; align-self: center; }
    .ws__year { font-family: var(--font-code); font-size: 13px; color: var(--ink-3); align-self: center; }
    .ws__cal { color: var(--accent); align-self: center; }
    .ws__picker { position: absolute; left: 0; top: 100%; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .ws__picker.is-shown {
      position: static; width: auto; height: 36px; opacity: 1; pointer-events: auto; padding: 0 8px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink);
    }
    .ws__nav { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .ws__today {
      height: 32px; padding: 0 12px; margin-right: 4px; border-radius: var(--radius-chip);
      border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 13px; font-weight: 600;
      cursor: pointer;
    }
    .ws__today:disabled { color: var(--ink-3); cursor: default; }
    .ws__arrow:disabled { opacity: .35; cursor: default; background: none; }

    .ws__days {
      --pad: 3px;
      position: relative; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr));
      padding: var(--pad); border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line);
    }
    .ws__pill {
      position: absolute; top: var(--pad); bottom: var(--pad); left: var(--pad);
      width: calc((100% - 2 * var(--pad)) / 8);
      border-radius: 11px; background: var(--accent-fill);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--accent-fill) 40%, transparent);
      transform: translateX(calc(var(--i, 0) * 100%));
      transition: transform var(--dur) var(--ease-out);
    }
    .ws__day {
      position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; min-height: 48px; padding: 4px 0; border: 0; border-radius: 11px; background: none; cursor: pointer;
      color: var(--ink); transition: color var(--dur) var(--ease-out);
    }
    .ws__day:focus-visible { outline-offset: -2px; }
    .ws__dow { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
    .ws__date { font-family: var(--font-code); font-size: 17px; font-weight: 600; line-height: 1.1; }
    .ws__day--all .ws__date { font-family: var(--font-ui); font-size: 14px; }
    .ws__day.is-today .ws__date::after {
      content: ''; position: absolute; left: 50%; bottom: 4px; width: 4px; height: 4px; margin-left: -2px;
      border-radius: 50%; background: var(--accent);
    }
    .ws__day.is-outside:not([aria-pressed='true']) {
      background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--line-strong) 45%, transparent) 4px 5px);
    }
    .ws__day.is-outside:not([aria-pressed='true']) .ws__date { color: var(--ink-3); }
    .ws__day[aria-pressed='true'], .ws__day[aria-pressed='true'] .ws__dow { color: var(--accent-ink); }
    .ws__day[aria-pressed='true'].is-today .ws__date::after { background: var(--accent-ink); }

    .ws__meta {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 2px 10px; margin: 6px 2px 0;
      font-size: 12px; color: var(--ink-3); min-height: 18px;
    }
    .ws__count { color: var(--ink-2); font-weight: 600; }
    .ws__fresh { display: inline-flex; align-items: center; gap: 5px; }
    .ws__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok-fill); }
    .ws__fresh.is-stale { color: var(--warn); font-weight: 600; }
    .ws__fresh.is-stale .ws__dot { background: var(--warn-fill); }

    @media (min-width: 900px) {
      .ws { display: grid; grid-template-columns: minmax(0, 1fr) minmax(520px, 680px) minmax(0, 1fr); align-items: center; column-gap: var(--space-4); }
      .ws__top { display: contents; }
      .ws__when { grid-column: 1; grid-row: 1; }
      .ws__days { grid-column: 2; grid-row: 1; }
      .ws__nav { grid-column: 3; grid-row: 1; justify-self: end; }
      .ws__meta { grid-column: 1 / -1; }
      .ws__range { font-size: 19px; }
    }
  `],
})
export class WeekStripComponent {
  private readonly doc = inject(DOCUMENT);

  // WS3 binding contract. Dates are 'YYYY-MM-DD' keys.
  readonly weekStartKey = input.required<string>();
  readonly selectedDateKey = input<string | null>(null);
  readonly todayKey = input<string>(dateKey(new Date()));
  readonly coverage = input<Coverage | null>(null);
  readonly routeCount = input(0);

  readonly prev = output<void>();
  readonly next = output<void>();
  readonly selectDay = output<string | null>();
  readonly jumpTo = output<string>();

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  protected readonly pickerShown = signal(false);

  readonly days = computed<StripDay[]>(() => {
    const today = this.todayKey();
    const cov = this.coverage();
    return weekKeys(this.weekStartKey()).map((key, i) => {
      const outside = !!cov && ((!!cov.from && key < cov.from) || (!!cov.to && key > cov.to) || (!cov.from && !cov.to));
      let label = `${WEEKDAY_LONG[i]}, ${formatKey(key, { month: 'long', day: 'numeric', year: 'numeric' })}`;
      if (key === today) label += ', today';
      if (outside) label += ', outside published schedules';
      return { key, dow: WEEKDAY_SHORT[i], date: +key.slice(8), label, today: key === today, outside };
    });
  });

  /** 0 = All week, 1–7 = Mon–Sun (drives the sliding pill). */
  readonly activeIndex = computed(() => {
    const sel = this.selectedDateKey();
    const i = sel ? this.days().findIndex(d => d.key === sel) : -1;
    return i + 1;
  });

  readonly rangeLabel = computed(() => weekRangeLabel(this.weekStartKey()));
  readonly fullLabel = computed(() => formatWeekLabel(this.weekStartKey()));
  /** The year is shown separately unless the range already carries it (cross-year weeks). */
  readonly showYear = computed(() => !this.rangeLabel().includes(','));

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
    return to ? `Outside published schedules (through ${this.longDate(to)})` : 'Outside published schedules';
  });

  readonly countText = computed(() => {
    const n = this.routeCount();
    const sel = this.selectedDateKey();
    const noun = n === 1 ? 'route' : 'routes';
    return sel ? `${n} ${noun} on ${formatKey(sel, { weekday: 'short', month: 'short', day: 'numeric' })}` : `${n} ${noun} this week`;
  });

  readonly freshness = computed<{ text: string; stale: boolean } | null>(() => {
    const cov = this.coverage();
    if (!cov) return null;
    if (!cov.to) return { text: 'No published schedules for this airport', stale: true };
    const through = `through ${this.longDate(cov.to)}`;
    const age = cov.generatedAt ? freshnessAge(cov.generatedAt, this.todayKey()) : null;
    if (!age) return { text: `Schedules ${through}`, stale: false };
    const stale = age.days > STALE_AFTER_DAYS;
    return {
      text: stale
        ? `Schedules may be stale · updated ${age.text} · ${through}`
        : `Schedules updated ${age.text} · ${through}`,
      stale,
    };
  });

  protected weekRange(offset: number): string {
    return weekRangeLabel(addDays(this.weekStartKey(), offset));
  }

  private longDate(key: string): string {
    return formatKey(key, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  openPicker(): void {
    const el = this.picker().nativeElement;
    const withPicker = el as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof withPicker.showPicker === 'function') {
        withPicker.showPicker();
        return;
      }
    } catch {
      // showPicker throws without user activation or in cross-origin frames: fall through.
    }
    this.pickerShown.set(true);
    queueMicrotask(() => el.focus());
  }

  onPick(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.pickerShown.set(false);
    if (!isDateKey(v)) return;
    const cov = this.coverage();
    if (cov?.from && v < cov.from) return this.jumpTo.emit(cov.from);
    if (cov?.to && v > cov.to) return this.jumpTo.emit(cov.to);
    this.jumpTo.emit(v);
  }

  onKey(e: KeyboardEvent): void {
    if (!shortcutAllowed(e, this.doc)) return;
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
