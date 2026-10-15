import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { t } from '../i18n/t';
import { currencyCode } from '../pages/destination/currency';
import { AirportInfoService, airportInfo, cityOptionLabel, loungeLabel, terminalLabel } from '../places/airport-info';
import {
  advisoryQuiet, advisoryUpdated, convertAmount, fxLine, fxRate, holidayKey, holidayName, holidayNote, shortDate, upcomingHolidays,
} from './reference';
import { ReferenceService } from './reference.service';

/**
 * Destination Essentials: the Government of Canada advice level (official
 * wording, date, link), the ECB exchange rate with its date, and the next
 * public holidays within 60 days. Each line renders only when its file loaded
 * and has the country; with none of them the component is empty.
 */
@Component({
  selector: 'app-dest-reference',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (advisory(); as a) {
      <p class="r r--adv tn" [class.is-quiet]="quiet()" data-advisory>
        <span>{{ a.text }}</span>
        @if (updated()) { <span> · {{ updated() }}</span> }
        @if (a.regional) { <span> · {{ t('dest.ref.regional') }}</span> }
        <span> · </span><a [href]="a.url" target="_blank" rel="noopener">{{ advisoryHost }}</a>
      </p>
    }
    @if (fx(); as f) {
      <p class="r tn" data-fx>
        <button type="button" class="fxb" data-fx-toggle [attr.aria-expanded]="convOpen()" aria-controls="fx-conv" (click)="convOpen.set(!convOpen())">
          {{ f.text }} · {{ f.source }}<span class="fxb__h"> · {{ convOpen() ? t('dest.ref.hideConv') : t('dest.ref.convert') }}</span>
        </button>
      </p>
      @if (convOpen()) {
        <div class="conv" id="fx-conv" data-converter role="group" [attr.aria-label]="t('dest.ref.converterAria')">
          <label class="conv__f"><span>{{ cadCode }}</span>
            <input type="text" inputmode="decimal" autocomplete="off" data-conv-cad [value]="cad()" (input)="onCad($any($event.target).value)"></label>
          <span class="conv__eq" aria-hidden="true">⇄</span>
          <label class="conv__f"><span>{{ code() }}</span>
            <input type="text" inputmode="decimal" autocomplete="off" data-conv-local [value]="local()" (input)="onLocal($any($event.target).value)"></label>
        </div>
      }
    }
    @if (airport(); as ap) {
      <div class="ap" data-airport>
        <p class="r ap__h"><b>{{ t('dest.ref.airport') }}</b> · {{ airportCode() }}</p>
        @if (terminal(); as tm) { <p class="r" data-terminal>{{ t('dest.ref.acTerminal', { terminal: tm }) }}</p> }
        @if (lounge(); as l) { <p class="r" data-lounge>{{ l }}</p> }
        @for (o of ap.toCity; track o.note) {
          <p class="r tn" data-to-city>{{ label(o) }}</p>
        }
        <p class="r r--src">{{ t('dest.ref.typicalTimes', { date: ap.reviewed, source: ap.source }) }}</p>
      </div>
    }
    @for (h of holidays(); track key(h)) {
      <p class="r tn" data-holiday><b>{{ short(h.date) }}</b> · {{ name(h) }} · {{ note(h) }}</p>
    }
  `,
  styles: [`
    :host { display: grid; gap: 4px; margin-top: 12px; }
    :host:empty { display: none; }
    .r { margin: 0; font-size: 13.5px; color: var(--ink-2); }
    .r b { color: var(--ink); font-weight: 650; }
    .r--adv { color: var(--ink); font-weight: 600; }
    .r--adv.is-quiet { color: var(--ink-3); font-weight: 400; font-size: 12.5px; }
    a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
    .fxb { font: inherit; color: inherit; text-align: left; padding: 0; min-height: 44px; display: inline-flex; align-items: center; cursor: pointer; }
    .fxb__h { color: var(--blue); text-decoration: underline; text-underline-offset: 2px; white-space: pre; }
    .conv { display: flex; align-items: flex-end; gap: 8px; margin: 0 0 6px; }
    .conv__f { display: grid; gap: 2px; flex: 1; min-width: 0; font-size: 12px; font-weight: 650; color: var(--ink-2); }
    .conv__f input {
      min-height: 44px; width: 100%; box-sizing: border-box; padding: 0 12px; border-radius: 12px; font: inherit; font-size: 16px;
      color: var(--ink); background: var(--surface); border: 1px solid var(--hair);
    }
    .conv__eq { flex: none; min-height: 44px; display: grid; place-items: center; color: var(--ink-3); }
    .ap { display: grid; gap: 4px; margin-top: 6px; }
    .ap__h b { color: var(--ink); font-weight: 650; }
    .r--src { font-size: 12px; color: var(--ink-3); }
  `],
})
export class DestReferenceComponent {
  protected readonly advisoryHost = 'travel.gc.ca';
  protected readonly cadCode = 'CAD';
  protected readonly t = t;
  private readonly ref = inject(ReferenceService);

  readonly iso2 = input<string | null | undefined>(null);
  /** Today at the destination (yyyy-mm-dd). */
  readonly todayKey = input.required<string>();
  /** The destination's airport code, for the Airport block. */
  readonly airportCode = input<string | null | undefined>(null);

  private readonly airports = inject(AirportInfoService);
  protected readonly airport = computed(() => airportInfo(this.airportCode()));
  protected readonly terminal = computed(() => { const a = this.airport(); return a ? terminalLabel(a) : ''; });
  protected readonly lounge = computed(() => { const a = this.airport(); return a ? loungeLabel(a) : ''; });
  protected readonly label = cityOptionLabel;

  protected readonly convOpen = signal(false);
  protected readonly code = computed(() => currencyCode(this.iso2()) ?? '');
  private readonly rate = computed(() => fxRate(currencyCode(this.iso2()), this.ref.fx()));
  /** What was typed and in which field; the other side is derived, so it follows the rate when it loads. */
  private readonly typed = signal<{ side: 'cad' | 'local'; text: string }>({ side: 'cad', text: '' });
  protected readonly cad = computed(() => this.side('cad'));
  protected readonly local = computed(() => this.side('local'));

  private side(which: 'cad' | 'local'): string {
    const typed = this.typed();
    if (typed.side === which) return typed.text;
    const r = this.rate();
    return r ? convertAmount(typed.text, r, which === 'local') : '';
  }

  constructor() {
    void this.ref.ensureLoaded();
    void this.airports.ensureLoaded();
    // A different destination (another currency) starts a fresh converter.
    effect(() => {
      this.iso2();
      untracked(() => { this.typed.set({ side: 'cad', text: '' }); this.convOpen.set(false); });
    });
  }

  protected onCad(v: string): void { this.typed.set({ side: 'cad', text: v }); }
  protected onLocal(v: string): void { this.typed.set({ side: 'local', text: v }); }

  protected readonly advisory = computed(() => this.ref.advisories()?.get((this.iso2() ?? '').toUpperCase()) ?? null);
  protected readonly quiet = computed(() => { const a = this.advisory(); return !!a && advisoryQuiet(a); });
  protected readonly updated = computed(() => { const a = this.advisory(); return a ? advisoryUpdated(a, this.todayKey()) : ''; });
  protected readonly fx = computed(() => fxLine(currencyCode(this.iso2()), this.ref.fx()));
  protected readonly holidays = computed(() => upcomingHolidays(this.ref.holidays(), this.iso2(), this.todayKey()));

  protected short(key: string): string { return shortDate(key, this.todayKey()); }
  protected readonly key = holidayKey;
  protected readonly name = holidayName;
  protected readonly note = holidayNote;
}
