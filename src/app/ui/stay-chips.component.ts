import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChildren } from '@angular/core';
import { IconComponent } from '../components/shared/icons.component';
import { t } from '../i18n/t';
import { MAX_NIGHTS, type StayOption, dayCountAria } from '../planner/round-trip';
import { dayLabel, dayNum } from './format';
import { tap } from './haptics';

interface Chip {
  nights: number;
  key: string;
  top: string;
  sub: string;
  zero: boolean;
  closed: boolean;
  aria: string;
}

/**
 * Stay chips (dates-spec §3.5): five stays compared with no tap, each '4
 * nights' over 'Tue 24 · 3 home'. A radiogroup with a roving tab stop: the
 * checked chip has a red ring, aria-checked and a check glyph; a stay with no
 * way home has a dashed border and says '0 home'; an unpublished day says
 * 'not published'. A last "Other" chip opens a − / + stepper (1..30 nights)
 * whose option comes from `compute` ('9 nights · Mon, Nov 30 · 2 home');
 * picking emits the return day.
 */
@Component({
  selector: 'app-stay-chips',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc" role="radiogroup" [attr.aria-label]="t('planner.chips.aria')">
      @for (c of chips(); track c.key) {
        <button #chip type="button" role="radio" class="sc__c" [attr.data-nights]="c.nights"
                [class.is-on]="c.nights === selected()" [class.is-zero]="c.zero" [class.is-closed]="c.closed"
                [attr.aria-checked]="c.nights === selected()" [attr.aria-label]="c.aria"
                [attr.aria-disabled]="c.closed ? 'true' : null"
                [attr.tabindex]="$index === tabStop() ? 0 : -1"
                (click)="choose(c)" (keydown)="onKey($event, $index)">
          <span class="sc__t">
            @if (c.nights === selected()) { <app-icon class="sc__ok" name="check" [size]="13" [strokeWidth]="2.5" /> }
            {{ c.top }}
          </span>
          <span class="sc__s tn">{{ c.sub }}</span>
        </button>
      }
      @if (compute()) {
        <button #chip type="button" role="radio" class="sc__c sc__c--other" [class.is-on]="otherOn()"
                [attr.aria-checked]="otherOn()"
                [attr.tabindex]="chips().length === tabStop() ? 0 : -1"
                (click)="toggleOther()" (keydown)="onKey($event, chips().length)">
          <span class="sc__t">
            @if (otherOn()) { <app-icon class="sc__ok" name="check" [size]="13" [strokeWidth]="2.5" /> }
            {{ t('planner.chips.other') }}
          </span>
        </button>
      }
    </div>
    @if (otherOpen() && other(); as o) {
      <div class="st">
        <button type="button" class="st__b" [attr.aria-label]="t('planner.chips.fewer')" [disabled]="o.nights <= 1"
                (click)="step(-1)">−</button>
        <button type="button" class="st__v tn" [class.is-zero]="o.zero" [attr.aria-label]="o.aria"
                [attr.aria-disabled]="o.closed ? 'true' : null" (click)="choose(o)">
          {{ o.top }} · {{ o.date }} · {{ o.count }}
        </button>
        <button type="button" class="st__b" [attr.aria-label]="t('planner.chips.more')" [disabled]="o.nights >= max"
                (click)="step(1)">+</button>
      </div>
      <p class="ui-visually-hidden" aria-live="polite" data-stepper-live>{{ o.aria }}</p>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .sc {
      display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity; padding: 3px 24px 3px 3px;
      scrollbar-width: none;
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
      mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
    }
    .sc::-webkit-scrollbar { display: none; }
    .sc__c {
      flex: 0 0 auto; min-width: 96px; min-height: 56px; padding: 7px 12px; scroll-snap-align: start;
      display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 2px;
      border-radius: 12px; background: var(--fill); color: var(--ink); text-align: left; line-height: 1.25;
      border: 1px solid transparent;
    }
    .sc__c--other { align-items: center; }
    .sc__t { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 650; white-space: nowrap; }
    .sc__s { font-size: 12px; color: var(--ink-2); white-space: nowrap; }
    .sc__ok { color: var(--red); }
    .sc__c.is-zero { border: 1px dashed var(--ink-2); background: transparent; }
    .sc__c.is-closed { background: transparent; border: 1px dashed var(--hair); }
    .sc__c.is-on { box-shadow: inset 0 0 0 2px var(--red); }
    .st { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .st__b {
      flex: 0 0 auto; width: 44px; height: 44px; min-height: 44px; border-radius: 50%; background: var(--fill);
      font-size: 20px; font-weight: 600; color: var(--ink);
    }
    .st__b:disabled { opacity: .4; }
    .st__v {
      flex: 1; min-width: 0; min-height: 44px; padding: 6px 10px; border-radius: 12px; background: var(--fill);
      font-size: 14px; font-weight: 600; color: var(--ink); text-align: center;
    }
    .st__v.is-zero { border: 1px dashed var(--ink-2); background: transparent; }
  `],
})
export class StayChipsComponent {
  protected readonly t = t;
  protected readonly max = MAX_NIGHTS;

  readonly options = input.required<readonly StayOption[]>();
  /** The checked stay, in nights (null: none). */
  readonly selected = input<number | null>(null);
  readonly dep = input.required<string>();
  /** For the year rule of the stepper's date (defaults to the departure). */
  readonly today = input<string | null>(null);
  /** stayOptions(..., [n])[0]: shows the "Other" chip and its stepper when set. */
  readonly compute = input<((nights: number) => StayOption) | null>(null);

  /** The return day key. */
  readonly pick = output<string>();

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('chip');
  protected readonly otherOpen = signal(false);
  private readonly otherNights = signal<number | null>(null);
  private readonly focused = signal<number | null>(null);

  readonly chips = computed<Chip[]>(() => this.options().map(chipOf));

  /** True when the selected stay is not one of the preset chips. */
  readonly otherOn = computed(() => {
    const s = this.selected();
    return s !== null && !this.options().some(o => o.nights === s);
  });

  readonly other = computed(() => {
    const fn = this.compute();
    if (!fn) return null;
    const n = this.otherNights() ?? (this.otherOn() ? this.selected()! : nextOther(this.options()));
    const o = fn(n);
    const c = chipOf(o);
    return {
      ...c,
      date: dayLabel(o.key, this.today() ?? this.dep()),
      count: o.count.state === 'unpublished' ? t('planner.chips.unpublished') : t('planner.count.home', { n: o.count.total }),
    };
  });

  /** Index of the chip that takes Tab: the focused one, else the checked one, else the first. */
  readonly tabStop = computed(() => {
    const f = this.focused();
    const last = this.chips().length + (this.compute() ? 1 : 0) - 1;
    if (f !== null && f <= last) return f;
    const s = this.selected();
    const i = this.chips().findIndex(c => c.nights === s);
    if (i >= 0) return i;
    return this.otherOn() ? this.chips().length : 0;
  });

  protected choose(c: { key: string }): void {
    tap();
    this.pick.emit(c.key);
  }

  protected toggleOther(): void {
    this.focused.set(this.chips().length);
    this.otherOpen.update(v => !v);
  }

  protected step(d: -1 | 1): void {
    const cur = this.other()?.nights ?? 1;
    this.otherNights.set(Math.min(MAX_NIGHTS, Math.max(1, cur + d)));
  }

  protected onKey(e: KeyboardEvent, i: number): void {
    const n = this.chips().length + (this.compute() ? 1 : 0);
    let j: number;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowUp': j = (i - 1 + n) % n; break;
      case 'ArrowRight': case 'ArrowDown': j = (i + 1) % n; break;
      case 'Home': j = 0; break;
      case 'End': j = n - 1; break;
      default: return;
    }
    e.preventDefault();
    this.focused.set(j);
    this.buttons()[j]?.nativeElement.focus();
  }
}

/** The first stay length after the presets (e.g. 8 after 2, 3, 4, 5, 7). */
function nextOther(options: readonly StayOption[]): number {
  const max = options.reduce((m, o) => Math.max(m, o.nights), 0);
  return Math.min(MAX_NIGHTS, Math.max(1, max + 1));
}

/** One chip's text. Exported for specs. */
export function chipOf(o: StayOption): Chip {
  const c = o.count;
  const closed = c.state === 'unpublished' || c.state === 'past' || c.state === 'loading';
  const what = c.state === 'unpublished' ? t('planner.chips.unpublished')
    : c.state === 'loading' ? '·'
    : t('planner.count.home', { n: c.total });
  return {
    nights: o.nights,
    key: o.key,
    top: t('planner.nights', { n: o.nights }),
    sub: `${dayNum(o.key)} · ${what}`,
    zero: c.state === 'none',
    closed,
    aria: dayCountAria(c, 'home'),
  };
}
