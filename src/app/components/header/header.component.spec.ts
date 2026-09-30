import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HeaderComponent, SEARCH_DEBOUNCE_MS } from './header.component';
import { FilterPopoverComponent } from './filter-popover.component';
import { EMPTY_FILTERS, Filters, SortKey } from '../../utils/routes';
import type { ThemePref } from '../../state/prefs.service';
import type { StarredItem } from '../../state/app-state.service';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, rec, route } from '../../data/testing/schedule-fixtures';

@Component({
  standalone: true,
  imports: [HeaderComponent],
  template: `
    <app-header
      [hubCode]="hub()" [query]="query()" [sort]="sort()" [filters]="filters()" [region]="region()"
      [showConnections]="conn()" [selectedDateKey]="sel()" [theme]="theme()" [favourites]="favs()"
      [starredThisWeek]="starred()" [activeFilterCount]="0" [routeCount]="42"
      (hubCodeChange)="ev('hub', $event)" (queryChange)="ev('query', $event)" (sortChange)="ev('sort', $event)"
      (filtersChange)="ev('filters', $event)" (regionChange)="ev('region', $event)"
      (showConnectionsChange)="ev('conn', $event)" (themeChange)="ev('theme', $event)"
      (openSettings)="ev('settings')" (openDestination)="ev('open', $event)" (clearFilters)="ev('clear')" />
  `,
})
class HostComponent {
  hub = signal('YUL');
  query = signal('');
  sort = signal<SortKey>('az');
  filters = signal<Filters>(EMPTY_FILTERS);
  region = signal('All');
  conn = signal(true);
  sel = signal<string | null>(null);
  theme = signal<ThemePref>('auto');
  favs = signal<string[]>([]);
  starred = signal<StarredItem[]>([]);
  events: unknown[][] = [];
  ev(name: string, v?: unknown) { this.events.push(v === undefined ? [name] : [name, v]); }
}

async function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const host = fixture.componentInstance;
  const el: HTMLElement = fixture.nativeElement;
  const btn = (text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
  const aria = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
  return { fixture, host, el, btn, aria };
}

function key(k: string, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe('HeaderComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetScheduleSource();
  });

  it('shows the hub as a code plus accented city and emits hub codes', async () => {
    const { el, host } = await setup();
    expect(el.querySelector('.hd__code')!.textContent).toBe('YUL');
    expect(el.querySelector('.hd__city')!.textContent).toBe('Montréal');
    const select = el.querySelector<HTMLSelectElement>('#hub-select')!;
    expect(select.value).toBe('YUL');
    select.value = 'YVR';
    select.dispatchEvent(new Event('change'));
    expect(host.events).toEqual([['hub', 'YVR']]);
  });

  it('debounces search, and Esc or the clear button clear immediately', async () => {
    const { el, host, fixture } = await setup();
    vi.useFakeTimers();
    const input = el.querySelector<HTMLInputElement>('#dest-search')!;
    input.value = 'lis';
    input.dispatchEvent(new Event('input'));
    input.value = 'lisb';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(host.events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.events).toEqual([['query', 'lisb']]);

    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.hd__clear')!.click();
    expect(host.events.at(-1)).toEqual(['query', '']);

    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(500);
    expect(host.events.at(-1)).toEqual(['query', '']);
    expect(host.events.filter(e => e[1] === 'x')).toEqual([]);
  });

  it('keeps a trailing space when the parent stores the trimmed query', async () => {
    const { el, host, fixture } = await setup();
    vi.useFakeTimers();
    const input = el.querySelector<HTMLInputElement>('#dest-search')!;
    input.value = 'new ';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(host.events).toEqual([['query', 'new ']]);
    host.query.set('new'); // AppStateService trims
    fixture.detectChanges();
    expect(input.value).toBe('new ');
  });

  it('drops a pending typed value when the parent changes the query first', async () => {
    const { el, host, fixture } = await setup();
    vi.useFakeTimers();
    const input = el.querySelector<HTMLInputElement>('#dest-search')!;
    input.value = 'lis';
    input.dispatchEvent(new Event('input'));
    host.query.set('paris'); // e.g. Back restores an older URL
    fixture.detectChanges();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(host.events).toEqual([]);
    expect(input.value).toBe('paris');
  });

  it('follows the query input when the parent changes it', async () => {
    const { el, host, fixture } = await setup();
    host.query.set('portugal');
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#dest-search')!.value).toBe('portugal');
  });

  it("'/' focuses search and '?' opens the shortcuts sheet; both ignored in fields", async () => {
    const { el, fixture } = await setup();
    const input = el.querySelector<HTMLInputElement>('#dest-search')!;
    expect(key('/').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(key('?', input).defaultPrevented).toBe(false);
    input.blur();
    key('?');
    await fixture.whenStable();
    const dlg = el.querySelector('app-shortcuts-sheet dialog') as HTMLDialogElement;
    expect(dlg.open).toBe(true);
    expect(dlg.textContent).toContain('Previous / next week');
    dlg.close();
    await fixture.whenStable();
    expect(el.querySelector('app-shortcuts-sheet')).toBeNull();
  });

  it('cycles the theme auto → light → dark → auto with a matching icon', async () => {
    const { host, fixture, aria } = await setup();
    expect(aria('Theme: Auto').getAttribute('aria-label')).toBe('Theme: Auto. Switch to Light');
    aria('Theme:').click();
    host.theme.set('light');
    await fixture.whenStable();
    aria('Theme:').click();
    host.theme.set('dark');
    await fixture.whenStable();
    aria('Theme:').click();
    expect(host.events).toEqual([['theme', 'light'], ['theme', 'dark'], ['theme', 'auto']]);
    expect(aria('Theme:').getAttribute('aria-label')).toBe('Theme: Dark. Switch to Auto');
  });

  it('folds into compact mode past a scroll threshold, with hysteresis', async () => {
    const { el, fixture } = await setup();
    const hostEl = el.querySelector('app-header')!;
    const scrollTo = (y: number) => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    };
    scrollTo(100);
    await fixture.whenStable();
    expect(hostEl.classList).not.toContain('is-compact');
    scrollTo(400);
    await fixture.whenStable();
    expect(hostEl.classList).toContain('is-compact');
    scrollTo(60);
    await fixture.whenStable();
    expect(hostEl.classList).toContain('is-compact');
    scrollTo(0);
    await fixture.whenStable();
    expect(hostEl.classList).not.toContain('is-compact');
  });

  it('the gear opens settings', async () => {
    const { host, aria } = await setup();
    aria('Settings').click();
    expect(host.events).toEqual([['settings']]);
  });

  describe('filter row', () => {
    it('segmented control switches Direct only / Include connections', async () => {
      const { host, aria } = await setup();
      aria('Include connections').click(); // already on: no event
      aria('Direct only').click();
      expect(host.events).toEqual([['conn', false]]);
      expect(aria('Include connections').getAttribute('aria-pressed')).toBe('true');
    });

    it('region chips emit the region (tapping the active one returns to All), types toggle', async () => {
      const { host, btn, fixture } = await setup();
      btn('Europe').click();
      host.region.set('Europe');
      await fixture.whenStable();
      expect(btn('Europe').getAttribute('aria-pressed')).toBe('true');
      btn('Europe').click();
      btn('Starred').click();
      btn('Sun').click();
      expect(host.events).toEqual([
        ['region', 'Europe'], ['region', 'All'], ['region', 'Starred'],
        ['filters', { ...EMPTY_FILTERS, types: ['Sun'] }],
      ]);
    });

    it('active chips can be removed one by one and cleared all at once', async () => {
      const { el, host, fixture, aria, btn } = await setup();
      host.filters.set({ ...EMPTY_FILTERS, departWindows: ['morning', 'redeye'], viaHubs: ['YYZ'], widebodyOnly: true, types: ['City'] });
      host.region.set('Europe');
      host.query.set('lis');
      host.sort.set('duration');
      await fixture.whenStable();
      const labels = [...el.querySelectorAll('.fb__chip')].map(c => c.textContent!.trim());
      expect(labels).toEqual(['“lis”', 'Europe', 'City', 'Morning', 'Red-eye', 'Via Toronto', 'Widebody', 'Sort: Duration']);
      expect(el.querySelector('.fb__badge')!.textContent).toBe('5');

      aria('Remove Morning').click();
      aria('Remove Via Toronto').click();
      aria('Remove “lis”').click();
      aria('Remove Sort: Duration').click();
      aria('Remove Europe').click();
      btn('Clear all').click();
      expect(host.events).toEqual([
        ['filters', { ...host.filters(), departWindows: ['redeye'] }],
        ['filters', { ...host.filters(), viaHubs: [] }],
        ['query', ''],
        ['sort', 'az'],
        ['region', 'All'],
        ['clear'],
      ]);
    });

    it('opens the filter sheet; its controls emit live and it closes cleanly', async () => {
      setScheduleSource(
        [route('YUL', 'LHR', rec('AC1', '10:00', '22:00', '2026-09-01', '2027-03-31', undefined, '77W')),
          route('YUL', 'YYZ', rec('AC2', '10:00', '11:00', '2026-09-01', '2027-03-31', undefined, '320'))],
        FIXTURE_META,
      );
      const { el, host, fixture, aria, btn } = await setup();
      aria('Filter and sort').click();
      await fixture.whenStable();
      const dlg = el.querySelector('app-filter-popover dialog') as HTMLDialogElement;
      expect(dlg.open).toBe(true);
      // Widebody hint is derived from the aircraft in the data (critique 36).
      expect(dlg.textContent).toContain('777-300ER');
      expect(dlg.textContent).not.toContain('A320');
      // Via hubs exclude the home hub.
      expect(dlg.querySelector('button[aria-label^="Montreal"]')).toBeNull();
      // Departure sort needs a selected day.
      const dep = dlg.querySelector<HTMLOptionElement>('option[value="departure"]')!;
      expect(dep.disabled).toBe(true);

      btn('Morning05–12').click();
      dlg.querySelector<HTMLButtonElement>('button[aria-label="Toronto (YYZ)"]')!.click();
      dlg.querySelector<HTMLInputElement>('#fp-wide')!.click();
      const sort = dlg.querySelector<HTMLSelectElement>('#fp-sort')!;
      sort.value = 'days';
      sort.dispatchEvent(new Event('change'));
      expect(host.events).toEqual([
        ['filters', { ...EMPTY_FILTERS, departWindows: ['morning'] }],
        ['filters', { ...EMPTY_FILTERS, viaHubs: ['YYZ'] }],
        ['filters', { ...EMPTY_FILTERS, widebodyOnly: true }],
        ['sort', 'days'],
      ]);

      host.sel.set('2026-10-01');
      await fixture.whenStable();
      expect(dep.disabled).toBe(false);

      btn('Show 42 routes').click();
      await fixture.whenStable();
      expect(el.querySelector('app-filter-popover')).toBeNull();
    });

    it('the filter sheet reset clears its own filters and the sort', async () => {
      TestBed.configureTestingModule({ imports: [FilterPopoverComponent] });
      const fixture = TestBed.createComponent(FilterPopoverComponent);
      fixture.componentRef.setInput('filters', { ...EMPTY_FILTERS, types: ['Sun'], departWindows: ['evening'], sameDayArrival: true });
      fixture.componentRef.setInput('sort', 'newest');
      fixture.componentRef.setInput('showConnections', false);
      const out: unknown[] = [];
      fixture.componentInstance.filtersChange.subscribe(f => out.push(f));
      fixture.componentInstance.sortChange.subscribe(s => out.push(s));
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('fieldset[disabled]')!.textContent).toContain('Include connections');
      el.querySelector<HTMLInputElement>('#fp-sameday')!.click();
      fixture.componentInstance.reset();
      expect(out).toEqual([
        { ...EMPTY_FILTERS, types: ['Sun'], departWindows: ['evening'], sameDayArrival: false },
        { ...EMPTY_FILTERS, types: ['Sun'] },
        'az',
      ]);
    });
  });

  it('shows starred places this week and opens one on tap', async () => {
    const { el, host, fixture } = await setup();
    expect(el.querySelector('app-starred-strip')).toBeNull();
    host.favs.set(['LIS', 'NRT']);
    host.starred.set([
      { code: 'LIS', city: 'Lisbon', country: 'Portugal', dayKeys: [], days: 'Tue Thu Sat', direct: true },
      { code: 'NRT', city: 'Tokyo', country: 'Japan', dayKeys: [], days: '', direct: false },
    ]);
    await fixture.whenStable();
    const items = [...el.querySelectorAll<HTMLButtonElement>('.st__item')];
    expect(items.map(i => i.getAttribute('aria-label'))).toEqual([
      'Lisbon, direct Tue Thu Sat', 'Tokyo, no flights this week',
    ]);
    items[0].click();
    expect(host.events).toEqual([['open', 'LIS']]);
  });
});
