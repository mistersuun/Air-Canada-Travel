import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { FilterChipsComponent } from './filters/filter-chips.component';
import { FilterSheetComponent } from './filters/filter-sheet.component';
import { HomePage } from './home.page';
import { CITIES_FETCH } from '../../places/city-index.service';
import { FIXTURE_CITIES_FILE } from '../../places/testing/cities-fixture';
import { SEVILLE_META, SEVILLE_ROUTES } from '../../trips/testing/seville-fixture';

let citiesFetches = 0;

/** Wed Oct 7 2026, 08:00 in Montréal (and Oct 7 in every device zone from UTC−11 to UTC+11). */
const CLOCK = Date.parse('2026-10-07T12:00:00Z');

function photo() {
  return { author: 'A', source: 'unsplash', sourceUrl: 'https://u/x', license: 'Unsplash License' };
}

function configure(prefs?: object) {
  const storage = new MemoryStorage();
  if (prefs) storage.setItem('ac.prefs.v1', JSON.stringify(prefs));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK },
      { provide: CITIES_FETCH, useValue: async () => { citiesFetches++; return FIXTURE_CITIES_FILE; } },
    ],
  });
  TestBed.inject(PhotoService).setManifest({ version: 1, photos: { LHR: photo(), ATH: photo() } });
}

async function render() {
  const fixture = TestBed.createComponent(HomePage);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const state = TestBed.inject(AppStateService);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, state, stable, cmp: fixture.componentInstance, text: () => el.textContent!.replace(/\s+/g, ' ') };
}

function names(root: Element): string[] {
  return [...root.querySelectorAll('app-dest-row .nm')].map(n => n.childNodes[0].textContent!.trim());
}

describe('HomePage', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('curated mode: greeting, title, picks, nonstop rows and dots for the week strip', async () => {
    configure();
    const { el, text } = await render();
    expect(text()).toContain('Good morning');
    expect(el.querySelector('h1')!.textContent).toBe('Flying from');
    expect(el.querySelector('app-hub-picker')).toBeTruthy();
    const input = el.querySelector<HTMLInputElement>('input[data-search-input]')!;
    expect(input.placeholder).toMatch(/^Search \d+ destinations, countries or flight numbers$/);
    // Picks: both photo destinations depart today (Wed): LHR (daily) first.
    const picks = [...el.querySelectorAll('app-photo-card .t')].map(t => t.textContent);
    expect(picks).toEqual(['London', 'Athens']);
    expect(el.querySelector('app-photo-card .bdg')!.textContent).toBe('Tonight 22:10');
    const nonstop = el.querySelector('section[aria-labelledby="h-nonstop"]')!;
    expect(nonstop.querySelector('h2')!.textContent).toBe('Nonstop this week');
    expect(names(nonstop)).toEqual(['London', 'Athens']);
    expect(nonstop.querySelector('app-dest-row .tm')!.textContent).toBe('22:10 → 10:00⁺¹ · 6h50 · AC864');
    // Today (Wed, index 2) is ringed.
    expect(nonstop.querySelectorAll('app-dot-row')[0].querySelectorAll('i')[2].classList).toContain('sel');
    expect(el.querySelector('app-results-list')).toBeNull();
  });

  it('Seasonal & ending soon lists Athens ending Oct 30', async () => {
    configure();
    const { el } = await render();
    const season = el.querySelector('section[aria-labelledby="h-season"]')!;
    expect(names(season)).toEqual(['Athens']);
    expect(season.querySelector('.ui-tag')!.textContent).toBe('Ends Oct 30');
    expect(season.querySelector('.ui-tag')!.classList).toContain('ui-tag--amber');
  });

  it('Connections only shows hub connections, and hides when connections are off', async () => {
    configure({ showConnections: true });
    const { el, state, stable } = await render();
    const conn = el.querySelector('section[aria-labelledby="h-conn"]');
    expect(conn).toBeTruthy();
    state.setShowConnections(false);
    await stable();
    expect(el.querySelector('section[aria-labelledby="h-conn"]')).toBeNull();
  });

  it('the Nonstop / + Connections seg writes showConnections', async () => {
    configure({ showConnections: false });
    const { el, state, stable } = await render();
    const btns = el.querySelectorAll<HTMLButtonElement>('app-seg.conn button');
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    btns[1].click();
    await stable();
    expect(state.showConnections()).toBe(true);
  });

  it('typing searches (spaces kept in the field), shows results, and Clear empties it', async () => {
    configure();
    const { el, state, stable } = await render();
    const input = el.querySelector<HTMLInputElement>('input[data-search-input]')!;
    input.value = 'lond ';
    input.dispatchEvent(new Event('input'));
    await stable();
    expect(state.query()).toBe('lond');
    expect(input.value).toBe('lond ');
    expect(el.querySelector('app-results-list')).toBeTruthy();
    expect(names(el.querySelector('app-results-list')!)).toEqual(['London']);
    expect(el.querySelector('.rhead h2')!.textContent).toContain('Results');
    el.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
    await stable();
    expect(state.query()).toBe('');
    expect(el.querySelector('app-results-list')).toBeNull();
  });

  it('an outside query change (Esc in the shell) rewrites the field', async () => {
    configure();
    const { el, state, stable } = await render();
    state.setQuery('athens');
    await stable();
    expect(el.querySelector<HTMLInputElement>('input[data-search-input]')!.value).toBe('athens');
  });

  it('searching a flight number finds the route that flies it', async () => {
    configure();
    const { el, state, stable } = await render();
    state.setQuery('AC898');
    await stable();
    expect(names(el.querySelector('app-results-list')!)).toEqual(['Athens']);
  });

  it('a region chip filters the list and switches to results mode', async () => {
    configure();
    const { el, state, stable } = await render();
    state.setRegion('Europe');
    await stable();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.rchip')];
    const europe = chips.find(c => c.textContent!.trim() === 'Europe')!;
    expect(europe.getAttribute('aria-pressed')).toBe('true');
    chips.find(c => c.textContent!.includes('Asia'))!.click();
    await stable();
    expect(state.region()).toBe('Asia & Pacific');
    chips.find(c => c.textContent!.trim() === 'All regions')!.click();
    await stable();
    expect(state.region()).toBe('All');
  });

  it('a non-default sort or a filter switches to results; the filter button shows a badge', async () => {
    configure();
    const { el, state, stable } = await render();
    expect(el.querySelector('.search .badge')).toBeNull();
    state.setFilters({ widebodyOnly: true });
    state.setSort('duration');
    await stable();
    expect(el.querySelector('app-results-list')).toBeTruthy();
    expect(el.querySelector('.search .badge')!.textContent).toBe('2');
    const chips = el.querySelector('app-filter-chips')!;
    expect([...chips.querySelectorAll('.chip')].map(c => c.textContent!.trim())).toEqual(['Widebody', 'Sort: Duration']);
    chips.querySelector<HTMLButtonElement>('.clear')!.click();
    await stable();
    expect(state.filters().widebodyOnly).toBe(false);
    expect(state.sort()).toBe('az');
  });

  it('the filter button opens the filter sheet', async () => {
    configure();
    const { el, stable, fixture } = await render();
    el.querySelector<HTMLButtonElement>('.search .f')!.click();
    await stable();
    expect(el.querySelector('app-filter-sheet dialog')!.hasAttribute('open')).toBe(true);
    expect(fixture.debugElement.query(d => d.name === 'app-filter-sheet').componentInstance).toBeInstanceOf(FilterSheetComponent);
  });

  it('a week beyond the published window shows the coverage state and jumps back', async () => {
    configure();
    const { el, state, stable, text } = await render();
    state.goToWeek('2027-04-12');
    await stable();
    expect(text()).toContain("Schedules for this week aren't published yet");
    expect(el.querySelector('section[aria-labelledby="h-nonstop"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('app-results-list .empty button')!.click();
    await stable();
    expect(state.weekStartKey()).toBe('2027-03-29');
  });

  it('the week strip shortcuts drive the selected day; a selected day retitles the list', async () => {
    configure();
    const { el, state, stable } = await render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    await stable();
    expect(state.selectedDateKey()).toBe('2026-10-08');
    expect(el.querySelector('section[aria-labelledby="h-nonstop"] h2')!.textContent).toBe('Nonstop · Thu, Oct 8');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    await stable();
    expect(state.selectedDateKey()).toBeNull();
  });

  it('the phone layout: "Where to?", short metas and four rows', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(q => ({
      matches: q.includes('max-width'), media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList);
    configure();
    const { el } = await render();
    expect(el.querySelector('h1')!.textContent).toBe('Where to?');
    expect(el.querySelector<HTMLInputElement>('input[data-search-input]')!.placeholder).toBe('Search destinations');
    const nonstop = el.querySelector('section[aria-labelledby="h-nonstop"]')!;
    expect(nonstop.querySelector('app-dest-row .tm')!.textContent).toBe('22:10 → 10:00⁺¹ · 6h50');
    // Only 2 nonstop routes in the fixture: under the 4-row phone limit, so no "Show all" button.
    expect(nonstop.querySelectorAll('app-dest-row').length).toBe(2);
    expect(nonstop.querySelector('.showall')).toBeNull();
    expect(el.querySelector('app-photo-card .bdg')!.textContent).toBe('Tonight');
  });
});

describe('FilterSheetComponent', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    configure();
  });
  afterEach(() => resetScheduleSource());

  async function sheet() {
    const fixture = TestBed.createComponent(FilterSheetComponent);
    fixture.componentRef.setInput('open', true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const state = TestBed.inject(AppStateService);
    const stable = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const button = (group: string, label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`${group} button`)].find(b => b.textContent!.includes(label))!;
    return { el, state, stable, button };
  }

  it('sort: departure needs a selected day', async () => {
    const { state, stable, button } = await sheet();
    expect(button('[data-filter="sort"]', 'Departure').disabled).toBe(true);
    button('[data-filter="sort"]', 'Duration').click();
    await stable();
    expect(state.sort()).toBe('duration');
    state.selectDay('2026-10-07');
    await stable();
    expect(button('[data-filter="sort"]', 'Departure').disabled).toBe(false);
  });

  it('every filter writes the state', async () => {
    const { el, state, stable, button } = await sheet();
    button('[aria-labelledby="fs-type"]', 'City').click();
    button('[aria-labelledby="fs-win"]', 'Evening').click();
    await stable();
    expect(state.filters().types).toEqual(['City']);
    expect(state.filters().departWindows).toEqual(['evening']);
    for (const id of ['fs-same', 'fs-wide', 'fs-star']) {
      const box = el.querySelector<HTMLInputElement>('#' + id)!;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    }
    await stable();
    expect(state.filters()).toMatchObject({ sameDayArrival: true, widebodyOnly: true, starredOnly: true });
    button('[aria-labelledby="fs-region"]', 'Europe').click();
    await stable();
    expect(state.region()).toBe('Europe');
    button('[aria-labelledby="fs-region"]', 'Europe').click();
    await stable();
    expect(state.region()).toBe('All');
    button('.field', 'YYZ').click();
    await stable();
    expect(state.filters().viaHubs).toEqual(['YYZ']);
    const conn = el.querySelector<HTMLInputElement>('#fs-conn')!;
    conn.checked = false;
    conn.dispatchEvent(new Event('change'));
    await stable();
    expect(state.showConnections()).toBe(false);
    expect(el.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
  });

  it('Reset clears filters, sort, region and connections; the footer counts the results', async () => {
    const { el, state, stable, button } = await sheet();
    state.setFilters({ widebodyOnly: true, types: ['City'] });
    state.setSort('days');
    state.setRegion('Europe');
    state.setShowConnections(false);
    await stable();
    expect(el.querySelector('.foot .ui-btn:last-child')!.textContent).toMatch(/Show \d+ destinations?/);
    button('.foot', 'Reset').click();
    await stable();
    expect(state.filters().types).toEqual([]);
    expect(state.filters().widebodyOnly).toBe(false);
    expect(state.sort()).toBe('az');
    expect(state.region()).toBe('All');
    expect(state.showConnections()).toBe(true);
  });
});

describe('FilterChipsComponent', () => {
  beforeEach(() => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    configure();
  });
  afterEach(() => resetScheduleSource());

  it('one removable chip per active filter, and Clear', async () => {
    const fixture = TestBed.createComponent(FilterChipsComponent);
    const state = TestBed.inject(AppStateService);
    state.setQuery('par');
    state.setRegion('Europe');
    state.setFilters({ types: ['City'], departWindows: ['morning'], viaHubs: ['YYZ'], sameDayArrival: true, starredOnly: true });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const labels = () => [...el.querySelectorAll('.chip')].map(c => c.textContent!.trim());
    expect(labels()).toEqual(['“par”', 'Europe', 'City', 'Morning', 'Via Toronto', 'Same-day arrival', 'Starred only']);
    el.querySelectorAll<HTMLButtonElement>('.chip')[3].click();
    await fixture.whenStable();
    expect(state.filters().departWindows).toEqual([]);
    fixture.componentRef.setInput('showRegion', false);
    await fixture.whenStable();
    expect(labels()).not.toContain('Europe');
    let cleared = 0;
    fixture.componentInstance.cleared.subscribe(() => cleared++);
    el.querySelector<HTMLButtonElement>('.clear')!.click();
    await fixture.whenStable();
    expect(state.query()).toBe('');
    expect(state.region()).toBe('All');
    expect(state.filters().types).toEqual([]);
    expect(cleared).toBe(1);
    expect(el.querySelector('.chip')).toBeNull();
  });
});

describe('HomePage · Places (cities AC does not fly to)', () => {
  beforeEach(() => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    citiesFetches = 0;
  });
  afterEach(() => resetScheduleSource());

  const settle = async (stable: () => Promise<void>) => {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 0));
      await stable();
    }
  };

  it('"Seville" shows a Places row linking to /reach, in place of the empty state', async () => {
    configure();
    const { el, state, stable } = await render();
    state.setQuery('Se');
    await settle(stable);
    expect(citiesFetches).toBe(0);
    state.setQuery('Seville');
    await settle(stable);
    expect(citiesFetches).toBe(1);
    const rows = [...el.querySelectorAll('.prow')];
    expect(rows[0].querySelector('.pnm')!.textContent).toBe('Seville');
    expect(rows[0].querySelector('.psub')!.textContent).toBe("Spain · Not in our schedule data");
    expect(rows[0].getAttribute('href')).toMatch(/^\/reach\/gn-2510911\?.*dep=2026-10-14/);
    expect(el.querySelector('#rl-places')!.textContent).toBe('Places');
    expect(el.textContent).not.toContain('No destinations match');
  });

  it('"Lisbon" shows the AC result and no Places row', async () => {
    configure();
    const { el, state, stable } = await render();
    state.setQuery('Lisbon');
    await settle(stable);
    expect(el.querySelector('.prow')).toBeNull();
    expect(names(el.querySelector('app-results-list')!)).toEqual(['Lisbon']);
  });

  it('a query with no city match leaves the results unchanged', async () => {
    configure();
    const { el, state, stable } = await render();
    state.setQuery('zzzzqq');
    await settle(stable);
    expect(el.querySelector('#rl-places')).toBeNull();
    expect(el.textContent).toContain('No destinations match');
  });
});
