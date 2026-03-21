import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('computes visited percentage from country counts', () => {
    const component = new AppComponent();
    component.visitedCountries = ['France', 'Japan'];

    expect(component.visitedCount).toBe(2);
    expect(component.totalCountries).toBeGreaterThan(2);
    expect(component.visitedPercent).toBeGreaterThan(0);
  });

  it('toggles visited country and persists', () => {
    const component = new AppComponent();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    component.onVisitedCountryToggled('France');
    expect(component.visitedCountries).toContain('France');

    component.onVisitedCountryToggled('France');
    expect(component.visitedCountries).not.toContain('France');
    expect(setItemSpy).toHaveBeenCalled();
  });

  it('ignores unknown countries in toggle flow', () => {
    vi.useFakeTimers();
    const component = new AppComponent();
    component.onVisitedCountryToggled('Atlantis');
    vi.runAllTimers();

    expect(component.visitedCountries).not.toContain('Atlantis');
    expect(component.statusMessage).toBe('Unknown country could not be updated.');
    vi.useRealTimers();
  });

  it('clears visited countries when confirmed', () => {
    const component = new AppComponent();
    component.visitedCountries = ['France', 'Japan'];
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.clearVisitedCountries();
    expect(component.visitedCountries).toEqual([]);
  });

  it('does not clear when visited list is already empty', () => {
    vi.useFakeTimers();
    const component = new AppComponent();
    component.visitedCountries = [];

    component.clearVisitedCountries();
    vi.runAllTimers();

    expect(component.statusMessage).toBe('');
    vi.useRealTimers();
  });

  it('resets filters and clears selection', () => {
    const component = new AppComponent();
    component.region = 'Europe';
    component.type = 'City';
    component.search = 'par';
    component.newOnly = true;
    component.selected = component.filteredDestinations[0] ?? null;

    component.resetFilters();

    expect(component.region).toBe('All');
    expect(component.type).toBe('All');
    expect(component.search).toBe('');
    expect(component.newOnly).toBe(false);
    expect(component.selected).toBeNull();
  });

  it('updates filters through handlers', () => {
    const component = new AppComponent();

    component.onRegionChange('Europe');
    component.onTypeChange('City');
    component.onSearchChange('par');
    component.onToggleNewOnly();

    expect(component.region).toBe('Europe');
    expect(component.type).toBe('City');
    expect(component.search).toBe('par');
    expect(component.newOnly).toBe(true);
  });

  it('loads visited countries from storage safely', () => {
    localStorage.setItem('acExplorer.visitedCountries', JSON.stringify(['France', 'Invalidland']));
    const component = new AppComponent();

    expect(component.visitedCountries).toContain('France');
    expect(component.visitedCountries).not.toContain('Invalidland');
  });

  it('handles malformed storage and persistence failures', () => {
    localStorage.setItem('acExplorer.visitedCountries', '{bad-json');
    const component = new AppComponent();
    expect(component.visitedCountries).toEqual([]);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write failed');
    });
    component.onVisitedCountryToggled('France');
    expect(setItemSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('clears search text', () => {
    const component = new AppComponent();
    component.search = 'mex';

    component.clearSearch();
    expect(component.search).toBe('');
  });

  it('handles null selection path and closes panel', () => {
    vi.useFakeTimers();
    const component = new AppComponent();
    component.onSelect(null);
    vi.runAllTimers();
    expect(component.selected).toBeNull();

    component.onPanelClosed();
    vi.runAllTimers();
    expect(component.statusMessage).toBe('Route details closed.');
    vi.useRealTimers();
  });
});
