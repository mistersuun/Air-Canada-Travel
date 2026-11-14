import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChildren } from '@angular/core';
import { IconComponent } from '../components/shared/icons.component';
import { t } from '../i18n/t';
import { type DayCount, dayCountAria } from '../planner/round-trip';
import { dayNum } from './format';
import { tap } from './haptics';

interface StripCell {
  key: string;
  day: string;
  /** Line 2: '2 flights' (out) or '8 nights' (home); the state word on a closed day. */
  mid: string;
  /** Line 3: the first departure (out) or '3 home' (home). */
  low: string;
  marker: 'solid' | 'dotted' | 'none' | null;
  ok: boolean;
  zero: boolean;
  hatch: boolean;
  dim: boolean;
  aria: string;
}

/**
 * A row of day cells with a count each (dates-spec §3.2): 'Fri 20 · 2 flights
 * · 18:05' for flights out, 'Sat 28 · 8 nights · 3 home' for ways home. A
 * listbox: the picked day has a red ring and aria-selected; days that are not
 * 'ok' stay focusable with aria-disabled and always carry words (never colour
 * alone). Chevrons ask the page for 7 more days either side (`extend`).
 * ←/→ move the focus, Home/End to the ends.
 */
@Component({
  selector: 'app-day-count-strip',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dcs">
      <button type="button" class="dcs__nav" [attr.aria-label]="t('planner.plan.stripPrev')" (click)="extend.emit(-1)">
        <app-icon name="chevron-left" [size]="16" [strokeWidth]="2" />
      </button>
      <div class="dcs__track" role="listbox" aria-orientation="horizontal" [attr.aria-label]="label() || null">
        @for (c of cells(); track c.key) {
          <button #cell type="button" role="option" class="dcs__c" [attr.data-key]="c.key"
                  [class.is-sel]="c.key === selected()" [class.is-zero]="c.zero" [class.is-dim]="c.dim"
                  [class.dm--hatch]="c.hatch"
                  [attr.aria-selected]="c.key === selected()" [attr.aria-disabled]="c.ok ? null : 'true'"
                  [attr.aria-label]="c.aria" [attr.tabindex]="c.key === focusKey() ? 0 : -1"
                  (click)="onPick(c.key)" (keydown)="onKey($event, $index)">
            <span class="dcs__d">{{ c.day }}</span>
            <span class="dcs__m tn">{{ c.mid }}</span>
            <span class="dcs__l tn">{{ c.low }}</span>
            @if (c.marker) { <i [class]="'dm dm--' + c.marker" aria-hidden="true"></i> }
          </button>
        }
      </div>
      <button type="button" class="dcs__nav" [attr.aria-label]="t('planner.plan.stripNext')" (click)="extend.emit(1)">
        <app-icon name="chevron-right" [size]="16" [strokeWidth]="2" />
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .dcs { display: flex; align-items: center; gap: 4px; }
    .dcs__track {
      display: flex; gap: 6px; flex: 1; min-width: 0; overflow-x: auto; scroll-snap-type: x proximity;
      padding: 3px; scrollbar-width: none;
    }
    .dcs__track::-webkit-scrollbar { display: none; }
    .dcs__c {
      flex: 0 0 auto; min-width: 64px; min-height: 72px; padding: 6px 4px; scroll-snap-align: start;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
      border-radius: 12px; background: var(--fill); color: var(--ink); text-align: center; line-height: 1.2;
      border: 1px solid transparent;
    }
    .dcs__d { font-size: 12px; font-weight: 600; color: var(--ink-2); white-space: nowrap; }
    .dcs__m { font-size: 13px; font-weight: 650; }
    .dcs__l { font-size: 12px; color: var(--ink-2); min-height: 1.2em; }
    .dcs__c .dm { color: var(--blue); }
    .dcs__c.is-zero { border: 1px dashed var(--ink-3); background: transparent; }
    .dcs__c.is-dim .dcs__d, .dcs__c.is-dim .dcs__m, .dcs__c.is-dim .dcs__l { color: var(--ink-3); }
    .dcs__c.is-sel { box-shadow: inset 0 0 0 2px var(--red); }
    .dcs__c:focus-visible { outline-offset: 2px; }
    .dcs__nav {
      position: relative; flex: 0 0 auto; display: inline-grid; place-items: center; width: 32px; height: 44px;
      min-height: 44px; border-radius: 10px; color: var(--ink-2);
    }
    .dcs__nav::after { content: ''; position: absolute; inset: 0 -6px; }
    .dcs__nav:hover { color: var(--ink); }
  `],
})
export class DayCountStripComponent {
  protected readonly t = t;

  readonly days = input.required<readonly DayCount[]>();
  readonly selected = input<string | null>(null);
  readonly variant = input<'out' | 'home'>('out');
  /** The listbox's accessible name ('Flights out on Friday, November 20'). */
  readonly label = input<string>('');

  /** A day key; not emitted while loading. */
  readonly pick = output<string>();
  /** −1: seven more days before; 1: seven more after. */
  readonly extend = output<-1 | 1>();

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('cell');
  private readonly focused = signal<string | null>(null);

  readonly cells = computed<StripCell[]>(() => {
    const home = this.variant() === 'home';
    return this.days().map(c => cellOf(c, home));
  });

  /** The roving tab stop: the focused day, else the selected one, else the first. */
  readonly focusKey = computed(() => {
    const keys = this.cells().map(c => c.key);
    const f = this.focused();
    if (f && keys.includes(f)) return f;
    const s = this.selected();
    return s && keys.includes(s) ? s : keys[0] ?? null;
  });

  protected onPick(key: string): void {
    this.focused.set(key);
    const c = this.days().find(d => d.key === key);
    if (!c || c.state === 'loading') return;
    tap();
    this.pick.emit(key);
  }

  protected onKey(e: KeyboardEvent, i: number): void {
    const n = this.cells().length;
    let j: number;
    switch (e.key) {
      case 'ArrowLeft': j = Math.max(0, i - 1); break;
      case 'ArrowRight': j = Math.min(n - 1, i + 1); break;
      case 'Home': j = 0; break;
      case 'End': j = n - 1; break;
      default: return;
    }
    e.preventDefault();
    this.focused.set(this.cells()[j].key);
    this.buttons()[j]?.nativeElement.focus();
  }
}

/** The text and marks of one cell. Exported for specs. */
export function cellOf(c: DayCount, home: boolean): StripCell {
  const ok = c.state === 'ok';
  const base = {
    key: c.key, day: dayNum(c.key), ok, aria: dayCountAria(c, home ? 'home' : 'out'),
    zero: c.state === 'none', hatch: c.state === 'unpublished',
    dim: c.state === 'past' || c.state === 'before-dep' || c.state === 'unpublished',
  };
  const nights = c.nights !== undefined ? t('planner.nights', { n: c.nights }) : '';
  switch (c.state) {
    case 'loading':
      return { ...base, mid: '·', low: '', marker: null };
    case 'past':
    case 'before-dep':
      return { ...base, mid: '–', low: '', marker: null };
    case 'unpublished':
      return { ...base, mid: t('planner.chips.unpublished'), low: '', marker: null };
    case 'none':
      return home
        ? { ...base, mid: nights || '–', low: t('planner.count.home', { n: 0 }), marker: 'none' }
        : { ...base, mid: t('planner.flights', { n: 0 }), low: '–', marker: 'none' };
    default: {
      const marker = c.direct ? 'solid' : 'dotted';
      return home
        ? { ...base, mid: nights, low: t('planner.count.home', { n: c.total }), marker }
        : { ...base, mid: t('planner.flights', { n: c.total }), low: c.first ?? '', marker };
    }
  }
}
