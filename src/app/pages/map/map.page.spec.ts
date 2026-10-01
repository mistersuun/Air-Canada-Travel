import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { LAND_FETCH } from '../../state/geo.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { RouteMapComponent } from '../../ui/route-map.component';
import { toUtcMs } from '../../utils/time';
import { MapPage } from './map.page';

const NOW_MS = toUtcMs('2026-10-01', '12:00', 'America/Toronto');

describe('MapPage', () => {
  let fixture: ComponentFixture<MapPage>;
  let el: HTMLElement;
  let state: AppStateService;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function render(inputs: Record<string, string> = {}, setup?: (s: AppStateService) => void): Promise<void> {
    fixture = TestBed.createComponent(MapPage);
    el = fixture.nativeElement;
    state = TestBed.inject(AppStateService);
    state.todayKey.set('2026-10-01');
    setup?.(state);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fixture.whenStable();
  }

  const rows = () => [...el.querySelectorAll<HTMLElement>('app-dest-row')];
  const names = () => rows().map(r => r.getAttribute('data-code'));
  const map = () => fixture.debugElement.query(By.directive(RouteMapComponent)).componentInstance as RouteMapComponent;
  const lastParams = () => navigate.mock.calls.at(-1);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: LAND_FETCH, useValue: () => Promise.resolve(null) },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetScheduleSource();
  });

  it('lists nonstops by distance with km, time, count and dots, and draws them on the map', async () => {
    await render();
    expect(el.querySelector('h2')!.textContent!.trim()).toBe('2 destinations');
    expect(names()).toEqual(['LHR', 'ATH', 'SYD']); // SYD connects via YVR, after the nonstops
    const lhr = rows()[0];
    expect(lhr.querySelector('.nm small')!.textContent).toMatch(/^5,2\d\d km$/);
    expect(lhr.querySelector('.tm')!.textContent!.trim()).toBe('6h50 · 8 this week'); // daily AC864 + Saturday's AC868
    expect(lhr.querySelector('app-dot-row')).not.toBeNull();
    expect(map().points().map(p => [p.code, p.kind])).toEqual([['LHR', 'direct'], ['ATH', 'direct'], ['SYD', 'connect']]);
    expect(map().highlight()).toBeNull();
    expect(map().labels()).toEqual([]);
    expect(el.querySelector('[data-search-input]')).not.toBeNull();
  });

  it('highlights ?sel= in the list and on the map, labelling its neighbour', async () => {
    await render({ sel: 'ath' });
    const ath = rows()[1];
    expect(ath.classList).toContain('is-hl');
    expect(ath.getAttribute('aria-pressed')).toBe('true');
    expect(ath.querySelector('a.open')!.getAttribute('href')).toBe('/to/ATH?from=YUL');
    expect(map().highlight()).toBe('ATH');
    expect(map().labels()).toEqual(['ATH', 'LHR']);
  });

  it('ignores a ?sel= that is not listed', async () => {
    await render({ sel: 'NRT' });
    expect(el.querySelector('.is-hl')).toBeNull();
    expect(map().highlight()).toBeNull();
  });

  it('selects a row (framing the map on it), and opens it on a second tap', async () => {
    await render();
    const before = map().center();
    rows()[2].click();
    expect(lastParams()).toEqual([[], { queryParams: { sel: 'SYD' }, queryParamsHandling: 'merge', replaceUrl: true }]);
    fixture.componentRef.setInput('sel', 'SYD');
    await fixture.whenStable();
    expect(map().center()).not.toEqual(before);
    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(lastParams()).toEqual([['/to', 'SYD'], { queryParams: { from: 'YUL' } }]);
  });

  it('selects from the map without reframing, and hovering highlights an arc', async () => {
    await render();
    const zoom = map().zoom();
    map().pointClick.emit('LHR');
    expect(lastParams()![1]).toMatchObject({ queryParams: { sel: 'LHR' }, replaceUrl: true });
    fixture.componentRef.setInput('sel', 'LHR');
    await fixture.whenStable();
    expect(map().zoom()).toBe(zoom);

    rows()[1].dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(map().highlight()).toBe('ATH');
    expect(map().labels()).toContain('ATH');
    rows()[1].dispatchEvent(new MouseEvent('mouseleave'));
    map().pointHover.emit(null);
    await fixture.whenStable();
    expect(map().highlight()).toBe('LHR');
  });

  it('locate frames everything again and resets the pan', async () => {
    await render({ sel: 'SYD' });
    const framed = map().center();
    const reset = vi.spyOn(map(), 'resetView');
    (el.querySelector('button.locate') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(reset).toHaveBeenCalled();
    expect(map().center()).not.toEqual(framed);
    const zoomBy = vi.spyOn(map(), 'zoomBy');
    const [zin, zout] = [...el.querySelectorAll<HTMLButtonElement>('.ctrls .zm')];
    zin.click();
    zout.click();
    expect(zoomBy.mock.calls).toEqual([[1.5], [1 / 1.5]]);
  });

  it('sorts by time through ?sort=', async () => {
    await render({ sort: 'time' });
    const seg = [...el.querySelectorAll<HTMLButtonElement>('app-seg button')];
    expect(seg[1].getAttribute('aria-pressed')).toBe('true');
    seg[0].click();
    expect(lastParams()![1]).toMatchObject({ queryParams: { sort: null } });
    seg[1].click();
    expect(lastParams()![1]).toMatchObject({ queryParams: { sort: 'time' } });
  });

  it('searches through the global query, with an empty state that clears it', async () => {
    await render();
    const input = el.querySelector<HTMLInputElement>('[data-search-input]')!;
    input.value = 'greece';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(state.query()).toBe('greece');
    expect(names()).toEqual(['ATH']);
    expect(map().points().map(p => p.code)).toEqual(['ATH']);

    state.setQuery('nowhere');
    await fixture.whenStable();
    expect(rows()).toHaveLength(0);
    expect(el.querySelector('.empty')!.textContent).toContain('No destinations match “nowhere”');
    (el.querySelector('.empty button') as HTMLButtonElement).click();
    expect(state.query()).toBe('');
  });

  it('shows the coverage state outside the published window', async () => {
    await render({}, s => s.goToWeek('2027-05-03'));
    expect(rows()).toHaveLength(0);
    expect(el.querySelector('.empty')!.textContent).toContain('aren’t published yet');
    const jump = vi.spyOn(state, 'jumpToCoverage');
    (el.querySelector('.empty button') as HTMLButtonElement).click();
    expect(jump).toHaveBeenCalled();
  });

  it('lists connection-only destinations after the nonstops', async () => {
    await render({}, s => s.setHub('YHZ'));
    const codes = names();
    expect(codes.length).toBeGreaterThan(0);
    expect(el.querySelector('.grp')!.textContent).toContain('Connections only');
    expect(map().points().every(p => p.kind === 'connect')).toBe(true);
    expect(rows()[0].querySelector('.tm')!.textContent).toContain('via YYZ');
  });

  it('toggles the sheet with the handle (tap or drag)', async () => {
    await render();
    const handle = el.querySelector<HTMLButtonElement>('.handle')!;
    const panel = el.querySelector('.panel')!;
    const ptr = (type: string, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientY: y });
      handle.dispatchEvent(e);
    };
    ptr('pointerdown', 500); ptr('pointerup', 500);
    await fixture.whenStable();
    expect(panel.classList).toContain('is-open');
    ptr('pointerdown', 300); ptr('pointerup', 400);
    await fixture.whenStable();
    expect(panel.classList).not.toContain('is-open');
    ptr('pointerdown', 400); ptr('pointerup', 300);
    await fixture.whenStable();
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(handle.getAttribute('aria-expanded')).toBe('false');
  });
});
