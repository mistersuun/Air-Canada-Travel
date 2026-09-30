import {
  ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, computed, inject, input, linkedSignal,
  output, signal, viewChild,
} from '@angular/core';
import { HUBS } from '../../data/destinations';
import { EMPTY_FILTERS, Filters, SortKey } from '../../utils/routes';
import { DEFAULT_HUB, ThemePref } from '../../state/prefs.service';
import type { StarredItem } from '../../state/app-state.service';
import { IconComponent, IconName } from '../shared/icons.component';
import { FilterBarComponent } from './filter-bar.component';
import { StarredStripComponent } from './starred-strip.component';
import { ShortcutsSheetComponent } from './shortcuts-sheet.component';
import { shortcutAllowed } from './keyboard';

/** Debounce for search keystrokes before queryChange fires. */
export const SEARCH_DEBOUNCE_MS = 120;

const COMPACT_AT = 160;
const EXPAND_AT = 24;
const THEME_CYCLE: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };
const THEME_ICON: Record<ThemePref, IconName> = { auto: 'auto', light: 'sun', dark: 'moon' };
const THEME_LABEL: Record<ThemePref, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
/** Display names with their proper accents (HUBS names are ASCII for search). */
const HUB_DISPLAY: Record<string, string> = { YUL: 'Montréal', YQB: 'Québec City' };

/**
 * App header: brand, a big "From" hub cell (native <select> overlaid), search
 * (debounced; '/' focuses, Esc clears), theme cycle and settings buttons, the
 * filter row and the starred strip. Owns the '/' and '?' shortcuts.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [IconComponent, FilterBarComponent, StarredStripComponent, ShortcutsSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
    '(window:scroll)': 'onScroll()',
    '[class.is-compact]': 'compact()',
  },
  template: `
    <header class="hd">
      <div class="hd__bar">
        <a class="hd__brand" href="./" aria-label="Air Canada Trips, home">
          <img class="hd__logo" src="icon.svg" alt="" width="28" height="28">
          <span class="hd__name">Air Canada <span class="hd__dim">Trips</span></span>
        </a>

        <label class="hd__hub" for="hub-select">
          <span class="ui-label hd__from">From</span>
          <span class="hd__hub-val">
            <span class="hd__code">{{ hubCode() }}</span>
            <span class="hd__city">{{ hubCity() }}</span>
            <app-icon name="chevron-down" [size]="14" class="hd__chev" />
          </span>
          <select id="hub-select" class="hd__select" (change)="onHub($event)" aria-label="Home airport">
            @for (h of hubs; track h.code) {
              <option [value]="h.code" [selected]="h.code === hubCode()">{{ h.code }} · {{ displayName(h.code, h.name) }}</option>
            }
          </select>
        </label>

        <div class="hd__search" role="search">
          <app-icon name="search" [size]="18" class="hd__search-icon" />
          <input #search id="dest-search" type="search" class="hd__input" placeholder="City or code"
                 autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Search destinations"
                 [value]="draft()" (input)="onInput($event)" (keydown.escape)="onEscape($event)">
          @if (draft()) {
            <button type="button" class="hd__clear" (click)="clearSearch(true)" aria-label="Clear search">
              <app-icon name="close" [size]="16" />
            </button>
          } @else {
            <kbd class="hd__kbd" aria-hidden="true">/</kbd>
          }
          <span class="ui-visually-hidden" aria-live="polite">{{ draft() ? routeCount() + ' destinations match' : '' }}</span>
        </div>

        <div class="hd__actions">
          <button type="button" class="ui-icon-btn hd__kb" (click)="shortcutsOpen.set(true)" aria-label="Keyboard shortcuts"
                  aria-haspopup="dialog">
            <app-icon name="info" [size]="19" />
          </button>
          <button type="button" class="ui-icon-btn" (click)="cycleTheme()" [attr.aria-label]="themeAria()" [attr.title]="themeAria()">
            <app-icon [name]="themeIcon()" [size]="19" />
          </button>
          <button type="button" class="ui-icon-btn" (click)="openSettings.emit()" aria-label="Settings" aria-haspopup="dialog">
            <app-icon name="gear" [size]="19" />
          </button>
        </div>
      </div>

      <app-filter-bar
        [filters]="filters()" [region]="region()" [showConnections]="showConnections()" [query]="query()"
        [sort]="sort()" [selectedDateKey]="selectedDateKey()" [hubCode]="hubCode()" [routeCount]="routeCount()"
        (filtersChange)="filtersChange.emit($event)" (regionChange)="regionChange.emit($event)"
        (showConnectionsChange)="showConnectionsChange.emit($event)" (queryChange)="setQueryNow($event)"
        (sortChange)="sortChange.emit($event)" (clearFilters)="onClearAll()" />

      @if (favourites().length && starredThisWeek().length) {
        <app-starred-strip class="hd__starred" [items]="starredThisWeek()" (open)="openDestination.emit($event)" />
      }
    </header>

    @if (shortcutsOpen()) {
      <app-shortcuts-sheet (closed)="shortcutsOpen.set(false)" />
    }
  `,
  styles: [`
    :host { display: block; }
    .hd { max-width: 1280px; margin: 0 auto; padding-bottom: var(--space-2); }
    .hd__bar {
      display: grid; align-items: center; gap: var(--space-2) var(--space-2);
      grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'brand brand actions' 'hub search search';
      padding: var(--space-2) var(--gutter) var(--space-3);
    }
    .hd__brand { grid-area: brand; display: flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; border-radius: 8px; }
    .hd__logo { width: 28px; height: 28px; border-radius: 7px; }
    .hd__name { font-size: 16px; font-weight: 700; letter-spacing: -.02em; white-space: nowrap; }
    .hd__dim { font-weight: 400; color: var(--ink-3); }
    .hd__actions { grid-area: actions; display: flex; justify-content: flex-end; gap: 2px; margin-right: -8px; }

    .hd__hub {
      grid-area: hub; position: relative; display: grid; align-content: center; gap: 1px; height: 52px; padding: 0 12px;
      border-radius: 14px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-card);
      cursor: pointer; transition: border-color var(--dur-fast) var(--ease-out);
    }
    .hd__hub:hover { border-color: var(--line-strong); }
    .hd__hub:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
    .hd__from { font-size: 9.5px; line-height: 1; }
    .hd__hub-val { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
    .hd__code { font-family: var(--font-code); font-size: 20px; font-weight: 600; letter-spacing: .02em; line-height: 1.1; }
    .hd__city { font-size: 13px; font-weight: 500; color: var(--ink-2); }
    .hd__chev { color: var(--ink-3); align-self: center; }
    .hd__select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; }
    .hd__select:focus-visible { outline: none; }

    .hd__search {
      grid-area: search; position: relative; display: flex; align-items: center; height: 52px; min-width: 0;
      border-radius: 14px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-card);
      transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
    }
    .hd__search:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .hd__search-icon { position: absolute; left: 14px; color: var(--ink-3); pointer-events: none; }
    .hd__input {
      flex: 1; min-width: 0; height: 100%; padding: 0 8px 0 42px; border: 0; background: none; color: var(--ink);
      font-size: 16px; outline: none; -webkit-appearance: none; appearance: none;
    }
    .hd__input::placeholder { color: var(--ink-3); }
    .hd__input::-webkit-search-cancel-button { display: none; }
    .hd__input:focus-visible { outline: none; }
    .hd__clear { display: grid; place-items: center; width: 40px; height: 40px; margin-right: 6px; border: 0; border-radius: 10px; background: none; color: var(--ink-2); cursor: pointer; }
    .hd__clear:hover { background: var(--surface-2); color: var(--ink); }
    .hd__kbd {
      margin-right: 12px; min-width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px;
      border: 1px solid var(--line-strong); font-family: var(--font-code); font-size: 12px; color: var(--ink-3);
    }
    .hd__kb { display: none; }
    .hd__starred { margin-top: var(--space-2); }

    @media (hover: hover) and (pointer: fine) { .hd__kb { display: inline-grid; } }
    @media (hover: none), (max-width: 479px) { .hd__kbd { display: none; } }
    @media (max-width: 340px) { .hd__city { display: none; } }
    @media (max-width: 899px) {
      :host(.is-compact) .hd__bar { grid-template-areas: 'hub search search'; padding-top: var(--space-2); }
      :host(.is-compact) .hd__brand, :host(.is-compact) .hd__actions, :host(.is-compact) .hd__starred { display: none; }
    }
    @media (min-width: 900px) {
      .hd__bar { grid-template-columns: auto auto minmax(0, 1fr) auto; grid-template-areas: 'brand hub search actions'; column-gap: var(--space-3); }
      .hd__brand { margin-right: var(--space-3); }
      .hd__search { max-width: 560px; }
    }
  `],
})
export class HeaderComponent {
  private readonly doc = inject(DOCUMENT);

  // WS3 binding contract. Hub is a code, not a name.
  readonly hubCode = input<string>(DEFAULT_HUB);
  readonly query = input('');
  readonly sort = input<SortKey>('az');
  readonly filters = input<Filters>(EMPTY_FILTERS);
  readonly region = input('All');
  readonly showConnections = input(true);
  readonly selectedDateKey = input<string | null>(null);
  readonly theme = input<ThemePref>('auto');
  readonly favourites = input<readonly string[]>([]);
  readonly starredThisWeek = input<readonly StarredItem[]>([]);
  readonly activeFilterCount = input(0);
  readonly routeCount = input(0);

  readonly hubCodeChange = output<string>();
  readonly queryChange = output<string>();
  readonly sortChange = output<SortKey>();
  readonly filtersChange = output<Filters>();
  readonly regionChange = output<string>();
  readonly showConnectionsChange = output<boolean>();
  readonly themeChange = output<ThemePref>();
  readonly openSettings = output<void>();
  readonly openDestination = output<string>();
  readonly clearFilters = output<void>();

  protected readonly hubs = HUBS;
  protected readonly shortcutsOpen = signal(false);
  /** Mobile: brand row and starred strip fold away once the list is scrolled (hysteresis avoids flicker). */
  readonly compact = signal(false);
  /**
   * What the input shows; follows the query input whenever the parent changes
   * it, except when the new query is just the draft trimmed (the state layer
   * trims), so a trailing space the user just typed is not eaten.
   */
  readonly draft = linkedSignal<string, string>({
    source: this.query,
    computation: (q, prev) => (prev && prev.value.trim() === q ? prev.value : q),
  });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly searchEl = viewChild.required<ElementRef<HTMLInputElement>>('search');

  readonly hubCity = computed(() => {
    const code = this.hubCode();
    return this.displayName(code, HUBS.find(h => h.code === code)?.name ?? '');
  });
  readonly themeIcon = computed(() => THEME_ICON[this.theme()] ?? 'auto');
  readonly themeAria = computed(() => {
    const t = this.theme();
    return `Theme: ${THEME_LABEL[t]}. Switch to ${THEME_LABEL[THEME_CYCLE[t]]}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected displayName(code: string, name: string): string {
    return HUB_DISPLAY[code] ?? name;
  }

  protected onHub(e: Event): void {
    this.hubCodeChange.emit((e.target as HTMLSelectElement).value);
  }

  onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.draft.set(v);
    clearTimeout(this.timer);
    // If the parent changes the query meanwhile (Back, a chip, clear-all),
    // that change wins: drop this stale typed value.
    const base = this.query();
    this.timer = setTimeout(() => {
      if (this.query() === base) this.queryChange.emit(v);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Emit immediately (chip removal, clear button, Esc). */
  setQueryNow(v: string): void {
    clearTimeout(this.timer);
    this.draft.set(v);
    this.queryChange.emit(v);
  }

  clearSearch(refocus = false): void {
    this.setQueryNow('');
    if (refocus) this.searchEl().nativeElement.focus();
  }

  protected onEscape(e: Event): void {
    if (this.draft()) {
      e.preventDefault();
      this.clearSearch();
    } else {
      this.searchEl().nativeElement.blur();
    }
  }

  protected onClearAll(): void {
    clearTimeout(this.timer);
    this.draft.set('');
    this.clearFilters.emit();
  }

  onScroll(): void {
    const y = this.doc.defaultView?.scrollY ?? 0;
    if (!this.compact() && y > COMPACT_AT) this.compact.set(true);
    else if (this.compact() && y < EXPAND_AT) this.compact.set(false);
  }

  cycleTheme(): void {
    this.themeChange.emit(THEME_CYCLE[this.theme()] ?? 'auto');
  }

  onKey(e: KeyboardEvent): void {
    if (!shortcutAllowed(e, this.doc)) return;
    if (e.key === '/') {
      e.preventDefault();
      const el = this.searchEl().nativeElement;
      el.focus();
      el.select();
    } else if (e.key === '?') {
      e.preventDefault();
      this.shortcutsOpen.set(true);
    }
  }
}
