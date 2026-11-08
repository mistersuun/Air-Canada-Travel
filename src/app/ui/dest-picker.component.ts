import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { t } from '../i18n/t';
import { DESTINATIONS } from '../data/destinations';
import { AppStateService } from '../state/app-state.service';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Destinations matching a query on city, code or country (accents and case ignored), minus `exclude`; starred first, then A to Z. Pure. */
export function matchDestinations(query: string, exclude: readonly string[], starred: ReadonlySet<string>, limit = 8) {
  const q = fold(query.trim());
  const seen = new Set<string>(exclude.map(c => c.toUpperCase()));
  const out: { code: string; city: string; country: string }[] = [];
  const list = [...DESTINATIONS].sort((a, b) =>
    Number(starred.has(b.code)) - Number(starred.has(a.code)) || a.city.localeCompare(b.city));
  for (const d of list) {
    if (seen.has(d.code)) continue;
    if (q && !fold(d.city).includes(q) && !fold(d.country).includes(q) && !d.code.toLowerCase().startsWith(q)) continue;
    seen.add(d.code);
    out.push({ code: d.code, city: d.city, country: d.country });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A small inline picker: search the destinations and tap one. Emits the code;
 * the host decides what to do with it (open a comparison, add a column).
 */
@Component({
  selector: 'app-dest-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pk ui-card" role="group" [attr.aria-label]="heading()">
      <div class="pk__h">
        <b>{{ heading() }}</b>
        <button type="button" class="pk__x" (click)="closed.emit()">{{ t('compare.close') }}</button>
      </div>
      <input type="search" class="pk__in" data-pick-search [attr.aria-label]="t('compare.searchAria')" [placeholder]="t('compare.search')"
             autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)">
      <ul class="pk__l">
        @for (m of matches(); track m.code) {
          <li><button type="button" class="pk__b" [attr.data-pick]="m.code" (click)="picked.emit(m.code)">
            <span>{{ m.city }}</span><span class="pk__s">{{ m.country }} · {{ m.code }}</span></button></li>
        } @empty {
          <li class="pk__n">{{ t('compare.noMatch') }}</li>
        }
      </ul>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pk { padding: 12px 14px; display: grid; gap: 8px; }
    .pk__h { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; }
    .pk__x { min-height: 44px; padding: 0 4px; color: var(--blue); font-weight: 600; }
    .pk__in {
      min-height: 44px; width: 100%; box-sizing: border-box; padding: 0 12px; border-radius: 12px; font: inherit; font-size: 16px;
      color: var(--ink); background: var(--bg); border: 1px solid var(--hair);
    }
    .pk__l { list-style: none; margin: 0; padding: 0; display: grid; }
    .pk__b {
      width: 100%; min-height: 44px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
      padding: 6px 4px; text-align: left; color: var(--ink); border-top: 1px solid var(--hair); font-weight: 600;
    }
    .pk__s { font-size: 12.5px; font-weight: 400; color: var(--ink-3); text-align: right; }
    .pk__n { padding: 10px 4px; font-size: 13.5px; color: var(--ink-2); }
  `],
})
export class DestPickerComponent {
  protected readonly t = t;
  private readonly state = inject(AppStateService);

  /** Codes not offered (already compared). */
  readonly exclude = input<readonly string[]>([]);
  readonly heading = input<string>(t('compare.search'));
  readonly picked = output<string>();
  readonly closed = output<void>();

  protected readonly query = signal('');
  protected readonly matches = computed(() => matchDestinations(this.query(), this.exclude(), this.state.favouriteSet()));
}
