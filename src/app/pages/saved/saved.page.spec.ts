import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES, rec, route } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { SavedPage } from './saved.page';

/** Wed Oct 7 2026, 08:00 in Montréal. */
const CLOCK = Date.parse('2026-10-07T12:00:00Z');

function configure(favourites: string[], extra: object = {}) {
  const storage = new MemoryStorage();
  storage.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', showConnections: false, favourites, ...extra }));
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK }],
  });
}

async function render(tab?: string) {
  const fixture = TestBed.createComponent(SavedPage);
  if (tab !== undefined) fixture.componentRef.setInput('tab', tab);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = (sel: string, root: ParentNode = el) => (root.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, el, nav, stable, text, cmp: fixture.componentInstance, state: TestBed.inject(AppStateService) };
}

describe('SavedPage', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('shows the empty state with no favourites', async () => {
    configure([]);
    const { el, text } = await render();
    expect(text('.empty h2')).toBe('Nothing saved yet');
    expect(text('.empty p')).toBe('Tap ★ on a destination to keep it here.');
    expect(el.querySelector('.empty a')?.getAttribute('href')).toMatch(/^\/(\?|$)/);
    expect(el.querySelector('app-seg')).toBeNull();
  });

  it('Upcoming: photo cards with countdown badges, then rows', async () => {
    configure(['LHR', 'ATH', 'YYZ', 'NRT']);
    const { el, text } = await render();
    expect(text('h1')).toContain('Saved');
    const cards = el.querySelectorAll('app-photo-card');
    expect(cards).toHaveLength(2);
    expect(text('.bdg', cards[0])).toBe('Today · 17:25');
    expect(text('.t', cards[0])).toBe('Athens');
    expect(text('.m', cards[0])).toBe('Greece · AC898 · 10h10');
    expect(text('.ft', cards[0])).toBe('Nonstop 3× wk Oct');
    expect(cards[0].querySelector('a')?.getAttribute('href')).toContain('/flight/ATH/2026-10-07/AC898');
    expect(text('.m', cards[1])).toBe('AC864 · Daily');
    expect(cards[1].querySelector('.ft')).toBeNull();
    // NRT has no nonstop; YYZ is a hub, not a destination, and is skipped.
    const rows = el.querySelectorAll('.list app-dest-row');
    expect(rows).toHaveLength(1);
    expect(text('.ui-tag', rows[0])).toBe('No flights published');
  });

  it('Upcoming rows after the first two cards carry dots and times', async () => {
    setScheduleSource(
      [...FIXTURE_ROUTES, route('YUL', 'CUN', rec('AC1882', '08:40', '12:10', '2026-10-08', '2027-03-31', 'Thu,Sat'))],
      FIXTURE_META,
    );
    configure(['LHR', 'ATH', 'CUN', 'SYD']);
    const { el, text } = await render();
    expect(el.querySelectorAll('app-photo-card')).toHaveLength(2);
    const rows = el.querySelectorAll('.list app-dest-row');
    expect([...rows].map(r => r.querySelector('small')?.textContent)).toEqual(['CUN', 'SYD']);
    expect(text('.tm', rows[0])).toBe('Tomorrow · 08:40 · 4h30');
    expect(rows[0].querySelector('app-dot-row')?.getAttribute('aria-label')).toBe('Flies Thu, Sat');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toContain('/to/CUN');
  });

  it('switches tabs through ?tab= with replaceUrl', async () => {
    configure(['LHR']);
    const { cmp, nav } = await render();
    expect(cmp.view()).toBe('upcoming');
    cmp.setTab('watching');
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { tab: 'watching' }, queryParamsHandling: 'merge', replaceUrl: true });
    cmp.setTab('upcoming');
    expect(nav).toHaveBeenLastCalledWith([], { queryParams: { tab: null }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('Watching lists every favourite with dots; unstarring offers undo', async () => {
    configure(['LHR', 'ATH', 'NRT']);
    const { el, stable, text, state } = await render('watching');
    const rows = el.querySelectorAll('.list--watch app-dest-row');
    expect([...rows].map(r => r.querySelector('small')?.textContent)).toEqual(['ATH', 'LHR', 'NRT']);
    expect(text('.tm', rows[0])).toBe('Mon Wed Fri');
    expect(text('.tm', rows[1])).toBe('Daily');
    expect(text('.tm', rows[2])).toBe('No flights this week');
    expect(rows[0].querySelector('app-dot-row')?.getAttribute('aria-label')).toBe('Flies Mon, Wed, Fri');

    const flash = vi.spyOn(state, 'flash');
    rows[1].querySelector<HTMLButtonElement>('.unstar')!.click();
    await stable();
    expect(state.favourites()).toEqual(['ATH', 'NRT']);
    expect(flash).toHaveBeenCalledWith('Removed London', expect.objectContaining({ label: 'Undo' }));
    expect(el.querySelectorAll('.list--watch app-dest-row')).toHaveLength(2);
    state.notice()!.action!();
    await stable();
    expect(state.favourites()).toContain('LHR');
    expect(el.querySelectorAll('.list--watch app-dest-row')).toHaveLength(3);
  });
});
