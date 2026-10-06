import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { currencyCode } from '../pages/destination/currency';
import {
  advisoryQuiet, advisoryUpdated, fxLine, holidayKey, holidayName, holidayNote, shortDate, upcomingHolidays,
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
        @if (a.regional) { <span> · regional advisories in effect</span> }
        <span> · </span><a [href]="a.url" target="_blank" rel="noopener">travel.gc.ca</a>
      </p>
    }
    @if (fx(); as f) {
      <p class="r tn" data-fx>{{ f.text }} · {{ f.source }}</p>
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
  `],
})
export class DestReferenceComponent {
  private readonly ref = inject(ReferenceService);

  readonly iso2 = input<string | null | undefined>(null);
  /** Today at the destination (yyyy-mm-dd). */
  readonly todayKey = input.required<string>();

  constructor() {
    void this.ref.ensureLoaded();
  }

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
