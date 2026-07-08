import { describe, it, expect, beforeEach } from 'vitest';
import { AppComponent } from './app.component';
import { getWeekStart } from './utils/week';

describe('AppComponent', () => {
  let component: AppComponent;

  beforeEach(() => {
    component = new AppComponent();
  });

  it('initialises weekStart to the Monday of the current week', () => {
    expect(component.weekStart.getDay()).toBe(1); // 1 = Monday
  });

  it('initialises to Montreal hub', () => {
    expect(component.homeCity).toBe('Montreal');
    expect(component.hubCode).toBe('YUL');
  });

  it('prevWeek steps back 7 days and clears expandedCode', () => {
    const before = new Date(component.weekStart);
    component.expandedCode = 'LHR';
    component.prevWeek();
    const diff = before.getTime() - component.weekStart.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    expect(component.expandedCode).toBeNull();
  });

  it('nextWeek steps forward 7 days and clears expandedCode', () => {
    const before = new Date(component.weekStart);
    component.expandedCode = 'LHR';
    component.nextWeek();
    const diff = component.weekStart.getTime() - before.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    expect(component.expandedCode).toBeNull();
  });

  it('onHomeCityChange updates hubCode and clears expandedCode', () => {
    component.expandedCode = 'CDG';
    component.onHomeCityChange('Vancouver');
    expect(component.homeCity).toBe('Vancouver');
    expect(component.hubCode).toBe('YVR');
    expect(component.expandedCode).toBeNull();
  });

  it('onRegionSelected updates activeRegion and clears expandedCode', () => {
    component.expandedCode = 'CDG';
    component.onRegionSelected('Europe');
    expect(component.activeRegion).toBe('Europe');
    expect(component.expandedCode).toBeNull();
  });

  it('onCardToggled expands a card', () => {
    component.onCardToggled('LHR');
    expect(component.expandedCode).toBe('LHR');
  });

  it('onCardToggled collapses a card that is already expanded', () => {
    component.expandedCode = 'LHR';
    component.onCardToggled('LHR');
    expect(component.expandedCode).toBeNull();
  });

  it('onCardToggled switches to a different card', () => {
    component.expandedCode = 'LHR';
    component.onCardToggled('CDG');
    expect(component.expandedCode).toBe('CDG');
  });

  it('allRoutes returns routes active in the selected week', () => {
    component.homeCity = 'Toronto';
    component.weekStart = getWeekStart(new Date('2026-11-02T00:00:00'));
    expect(component.allRoutes.length).toBeGreaterThan(0);
  });

  it('allRoutes filters by region', () => {
    component.homeCity = 'Toronto';
    component.weekStart = getWeekStart(new Date('2026-11-02T00:00:00'));
    component.activeRegion = 'Europe';
    const results = component.allRoutes;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r: { destination: { region: string } }) => r.destination.region === 'Europe')).toBe(true);
  });

  it('allRoutes returns empty for a week with no flights', () => {
    component.showConnections = false;
    component.weekStart = getWeekStart(new Date('2020-01-06T00:00:00'));
    expect(component.allRoutes).toHaveLength(0);
  });

  it('onDaySelected sets selectedDate and clears expandedCode', () => {
    component.expandedCode = 'CDG';
    const date = new Date('2026-11-03');
    component.onDaySelected(date);
    expect(component.selectedDate).toBe(date);
    expect(component.expandedCode).toBeNull();
  });

  it('showConnections toggle includes/excludes connecting routes', () => {
    component.homeCity = 'Halifax';
    component.weekStart = getWeekStart(new Date('2026-11-02T00:00:00'));
    component.showConnections = true;
    const withConns = component.allRoutes.length;
    component.showConnections = false;
    const withoutConns = component.allRoutes.length;
    expect(withConns).toBeGreaterThanOrEqual(withoutConns);
  });
});
